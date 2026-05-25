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
  assert.equal(plan.summary.mutations, 2);
  const result = applyPlan(baseSite(), plan);
  assert.equal(result.site.files['index.php'], '<?php echo "local";');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Local title');
});

test('executor rejects forged ready plans missing live remote preconditions', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';

  const ready = planFor(base, local, baseSite());
  const forged = tamperReadyPlan(ready, (plan) => {
    delete plan.preconditions;
  });
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forged));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(JSON.stringify(remote), before);
});

test('executor rejects forged ready plans with mismatched live remote preconditions', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';

  const ready = planFor(base, local, baseSite());
  const forged = tamperReadyPlan(ready, (plan) => {
    plan.preconditions[0].resourceKey = 'file:wp-content/themes/theme/style.css';
  });
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forged));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(JSON.stringify(remote), before);
});

test('planner keeps every live mutation behind a live remote precondition while preserving remote-only plugin drift and matching independent edits', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local";';
  local.db.wp_posts['ID:1'].post_title = 'Local title';

  const remote = baseSite();
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);

  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(plan.summary.mutations, 2);
  assert.equal(plan.decisions.some((decision) => decision.decision === 'keep-remote'), true);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('executor rejects forged ready delete plans missing live remote preconditions', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];

  const ready = planFor(base, local, baseSite());
  const deleteMutationId = mutationFor(ready, 'file:index.php').id;
  const forged = tamperReadyPlan(ready, (plan) => {
    plan.preconditions = plan.preconditions.filter((entry) => entry.mutationId !== deleteMutationId);
  });
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forged));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(JSON.stringify(remote), before);
});

test('executor rejects forged ready file type swap plans missing live remote preconditions', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = 'base file bytes';
  base.files['wp-content/uploads/cover/keep.txt'] = 'base descendant';
  const local = baseSite();
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete local.files['wp-content/uploads/cover/keep.txt'];
  const remote = JSON.parse(JSON.stringify(base));

  const ready = planFor(base, local, remote);
  const typeSwapMutationId = mutationFor(ready, 'file:wp-content/uploads/cover').id;
  const forged = tamperReadyPlan(ready, (plan) => {
    plan.preconditions = plan.preconditions.filter((entry) => entry.mutationId !== typeSwapMutationId);
  });
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forged));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(JSON.stringify(remote), before);
});

test('executor rejects forged mixed ready plans when any live remote precondition is missing', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = 'base file bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['wp-content/uploads/cover'] = 'base file bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const ready = planFor(base, local, remote);
  const deleteMutation = mutationFor(ready, 'file:index.php');
  const typeSwapMutation = mutationFor(ready, 'file:wp-content/uploads/cover');
  assert.ok(deleteMutation);
  assert.ok(typeSwapMutation);
  const forged = tamperReadyPlan(ready, (plan) => {
    plan.preconditions = plan.preconditions.filter((entry) => entry.mutationId !== typeSwapMutation.id);
    assert.equal(plan.preconditions.some((entry) => entry.mutationId === deleteMutation.id), true);
  });
  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forged));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('executor rejects forged mixed ready delete and type swap plans when the delete precondition is missing', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'base gallery bytes';

  const ready = planFor(base, local, remote);
  const deleteMutation = mutationFor(ready, 'file:index.php');
  const typeSwapMutation = mutationFor(ready, 'file:wp-content/uploads/gallery');
  const forged = tamperReadyPlan(ready, (plan) => {
    plan.preconditions = plan.preconditions.filter((entry) => entry.mutationId !== deleteMutation.id);
    assert.equal(plan.preconditions.some((entry) => entry.mutationId === typeSwapMutation.id), true);
  });

  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, forged));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(error.details.mutationCount, 2);
  assert.equal(error.details.preconditionCount, 1);
});

test('executor refuses a ready delete plan when the live remote changes after dry run while unrelated plugin drift is preserved', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];

  const remote = baseSite();
  const plan = planFor(base, local, remote);

  remote.files['index.php'] = '<?php echo "remote drift";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const before = JSON.stringify(remote);
  const error = captureError(() => applyPlan(remote, plan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(JSON.stringify(remote), before);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only changes and does not overwrite them', () => {
  const base = baseSite();
  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Remote editorial update';

  const plan = planFor(base, baseSite(), remote);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.conflicts, 0);
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

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and matching independent file type swap stay safe', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent restore, edit, and file type swap stay safe', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const matchingRestore = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while live-preconditioned file and row deletes plus matching edit and file type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base delete title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  delete local.db.wp_posts['ID:3'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };

  const remote = baseSite();
  delete remote.db.wp_posts['ID:3'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const independentDelete = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(independentDelete.decision, 'already-in-sync');
  assert.equal(independentDelete.change.localChange, 'delete');
  assert.equal(independentDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored title');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:3'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('plans local file deletions only behind live remote preconditions', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  const remote = baseSite();

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, 'file:index.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.action, 'delete');
  assert.equal(mutation.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(remote.files, 'index.php'), true);
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

test('stops a local file deletion when the remote edited the same file', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.files['index.php'];
  remote.files['index.php'] = '<?php echo "Remote secret file update";';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(JSON.stringify(conflict).includes('Remote secret file update'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "Remote secret file update";');
});

test('stops a local file deletion on conflict while preserving unrelated remote-only plugin drift', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.files['index.php'];
  remote.files['index.php'] = '<?php echo "Remote secret file update";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(JSON.stringify(conflict).includes('Remote secret file update'), false);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "Remote secret file update";');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('bounds file delete conflict evidence while preserving unrelated remote-only plugin drift', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.files['index.php'];
  remote.files['index.php'] = '<?php echo "Remote secret file update";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const conflictJson = JSON.stringify(conflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.reason, 'Local and remote both changed this resource after the pull base.');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');
  assert.equal(conflictJson.includes('Remote secret file update'), false);
  assert.equal(conflictJson.includes('remote-only plugin drift'), false);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file delete conflict while preserving a matching independent type swap and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "Remote secret file update";';
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(conflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:index.php');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(conflictJson.includes('Remote secret file update'), false);
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.preconditions.length, 0);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "Remote secret file update";');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file deletion conflict while preserving matching independent edits and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "Remote secret file update";';
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const conflictJson = JSON.stringify(conflict);
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:index.php');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(conflictJson.includes('Remote secret file update'), false);
  assert.equal(conflictJson.includes('shared about'), false);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "Remote secret file update";');
  assert.equal(remote.files['about.php'], '<?php echo "shared about";');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file deletion when the remote turned the same file into a directory', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.files['index.php'];
  remote.files['index.php'] = { type: 'directory' };

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:index.php');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'type-change');
  assert.equal(JSON.stringify(conflict).includes('base file bytes'), false);
  assert.equal(plan.preconditions.length, 0);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.files, 'index.php'), true);
});

test('stops a local file delete when the remote turned the same file into a directory while preserving a matching independent edit and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = baseSite();
  remote.files['index.php'] = { type: 'directory' };
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:index.php');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'type-change');
  assert.equal(planJson.includes('shared about'), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.files, 'index.php'), true);
  assert.equal(remote.files['about.php'], '<?php echo "shared about";');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file delete when the remote turned the same file into a directory while preserving a matching independent delete and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['index.php'] = { type: 'directory' };
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingDelete = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(conflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:index.php');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'type-change');
  assert.equal(conflictJson.includes('base gallery bytes'), false);
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.files, 'index.php'), true);
  assert.equal(Object.hasOwn(remote.files, 'about.php'), false);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file delete when the remote turned the same file into a directory while preserving a matching independent type swap and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['index.php'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(conflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:index.php');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'type-change');
  assert.equal(conflictJson.includes('base file bytes'), false);
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.files, 'index.php'), true);
  assert.equal(remote.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local row deletion when the remote independently updated the same row while preserving a matching independent file type swap and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base file bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post title', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:2'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Remote updated title', post_status: 'publish' };
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(conflict.resourceKey, 'row:["wp_posts","ID:2"]');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(planJson.includes('Base post title'), false);
  assert.equal(planJson.includes('Remote updated title'), false);
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'Remote updated title');
  assert.equal(remote.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local directory deletion that would remove a remote-only descendant', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };
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

test('stops a local file delete when the remote independently type swaps the same path while unrelated plugin drift is preserved', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'remote replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(plan.preconditions.some((precondition) =>
    precondition.resourceKey === 'file:wp-content/uploads/gallery'),
  false);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(JSON.stringify(conflict).includes('remote replacement file'), false);
  assert.equal(JSON.stringify(conflict).includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery'], 'remote replacement file');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file delete when the remote independently type swaps the same path while preserving a matching independent edit and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'remote replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(plan.preconditions.some((precondition) =>
    precondition.resourceKey === 'file:wp-content/uploads/gallery'),
  false);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(JSON.stringify(conflict).includes('remote replacement file'), false);
  assert.equal(JSON.stringify(conflict).includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery'], 'remote replacement file');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file delete when the remote independently type swaps the same path while preserving matching independent edit, matching independent row delete, and remote-only plugin drift with bounded evidence', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  local.files['about.php'] = '<?php echo "shared about";';
  delete local.db.wp_posts['ID:2'];

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'remote replacement file';
  delete remote.db.wp_posts['ID:2'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 1);
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(plan.preconditions.some((precondition) =>
    precondition.resourceKey === 'file:wp-content/uploads/gallery'),
  false);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('remote replacement file'), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery'], 'remote replacement file');
  assert.equal(Object.hasOwn(remote.db.wp_posts, 'ID:2'), false);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file delete when the remote independently type swaps the same path while preserving a matching independent type swap, matching edit, and remote-only plugin drift with bounded evidence', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 1);
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(plan.preconditions.some((precondition) =>
    precondition.resourceKey === 'file:wp-content/uploads/gallery'),
  false);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'type-change');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file delete that would hide a live remote descendant while preserving a matching independent edit and remote-only plugin removal', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  local.files['about.php'] = '<?php echo "shared about";';
  delete local.db.wp_posts['ID:2'];

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote descendant bytes';
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.db.wp_posts['ID:2'];
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const typeSwap = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflict = plan.conflicts[0];
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 1);
  assert.equal(plan.summary.mutations, 0);
  assert.equal(typeSwap, undefined);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(planJson.includes('remote descendant bytes'), false);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.jpg'], 'remote descendant bytes');
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(remote.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('bounds file type swap conflict evidence while preserving unrelated remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'local replacement file';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote image bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const conflictJson = JSON.stringify(conflict);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'type-change');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(conflictJson.includes('remote image bytes'), false);
  assert.equal(conflictJson.includes('remote-only plugin drift'), false);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.jpg'], 'remote image bytes');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('bounds directory delete conflict evidence while preserving matching independent edit and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.db.wp_posts['ID:9'] = { ID: 9, post_title: 'Base matched title 9', post_status: 'publish' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  local.db.wp_posts['ID:9'] = { ID: 9, post_title: 'Shared matched title 9', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';
  remote.db.wp_posts['ID:9'] = { ID: 9, post_title: 'Shared matched title 9', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const conflictJson = JSON.stringify(conflict);
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:9"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(conflictJson.includes('remote private image bytes'), false);
  assert.equal(conflictJson.includes('remote-only plugin drift'), false);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.preconditions.length, 0);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.jpg'], 'remote private image bytes');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('allows a file type swap when the descendant is deleted in the same plan from the unchanged base', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  const local = JSON.parse(JSON.stringify(base));
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  const remote = JSON.parse(JSON.stringify(base));
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const descendantDelete = mutationFor(plan, 'file:wp-content/uploads/gallery/keep.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(descendantDelete.action, 'delete');
  assert.equal(descendantDelete.changeKind, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('stops a file type swap when the descendant delete drifts remotely', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  const local = JSON.parse(JSON.stringify(base));
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote-only descendant bytes';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const conflictJson = JSON.stringify(conflict);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedResourceKey, undefined);
  assert.equal(conflict.relatedChange, null);
  assert.equal(conflictJson.includes('remote-only descendant bytes'), false);
  assert.equal(conflictJson.includes('remote-private-forms-code'), false);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/keep.txt'], 'remote-only descendant bytes');
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('stops a directory delete when the descendant delete drifts remotely', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote-only descendant bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery/keep.txt');
  const conflictJson = JSON.stringify(conflict);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedResourceKey, undefined);
  assert.equal(conflict.relatedChange, null);
  assert.equal(conflictJson.includes('remote-only descendant bytes'), false);
  assert.equal(conflictJson.includes('remote-only plugin drift'), false);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/keep.txt'], 'remote-only descendant bytes');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a local directory delete and matching descendant delete stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  const remote = JSON.parse(JSON.stringify(base));
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const directoryDelete = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const descendantDelete = mutationFor(plan, 'file:wp-content/uploads/gallery/keep.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(directoryDelete.action, 'delete');
  assert.equal(directoryDelete.changeKind, 'delete');
  assert.equal(descendantDelete.action, 'delete');
  assert.equal(descendantDelete.changeKind, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin changes while a local directory delete, matching descendant delete, and matching independent edit stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.files['about.php'] = '<?php echo "base about";';

  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const directoryDelete = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const descendantDelete = mutationFor(plan, 'file:wp-content/uploads/gallery/keep.txt');
  const editDecision = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(directoryDelete.action, 'delete');
  assert.equal(directoryDelete.changeKind, 'delete');
  assert.equal(descendantDelete.action, 'delete');
  assert.equal(descendantDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a local file delete, matching independent row delete, matching independent edit, and matching independent type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = 'base file bytes';
  base.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Base post 5', post_status: 'publish' };
  base.db.wp_posts['ID:6'] = { ID: 6, post_title: 'Base post 6', post_status: 'publish' };
  base.files['about.php'] = '<?php echo "base about";';

  const local = JSON.parse(JSON.stringify(base));
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:5'];
  local.db.wp_posts['ID:6'].post_title = 'Shared post 6';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = JSON.parse(JSON.stringify(base));
  delete remote.db.wp_posts['ID:5'];
  remote.db.wp_posts['ID:6'].post_title = 'Shared post 6';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDelete = decisionFor(plan, 'row:["wp_posts","ID:5"]');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:6"]');
  const fileDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowDelete.decision, 'already-in-sync');
  assert.equal(rowDelete.change.localChange, 'delete');
  assert.equal(rowDelete.change.remoteChange, 'delete');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(fileDecision.decision, 'already-in-sync');
  assert.equal(fileDecision.change.localChange, 'update');
  assert.equal(fileDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:5'), false);
  assert.equal(result.site.db.wp_posts['ID:6'].post_title, 'Shared post 6');
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent row edit, and matching file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.files['wp-content/uploads/cover'] = 'base file bytes';
  base.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Base post 4', post_status: 'publish' };

  const local = JSON.parse(JSON.stringify(base));
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:4'].post_title = 'Shared post 4';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:4'].post_title = 'Shared post 4';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const directoryDelete = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const descendantDelete = mutationFor(plan, 'file:wp-content/uploads/gallery/keep.txt');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:4"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 3);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(directoryDelete.action, 'delete');
  assert.equal(directoryDelete.changeKind, 'delete');
  assert.equal(descendantDelete.action, 'delete');
  assert.equal(descendantDelete.changeKind, 'delete');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(result.site.db.wp_posts['ID:4'].post_title, 'Shared post 4');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('plans local file type swaps only behind live remote preconditions', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = 'base file bytes';
  const local = baseSite();
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  const remote = baseSite();
  remote.files['wp-content/uploads/cover'] = 'base file bytes';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, 'file:wp-content/uploads/cover');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'type-change');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
});

test('keeps remote-only plugin changes while planning an unrelated local file type swap', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = 'base file bytes';
  const local = baseSite();
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  const remote = baseSite();
  remote.files['wp-content/uploads/cover'] = 'base file bytes';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, 'file:wp-content/uploads/cover');

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'type-change');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
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

test('blocks a directory delete that would hide a live remote descendant while preserving matching independent edits and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const remoteBefore = JSON.stringify(remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(JSON.stringify(conflict).includes('remote private image bytes'), false);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('blocks a directory delete that would hide a live remote descendant while preserving remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/base-only.txt'] = 'base descendant bytes';

  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.txt'] = 'remote descendant bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(conflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey.startsWith('file:wp-content/uploads/gallery/'), true);
  assert.equal(conflict.reason.includes('hide or remove a live remote descendant'), true);
  assert.equal(conflictJson.includes('remote descendant bytes'), false);
  assert.equal(conflictJson.includes('base descendant bytes'), false);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('blocks a directory delete that would hide a live remote descendant while preserving matching independent delete, edit, type swap, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/cover'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  local.files['wp-content/uploads/cover'] = 'shared replacement file';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';
  delete remote.db.wp_posts['ID:1'];
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.files['wp-content/uploads/cover'] = 'shared replacement file';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const remoteBefore = JSON.stringify(remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(JSON.stringify(conflict).includes('remote private image bytes'), false);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('keeps remote-only plugin changes while suppressing unsafe topology mutations', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  local.files['index.php'] = '<?php echo "local ordinary edit";';
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const mutation = mutationFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const remoteBefore = JSON.stringify(remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('blocks a directory delete that would hide a live remote descendant while preserving unrelated plugin drift evidence', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const remoteBefore = JSON.stringify(remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(JSON.stringify(conflict).includes('remote private image bytes'), false);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('blocks a directory delete that would hide a live remote descendant while preserving matching independent delete and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['wp-content/uploads/gallery'];
  delete local.db.wp_posts['ID:1'];
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/remote-only.jpg'] = 'remote private image bytes';
  delete remote.db.wp_posts['ID:1'];
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const deleteDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const remoteBefore = JSON.stringify(remote);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResourceKey, 'file:wp-content/uploads/gallery/remote-only.jpg');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(JSON.stringify(conflict).includes('remote private image bytes'), false);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('keeps remote-only plugin removals while a live-preconditioned file delete, matching independent delete, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/photo.txt'] = {
    type: 'file',
    path: 'wp-content/uploads/photo.txt',
    name: 'photo.txt',
    contents: 'base photo bytes',
  };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base independent title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/photo.txt'] = {
    type: 'image',
    path: 'wp-content/uploads/photo.txt',
    name: 'photo.txt',
    mimeType: 'image/png',
  };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base independent title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/photo.txt'] = {
    type: 'file',
    path: 'wp-content/uploads/photo.txt',
    name: 'photo.txt',
    contents: 'base photo bytes',
  };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base independent title', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const rowDeleteMutation = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/photo.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 3);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(rowDeleteMutation.action, 'delete');
  assert.equal(rowDeleteMutation.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['wp-content/uploads/photo.txt'].type, 'image');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Base independent title');
  assert.equal(result.site.plugins.forms, undefined);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
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

test('keeps remote-only plugin changes while recognizing a matching independent edit', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.plugins.forms.active, false);
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent edit and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.files['wp-content/uploads/cover'] = 'shared replacement file';
  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.files['wp-content/uploads/cover'] = 'shared replacement file';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/cover'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and matching independent file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = { type: 'directory' };

  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.files['wp-content/uploads/cover'] = 'shared replacement file';

  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.files['wp-content/uploads/cover'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/cover'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent restore, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/keep.txt'];

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.files['wp-content/uploads/gallery/keep.txt'];
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.ok(deleteMutation);
  assert.ok(typeSwapMutation);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/keep.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery'], { type: 'directory' });
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent restore, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/keep.txt'];

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.files['wp-content/uploads/gallery/keep.txt'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.ok(deleteMutation);
  assert.ok(typeSwapMutation);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/keep.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery'], { type: 'directory' });
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent delete, edit, and file type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base independent title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Shared independent title',
    post_status: 'publish',
  };
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  delete remote.db.wp_posts['ID:1'];
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Shared independent title',
    post_status: 'publish',
  };
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('recognizes matching independent file edits as already in sync', () => {
  const base = baseSite();
  base.files['index.php'] = '<?php echo "base";';
  const local = baseSite();
  local.files['index.php'] = '<?php echo "shared";';
  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "shared";';

  const plan = planFor(base, local, remote);
  const decision = decisionFor(plan, 'file:index.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'update');
  assert.equal(decision.change.remoteChange, 'update');
});

test('keeps remote-only plugin changes while recognizing a matching independent file type swap', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.deepEqual(remote.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.plugins.forms.active, false);
});

test('keeps remote-only plugin changes while recognizing a matching independent file creation', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared created file";';
  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared created file";';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const createDecision = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(createDecision.decision, 'already-in-sync');
  assert.equal(createDecision.change.localChange, 'create');
  assert.equal(createDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(remote.files['about.php'], '<?php echo "shared created file";');
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.plugins.forms.active, false);
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

test('recognizes matching independent row deletions as already in sync', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.db.wp_posts['ID:1'];
  delete remote.db.wp_posts['ID:1'];

  const plan = planFor(base, local, remote);
  const decision = decisionFor(plan, 'row:["wp_posts","ID:1"]');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'delete');
  assert.equal(decision.change.remoteChange, 'delete');
});

test('keeps remote-only plugin changes while recognizing a matching independent deletion', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.files['index.php'];
  delete remote.files['index.php'];
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(remote.files['index.php'], undefined);
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.plugins.forms.active, false);
});

test('keeps remote-only plugin changes while a matching independent deletion stays safe with apply verification', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.files['index.php'];
  delete remote.files['index.php'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteMutation, undefined);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent edit stay safe with apply verification', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();

  delete local.files['index.php'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent create stay safe with apply verification', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();

  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingCreate = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingCreate.decision, 'already-in-sync');
  assert.equal(matchingCreate.change.localChange, 'create');
  assert.equal(matchingCreate.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while recognizing a matching independent row deletion', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  delete local.db.wp_posts['ID:1'];
  delete remote.db.wp_posts['ID:1'];
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin changes while recognizing matching independent deletions and type swaps', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent create stay safe with apply verification', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared created file";';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared created file";';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const createDecision = decisionFor(plan, 'file:about.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(createDecision.decision, 'already-in-sync');
  assert.equal(createDecision.change.localChange, 'create');
  assert.equal(createDecision.change.remoteChange, 'create');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared created file";');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent row delete, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete local.db.wp_posts['ID:2'];

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.db.wp_posts['ID:2'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a matching independent deletion, edit, and live-preconditioned type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin changes while a live-preconditioned deletion, matching file edit, matching row edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, type swap, and matching edit stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const descendantDelete = mutationFor(plan, 'file:wp-content/uploads/gallery/keep.txt');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(descendantDelete.action, 'delete');
  assert.equal(descendantDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('keeps remote-only plugin changes while recognizing matching independent deletions, edits, and type swaps', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin changes while a live-preconditioned row delete and matching file edit and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base row', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:2'];
  local.files['index.php'] = '<?php echo "shared file edit";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base row', post_status: 'publish' };
  remote.files['index.php'] = '<?php echo "shared file edit";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:2"]');
  const fileEditDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(fileEditDecision.decision, 'already-in-sync');
  assert.equal(fileEditDecision.change.localChange, 'update');
  assert.equal(fileEditDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.files['index.php'], '<?php echo "shared file edit";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin changes while matching a deletion, file type swap, and edit stay already in sync', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.plugins.forms.active, false);
});

test('keeps remote-only plugin changes while matching deletion, restore, and type swap stay already in sync', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared restore";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin changes while recognizing a matching independent deletion and restore', () => {
  const base = baseSite();
  delete base.files['about.php'];
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared restore";';
  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(deleteMutation.remoteBeforeHash.length, 64);
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared restore";');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent restore stay safe with apply verification', () => {
  const base = baseSite();
  delete base.files['about.php'];
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared restore";';
  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(deleteMutation.remoteBeforeHash.length, 64);
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared restore";');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent restore stay safe with apply verification', () => {
  const base = baseSite();
  delete base.files['about.php'];
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared restore";';
  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared restore";');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent restore, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  delete base.files['about.php'];
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared restore";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared restore";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent delete, restore, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  delete base.files['about.php'];
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.files['about.php'] = '<?php echo "shared restore";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const directoryDelete = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const descendantDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/keep.txt');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(directoryDelete.decision, 'already-in-sync');
  assert.equal(directoryDelete.change.localChange, 'delete');
  assert.equal(directoryDelete.change.remoteChange, 'delete');
  assert.equal(descendantDelete.decision, 'already-in-sync');
  assert.equal(descendantDelete.change.localChange, 'delete');
  assert.equal(descendantDelete.change.remoteChange, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared restore";');
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a matching independent restore and an unrelated deletion stay safe', () => {
  const base = baseSite();
  delete base.files['about.php'];
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared restore";';
  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared restore";');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin changes while a matching independent row restore and an unrelated deletion stay safe', () => {
  const base = baseSite();
  delete base.db.wp_posts['ID:2'];
  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored row', post_status: 'publish' };
  const remote = baseSite();
  delete remote.db.wp_posts['ID:2'];
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored row', post_status: 'publish' };
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored row');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin removals while a local file delete and matching independent restore stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery/restored.txt'] = 'restored content';

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  remote.files['wp-content/uploads/gallery/restored.txt'] = 'restored content';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const restoreDecision = decisionFor(plan, 'file:wp-content/uploads/gallery/restored.txt');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(deleteMutation.remoteBeforeHash.length, 64);
  assert.equal(deleteMutation.baseHash.length, 64);
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching restore, edit, and type swap stay safe', () => {
  const base = baseSite();
  delete base.files['index.php'];
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['index.php'] = '<?php echo "restored";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "restored";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const restoreDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['index.php'], '<?php echo "restored";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code */',
  );
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(deleteMutation.remoteBeforeHash.length, 64);
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'create');
  assert.equal(typeSwapDecision.change.remoteChange, 'create');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.deepEqual(result.site.files['wp-content/uploads/gallery'], { type: 'directory' });
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching restore, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  delete base.files['about.php'];
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared restore";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(deleteMutation.remoteBeforeHash.length, 64);
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared restore";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching edit, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['about.php'] = '<?php echo "base about";';
  const local = baseSite();
  delete local.files['about.php'];
  local.files['index.php'] = '<?php echo "shared edit";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  const remote = JSON.parse(JSON.stringify(base));
  remote.files['index.php'] = '<?php echo "shared edit";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:about.php');
  const editDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.equal(result.site.files['index.php'], '<?php echo "shared edit";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while allowing unrelated local deletions', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(rowDelete.action, 'delete');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(
    decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision,
    'keep-remote',
  );
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code */',
  );
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code */',
  );
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = 'base file bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.files['wp-content/uploads/cover'] = 'base file bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const typeSwap = mutationFor(plan, 'file:wp-content/uploads/cover');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(typeSwap.action, 'put');
  assert.equal(typeSwap.changeKind, 'type-change');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching restore stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery/cover.txt'] = 'restored content';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery/cover.txt'] = 'restored content';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery/cover.txt'], 'restored content');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code */',
  );
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code */',
  );
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, matching row edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.files['wp-content/uploads/cover'] = 'base file bytes';
  base.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Base post 4', post_status: 'publish' };

  const local = JSON.parse(JSON.stringify(base));
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.db.wp_posts['ID:4'].post_title = 'Shared post 4';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.files['wp-content/uploads/gallery/keep.txt'];
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.db.wp_posts['ID:4'].post_title = 'Shared post 4';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const coverTypeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const rowTwoDecision = decisionFor(plan, 'row:["wp_posts","ID:4"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(coverTypeSwapDecision.decision, 'already-in-sync');
  assert.equal(coverTypeSwapDecision.change.localChange, 'type-change');
  assert.equal(coverTypeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(rowTwoDecision.decision, 'already-in-sync');
  assert.equal(rowTwoDecision.change.localChange, 'update');
  assert.equal(rowTwoDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.db.wp_posts['ID:4'].post_title, 'Shared post 4');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent file deletion, matching edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.files['wp-content/uploads/cover'] = 'base file bytes';
  base.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Base post 4', post_status: 'publish' };
  base.files['about.php'] = '<?php echo "base about";';

  const local = JSON.parse(JSON.stringify(base));
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:4'].post_title = 'Shared post 4';

  const remote = JSON.parse(JSON.stringify(base));
  delete remote.files['wp-content/uploads/gallery'];
  delete remote.files['wp-content/uploads/gallery/keep.txt'];
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:4'].post_title = 'Shared post 4';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const directoryDeleteDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const descendantDeleteDecision = decisionFor(plan, 'file:wp-content/uploads/gallery/keep.txt');
  const matchingFileDelete = decisionFor(plan, 'file:about.php');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:4"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(directoryDeleteDecision.decision, 'already-in-sync');
  assert.equal(directoryDeleteDecision.change.localChange, 'delete');
  assert.equal(directoryDeleteDecision.change.remoteChange, 'delete');
  assert.equal(descendantDeleteDecision.decision, 'already-in-sync');
  assert.equal(descendantDeleteDecision.change.localChange, 'delete');
  assert.equal(descendantDeleteDecision.change.remoteChange, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(result.site.db.wp_posts['ID:4'].post_title, 'Shared post 4');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, matching row edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.deepEqual(result.site.files['wp-content/uploads/gallery'], { type: 'directory' });
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matched post title');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms, undefined);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], undefined);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching edit, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('preserves unrelated ordinary mutations while stopping stale plugin-context edits', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local ordinary edit";';
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* local plugin edit */';
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const fileMutation = mutationFor(plan, 'file:index.php');
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileMutation.action, 'put');
  assert.equal(fileMutation.changeKind, 'update');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(conflict.pluginOwner, 'forms');
  assert.equal(JSON.stringify(conflict).includes('remote-private-forms-code'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "base";');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin changes while recognizing a matching independent edit', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.files['index.php'] = '<?php echo "shared ordinary edit";';
  remote.files['index.php'] = '<?php echo "shared ordinary edit";';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const editDecision = decisionFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(result.site.files['index.php'], '<?php echo "shared ordinary edit";');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent restore, edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/cover'] = { type: 'directory' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base edited row', post_status: 'publish' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/cover'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored row', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared edited row', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  remote.files['wp-content/uploads/cover'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored row', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared edited row', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored row');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared edited row');
  assert.equal(result.site.files['wp-content/uploads/cover'], 'shared replacement file');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/archive'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/archive'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  remote.files['wp-content/uploads/archive'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/archive');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/archive'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while recognizing a matching independent file type swap', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin changes while matching deletion, create, edit, and type swap stay already in sync', () => {
  const base = baseSite();
  base.files['index.php'] = '<?php echo "base";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared create";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['about.php'] = '<?php echo "shared create";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const createDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(createDecision.decision, 'already-in-sync');
  assert.equal(createDecision.change.localChange, 'create');
  assert.equal(createDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.plugins.forms.active, false);
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

test('recognizes matching independent file creations as already in sync', () => {
  const base = baseSite();
  delete base.files['wp-content/themes/theme/style.css'];
  const local = baseSite();
  local.files['wp-content/themes/theme/style.css'] = 'body { color: green; }';
  const remote = baseSite();
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: green; }';

  const plan = planFor(base, local, remote);
  const decision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'create');
  assert.equal(decision.change.remoteChange, 'create');
});

test('recognizes matching independent file type swaps as already in sync', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const plan = planFor(base, local, remote);
  const decision = decisionFor(plan, 'file:wp-content/uploads/gallery');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'type-change');
  assert.equal(decision.change.remoteChange, 'type-change');
});

test('keeps remote-only plugin changes while recognizing a matching independent restore', () => {
  const base = baseSite();
  delete base.files['index.php'];
  const local = baseSite();
  local.files['index.php'] = '<?php echo "restored";';
  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "restored";';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const restoreDecision = decisionFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin changes while mixing an unrelated deletion with a matching independent restore', () => {
  const base = baseSite();
  delete base.files['index.php'];
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['index.php'] = '<?php echo "restored";';
  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "restored";';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const restoreDecision = decisionFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent restore stay safe', () => {
  const base = baseSite();
  delete base.files['index.php'];
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['index.php'] = '<?php echo "restored";';
  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "restored";';
  remote.plugins.forms = { version: '1.2.0', active: true };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.2 */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const restoreDecision = decisionFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['index.php'], '<?php echo "restored";');
  assert.equal(result.site.plugins.forms.version, '1.2.0');
  assert.equal(result.site.plugins.forms.active, true);
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code v1.2 */',
  );
});

test('keeps remote-only plugin removals while a live-preconditioned delete and matching independent restore stay safe', () => {
  const base = baseSite();
  delete base.files['index.php'];
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['index.php'] = '<?php echo "restored";';
  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "restored";';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const restoreDecision = decisionFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['index.php'], '<?php echo "restored";');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned file delete and matching independent restore stay safe with apply verification', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "restored";';
  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "restored";';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['index.php'] = '<?php echo "shared edit";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "shared edit";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const restoreDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['index.php'], '<?php echo "shared edit";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching edit, and matching type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = 'base file bytes';
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['about.php'] = '<?php echo "shared edit";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared edit";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared edit";');
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a matching independent deletion, edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['about.php'] = '<?php echo "shared edit";';
  local.files['wp-content/uploads/cover'] = 'shared replacement file';
  const remote = baseSite();
  delete remote.files['index.php'];
  delete remote.db.wp_posts['ID:1'];
  remote.files['about.php'] = '<?php echo "shared edit";';
  remote.files['wp-content/uploads/cover'] = 'shared replacement file';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const rowDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(rowDelete.decision, 'already-in-sync');
  assert.equal(rowDelete.change.localChange, 'delete');
  assert.equal(rowDelete.change.remoteChange, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'create');
  assert.equal(editDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.preconditions.length, 0);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared edit";');
  assert.equal(result.site.files['wp-content/uploads/cover'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('recognizes matching independent plugin context edits as already in sync', () => {
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.plugins.forms = { version: '1.1.0', active: false };
  remote.plugins.forms = { version: '1.1.0', active: false };
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms 1.1 shared */';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms 1.1 shared */';

  const plan = planFor(base, local, remote);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const fileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(pluginDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.change.localChange, 'update');
  assert.equal(pluginDecision.change.remoteChange, 'update');
  assert.equal(fileDecision.decision, 'already-in-sync');
  assert.equal(fileDecision.change.localChange, 'update');
  assert.equal(fileDecision.change.remoteChange, 'update');
});

test('keeps remote-only plugin changes while matching local delete and type swap stay hash-preconditioned', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('keeps remote-only plugin changes while matching independent delete, edit, and type swap stay already in sync', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin removals while matching local delete, edit, and type swap stay hash-preconditioned', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('keeps remote-only plugin removals while an unrelated delete, matching edit, and matching type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('keeps remote-only plugin removals while a live-preconditioned row delete, matching edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('keeps remote-only plugin removals while matching independent delete, edit, and type swap stay already in sync', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin changes while matching independent delete, edit, and type swap stay already in sync', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin changes while a mixed delete, edit, and type swap remains live-preconditioned', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while local delete, matching edit, and matching type swap stay live-preconditioned', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms = { version: '1.2.0', active: true };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.2 */';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.plugins.forms.version, '1.2.0');
  assert.equal(result.site.plugins.forms.active, true);
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code v1.2 */',
  );
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent edit and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms = { version: '1.2.0', active: true };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.2 */';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.plugins.forms.version, '1.2.0');
  assert.equal(result.site.plugins.forms.active, true);
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code v1.2 */',
  );
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching edit, and matching type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms = { version: '1.3.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.3 */';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(result.site.plugins.forms.version, '1.3.0');
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code v1.3 */',
  );
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching file edit, matching row edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared restore";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.3.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.3 */';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared restore";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.version, '1.3.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code v1.3 */',
  );
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent file deletion, edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const remote = baseSite();
  delete remote.files['wp-content/uploads/gallery/keep.txt'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.3.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.3 */';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/keep.txt');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.version, '1.3.0');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code v1.3 */');
});

test('keeps remote-only plugin changes while a live-preconditioned type swap and matching independent edit stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms = { version: '1.5.0', active: true };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.5 */';

  const plan = planFor(base, local, remote);
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(result.site.plugins.forms.version, '1.5.0');
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code v1.5 */',
  );
});

test('keeps remote-only plugin changes while a live-preconditioned row delete and matching independent edit and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared base title', post_status: 'publish' };
  const local = baseSite();
  delete local.db.wp_posts['ID:2'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent row title';
  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared base title', post_status: 'publish' };
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent row title';
  remote.plugins.forms = { version: '1.3.0', active: true };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.3 */';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent row title');
  assert.equal(result.site.plugins.forms.version, '1.3.0');
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code v1.3 */',
  );
});

test('keeps remote-only plugin changes while a live-preconditioned row delete, matching independent row deletion, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared base title', post_status: 'publish' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  delete local.db.wp_posts['ID:2'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';

  const remote = baseSite();
  delete remote.db.wp_posts['ID:2'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  remote.plugins.forms = { version: '1.3.0', active: true };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.3 */';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: maroon; }');
  assert.equal(result.site.plugins.forms.version, '1.3.0');
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code v1.3 */',
  );
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent edit and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent row title';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent row title';
  remote.plugins.forms = { version: '1.4.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.4 */';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.plugins.forms.version, '1.4.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code v1.4 */',
  );
});

test('keeps remote-only plugin changes while matching independent row delete, edit, and type swap stay already in sync', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  delete remote.files['index.php'];
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin removals while mixed ordinary local mutations stay hash-preconditioned', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin metadata changes while mixed ordinary local mutations stay hash-preconditioned', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.plugins.forms = { version: '1.2.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.plugins.forms.version, '1.2.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
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

test('keeps remote-only plugin changes while a local directory delete and matching descendant delete stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/child.txt'] = 'child base';
  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/child.txt'];
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const directoryDeletion = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const descendantDeletion = decisionFor(plan, 'file:wp-content/uploads/gallery/child.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(directoryDeletion.decision, 'already-in-sync');
  assert.equal(directoryDeletion.change.localChange, 'delete');
  assert.equal(directoryDeletion.change.remoteChange, 'delete');
  assert.equal(descendantDeletion.decision, 'already-in-sync');
  assert.equal(descendantDeletion.change.localChange, 'delete');
  assert.equal(descendantDeletion.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/child.txt'), false);
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('preserves remote-only plugin removals while still applying independent local changes', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local ordinary edit";';
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const fileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(fileDecision.decision, 'keep-remote');
  assert.equal(mutationFor(plan, 'file:index.php').action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.files['index.php'], '<?php echo "local ordinary edit";');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete and matching independent edit stay safe', () => {
  const base = baseSite();
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(mutationFor(plan, 'file:index.php').action, 'delete');
  assert.equal(mutationFor(plan, 'file:index.php').changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: red; }';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/keep.txt'];

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.files['wp-content/uploads/gallery/keep.txt'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');

  assert.equal(plan.status, 'ready');
  assert.ok(deleteMutation);
  assert.ok(typeSwapMutation);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/keep.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery'], { type: 'directory' });
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and matching independent file type swap stay safe', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base file bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin metadata while a live-preconditioned delete and matching independent edit and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  remote.plugins.forms.version = '1.1.0';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
});

test('stops stale local plugin file edits when the remote removed that plugin', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* stale local forms code */';
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(conflict.pluginOwner, 'forms');
  assert.equal(conflict.change.localChange, 'update');
  assert.equal(conflict.change.remoteChange, 'delete');
  assert.equal(JSON.stringify(plan).includes('stale local forms code'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], undefined);
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

test('stops stale local plugin file edits when the remote removed that plugin', () => {
  const base = baseSite();
  const local = baseSite();
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* stale local forms code */';
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(conflict.pluginOwner, 'forms');
  assert.equal(conflict.change.localChange, 'update');
  assert.equal(conflict.change.remoteChange, 'delete');
  assert.equal(JSON.stringify(plan).includes('stale local forms code'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], undefined);
});

test('keeps remote-only plugin changes while planning a safe local deletion behind live preconditions', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'file:index.php');

  assert.equal(plan.status, 'ready');
  assert.equal(deletion.action, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('keeps remote-only plugin changes while planning an unrelated local row deletion', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'row:["wp_posts","ID:1"]');

  assert.equal(plan.status, 'ready');
  assert.equal(deletion.action, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.plugins.forms.active, false);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('keeps remote-only plugin changes while a live-preconditioned row delete and matching independent edit and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base row title', post_status: 'publish' };
  const local = baseSite();
  delete local.db.wp_posts['ID:2'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent row title';
  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base row title', post_status: 'publish' };
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent row title';
  remote.plugins.forms = { version: '1.6.0', active: true };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code v1.6 */';

  const plan = planFor(base, local, remote);
  const deletion = mutationFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent row title');
  assert.equal(result.site.plugins.forms.version, '1.6.0');
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-private-forms-code v1.6 */',
  );
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

test('blocks stale plugin file changes while preserving an unrelated safe deletion as evidence', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* local-private-forms-code */';
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const deletion = mutationFor(plan, 'file:index.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deletion.action, 'delete');
  assert.equal(deletion.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(mutationFor(plan, 'file:wp-content/plugins/forms/forms.php'), undefined);
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/plugins/forms/forms.php');
  assert.equal(conflict.pluginOwner, 'forms');
  assert.equal(conflict.relatedResource, null);
  assert.equal(conflict.relatedChange, null);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.files, 'index.php'), true);
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
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

test('keeps remote-only plugin metadata and file drift while a plugin-owned row stays already in sync', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local index";';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.files['index.php'], '<?php echo "local index";');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
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
  assert.equal(plan.blockers[0].class, 'stale-plugin-owner-context');
  assert.equal(plan.blockers[0].pluginOwner, 'forms');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
});

test('blocks plugin-owned data when the live remote removed the owner plugin', () => {
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
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.decisions.some((decision) => decision.resourceKey === 'plugin:forms'), true);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.ownerContext.some((context) => context.resourceKey === 'plugin:forms'), true);
  assert.equal(blocker.ownerContext.some((context) => context.resourceKey === 'file:wp-content/plugins/forms/forms.php'), true);
  assert.equal(blockerJson.includes('local-advanced'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(remote.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('blocks plugin-owned option deletions when the live remote removed the owner plugin', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.ownerContext.some((context) => context.resourceKey === 'plugin:forms'), true);
  assert.equal(blocker.ownerContext.some((context) => context.resourceKey === 'file:wp-content/plugins/forms/forms.php'), true);
  assert.equal(blockerJson.includes('local-advanced'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(remote.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('bounds stale plugin owner evidence when many owner-context resources are present', () => {
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
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';
  remote.files['wp-content/plugins/forms/admin.php'] = '<?php /* remote-private-admin-code */';
  remote.files['wp-content/plugins/forms/lib/helpers.php'] = '<?php /* remote-private-helper-code */';
  remote.files['wp-content/plugins/forms/readme.txt'] = 'remote-private-readme';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.ownerContext.length, 3);
  assert.equal(blocker.ownerContextTruncated, true);
  assert.equal(
    blocker.ownerContext.every((context) =>
      context.resourceKey === 'plugin:forms'
      || context.resourceKey.startsWith('file:wp-content/plugins/forms/')),
    true,
  );
  assert.equal(blockerJson.includes('remote-private-forms-code'), false);
  assert.equal(blockerJson.includes('remote-private-admin-code'), false);
  assert.equal(blockerJson.includes('remote-private-helper-code'), false);
});

test('blocks a stale plugin-owned delete while preserving a matching edit and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };

  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.ok(blocker);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blockerJsonHasRawPluginData(planJson), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
});

test('blocks a stale plugin-owned delete while preserving a matching restore and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };

  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.ok(blocker);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.equal(planJson.includes('Shared restored title'), false);
});

function blockerJsonHasRawPluginData(planJson) {
  return planJson.includes('remote-private-forms-code')
    || planJson.includes('remote-private-admin-code')
    || planJson.includes('remote-private-helper-code');
}

test('blocks plugin-owned option deletions while preserving unrelated remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blockerJson.includes('remote-private-forms-code'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.plugins.forms.active, false);
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('blocks plugin-owned option deletions while preserving remote-only plugin drift and matching independent edits', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:1"]').decision, 'already-in-sync');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.plugins.forms.active, false);
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('blocks plugin-owned option deletions while preserving remote-only plugin drift and matching independent deletions', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  delete remote.files['index.php'];
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms = { version: '1.1.0', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'file:index.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:1"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.files, 'index.php'), false);
  assert.equal(Object.hasOwn(remote.db.wp_posts, 'ID:1'), false);
  assert.equal(remote.plugins.forms.version, '1.1.0');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('blocks plugin-owned deletions while preserving remote-only plugin drift and matching independent deletions', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.1', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'file:index.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:1"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.version, '1.1.1');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('blocks plugin-owned deletions while preserving remote-only plugin drift and matching independent deletions, edits, and type swaps', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.2', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'file:index.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:1"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.files, 'index.php'), false);
  assert.equal(remote.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(remote.plugins.forms.version, '1.1.2');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('blocks plugin-owned deletions while preserving remote-only plugin drift and matching independent restore and edit', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.files['about.php'] = '<?php echo "shared restore";';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms = { version: '1.1.3', active: false };
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-forms-code */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:1"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.version, '1.1.3');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-private-forms-code */');
});

test('blocks plugin-owned deletions while preserving remote-only plugin drift and matching independent restore, edit, and type swap', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.files['about.php'] = '<?php echo "shared restore";';
  local.files['index.php'] = '<?php echo "shared edit";';
  local.files['wp-content/uploads/gallery/cover.txt'] = { type: 'directory' };
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared restore";';
  remote.files['index.php'] = '<?php echo "shared edit";';
  remote.files['wp-content/uploads/gallery/cover.txt'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:index.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('preserves remote-only plugin removals while matching independent delete, edit, and type swap stay already in sync', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('preserves remote-only plugin removals while a live-preconditioned delete, matching edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps a live-preconditioned delete, matching edit, and type swap safe while preserving remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms.version = '1.0.1';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* forms 1.0.1 */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching deletion and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  delete remote.files['index.php'];
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.version = '1.1.0';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDeleteDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(fileDelete, undefined);
  assert.equal(rowDeleteDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching deletion, edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };
  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.plugins.forms.version = '1.1.1';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDeleteDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowDeleteDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.version, '1.1.1');
  assert.equal(
    result.site.files['wp-content/plugins/forms/forms.php'],
    '<?php /* remote-only plugin drift */',
  );
});

test('keeps remote-only plugin drift while a live-preconditioned delete, matching independent restore, and file type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.version = '1.1.0';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while live-preconditioned file and row deletes plus matching edit and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.db.wp_posts['ID:2'].post_title = 'Shared independent title';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching restore, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['index.php'] = '<?php echo "restored";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "restored";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const restoreDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['index.php'], '<?php echo "restored";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching row restore, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Restored shared title', post_status: 'publish' };
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Restored shared title', post_status: 'publish' };
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const rowRestoreDecision = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(rowRestoreDecision.decision, 'already-in-sync');
  assert.equal(rowRestoreDecision.change.localChange, 'create');
  assert.equal(rowRestoreDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Restored shared title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching row restore, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored row', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored row', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored row');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned row delete, matching independent row deletion, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: blue; }';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Matching deleted title', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  delete local.db.wp_posts['ID:3'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const remote = baseSite();
  delete remote.db.wp_posts['ID:3'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:3'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent row deletion, matching independent restore, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete base.files['about.php'];
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:2'];
  local.files['about.php'] = '<?php echo "restored";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  delete remote.db.wp_posts['ID:2'];
  remote.files['about.php'] = '<?php echo "restored";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching restore, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['index.php'] = '<?php echo "restored";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "restored";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const restoreDecision = decisionFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['index.php'], '<?php echo "restored";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file delete conflict while preserving unrelated remote-only plugin drift and bounded evidence', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "remote changed";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 1);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.reason, 'Local and remote both changed this resource after the pull base.');
  assert.equal(conflict.change.local.state, 'absent');
  assert.equal(conflict.change.remote.state, 'present');
  assert.equal(conflict.change.remote.contents, undefined);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('stops a local file delete conflict while preserving matching independent edit and type swap plus remote-only plugin removals', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "remote changed";';
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 1);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.reason, 'Local and remote both changed this resource after the pull base.');
  assert.equal(conflict.change.local.state, 'absent');
  assert.equal(conflict.change.remote.state, 'present');
  assert.equal(conflict.change.remote.contents, undefined);
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('stops a local file delete that would hide a remote-only descendant while keeping plugin drift and bounded evidence', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/remote-only.txt'] = 'remote-only descendant';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const planJson = JSON.stringify(plan);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 1);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.reason, 'Local file deletion or type change would hide or remove a live remote descendant.');
  assert.equal(conflict.relatedResource.key, 'file:wp-content/uploads/gallery/remote-only.txt');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(conflict.relatedChange.remote.state, 'present');
  assert.equal(conflict.relatedChange.remote.contents, undefined);
  assert.equal(planJson.includes('remote-only descendant'), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('stops a local file delete that would hide a live remote descendant while preserving a matching delete, matching type swap, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['about.php'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/gallery/remote-only.txt'] = 'remote-only descendant';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const matchingDelete = decisionFor(plan, 'file:about.php');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(conflict.relatedResource.key, 'file:wp-content/uploads/gallery/remote-only.txt');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.relatedChange.remoteChange, 'create');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('remote-only descendant'), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.txt'], 'remote-only descendant');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a file type swap that would hide a live remote descendant while preserving a matching edit and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/remote-only.txt'] = 'base descendant';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Matching independent title', post_status: 'publish' };

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'local replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Matching independent title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/remote-only.txt'] = 'remote-only descendant';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Matching independent title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 2);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.reason, 'Local file deletion or type change would hide or remove a live remote descendant.');
  assert.equal(conflict.relatedResource.key, 'file:wp-content/uploads/gallery/remote-only.txt');
  assert.equal(conflict.relatedChange.remoteChange, 'update');
  assert.equal(conflict.relatedChange.remote.state, 'present');
  assert.equal(conflict.relatedChange.remote.contents, undefined);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.txt'], 'remote-only descendant');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a file type swap that would hide a live remote descendant while preserving a matching delete and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/remote-only.txt'] = 'base descendant';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared delete title', post_status: 'publish' };

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'local replacement file';
  delete local.db.wp_posts['ID:2'];

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/remote-only.txt'] = 'remote-only descendant';
  delete remote.db.wp_posts['ID:2'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 2);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.reason, 'Local file deletion or type change would hide or remove a live remote descendant.');
  assert.equal(conflict.relatedResource.key, 'file:wp-content/uploads/gallery/remote-only.txt');
  assert.equal(conflict.relatedChange.remoteChange, 'update');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(JSON.stringify(conflict).includes('remote-only descendant'), false);
  assert.equal(JSON.stringify(conflict).includes('remote-only plugin drift'), false);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.txt'], 'remote-only descendant');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a file type swap that would hide a live remote descendant while preserving matching delete, restore, edit, and remote-only plugin drift with apply refusal', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/remote-only.txt'] = 'base descendant';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restore title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base edit title', post_status: 'publish' };

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'local replacement file';
  delete local.files['about.php'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restore title', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared edit title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/remote-only.txt'] = 'remote-only descendant';
  delete remote.files['about.php'];
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restore title', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared edit title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const matchingDelete = decisionFor(plan, 'file:about.php');
  const matchingRestore = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 2);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.reason, 'Local file deletion or type change would hide or remove a live remote descendant.');
  assert.equal(conflict.relatedResource.key, 'file:wp-content/uploads/gallery/remote-only.txt');
  assert.equal(conflict.relatedChange.remoteChange, 'update');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('remote-only descendant'), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.txt'], 'remote-only descendant');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a file type swap that would hide a live remote descendant while preserving matching delete, restore, edit, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/remote-only.txt'] = 'base descendant';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restore title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base edit title', post_status: 'publish' };

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'local replacement file';
  delete local.files['about.php'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restore title', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared edit title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/remote-only.txt'] = 'remote-only descendant';
  delete remote.files['about.php'];
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restore title', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared edit title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const matchingDelete = decisionFor(plan, 'file:about.php');
  const matchingRestore = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts, 2);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.reason, 'Local file deletion or type change would hide or remove a live remote descendant.');
  assert.equal(conflict.relatedResource.key, 'file:wp-content/uploads/gallery/remote-only.txt');
  assert.equal(conflict.relatedChange.remoteChange, 'update');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('remote-only descendant'), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/remote-only.txt'], 'remote-only descendant');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching edit, and file type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/photo.txt'] = {
    type: 'file',
    path: 'wp-content/uploads/photo.txt',
    name: 'photo.txt',
    contents: 'base photo bytes',
  };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Matching independent title', post_status: 'publish' };
  const local = baseSite();

  delete local.files['index.php'];
  local.files['wp-content/uploads/photo.txt'] = {
    type: 'image',
    path: 'wp-content/uploads/photo.txt',
    name: 'photo.txt',
    mimeType: 'image/png',
  };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Matching independent title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/photo.txt'] = {
    type: 'file',
    path: 'wp-content/uploads/photo.txt',
    name: 'photo.txt',
    contents: 'base photo bytes',
  };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Matching independent title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/photo.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(mutationFor(plan, 'row:["wp_posts","ID:2"]'), undefined);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/photo.txt'].type, 'image');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matching independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent deletion, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent edit stay safe', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent edit apply safely', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const before = JSON.stringify(remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.ok(mutationFor(plan, 'file:index.php'));
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.files['index.php'], undefined);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
  assert.equal(JSON.stringify(remote), before);
});

test('keeps remote-only plugin changes while a live-preconditioned row delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Shared independent title',
    post_status: 'publish',
  };
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Shared independent title',
    post_status: 'publish',
  };
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'create');
  assert.equal(editDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent edit stay safe with apply verification', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['index.php'] = '<?php echo "shared edit";';

  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "shared edit";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const editDecision = decisionFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['index.php'], '<?php echo "shared edit";');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and file type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.version = '1.2.0';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.version, '1.2.0');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms, undefined);
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], undefined);
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent deletion, edit, and file type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:2'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  delete remote.db.wp_posts['ID:2'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned row delete, matching independent row deletion, edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: blue; }';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Matching deleted title', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  delete local.db.wp_posts['ID:3'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const remote = baseSite();
  delete remote.db.wp_posts['ID:3'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:3'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent row deletion, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['contact.php'] = '<?php echo "base contact";';
  const local = JSON.parse(JSON.stringify(base));
  delete local.files['contact.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  local.files['wp-content/uploads/gallery/cover.txt'] = 'shared nested asset';
  const remote = JSON.parse(JSON.stringify(base));
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.files['wp-content/uploads/gallery/cover.txt'] = 'shared nested asset';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:contact.php');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
  assert.equal(Object.hasOwn(result.site.files, 'contact.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/uploads/gallery/cover.txt'], 'shared nested asset');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent row edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete and matching independent edit stay safe', () => {
  const base = baseSite();
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent edit, and matching file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/uploads/gallery/cover.txt'] = 'shared cover';

  const remote = baseSite();
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/uploads/gallery/cover.txt'] = 'shared cover';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: maroon; }');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/uploads/gallery/cover.txt'], 'shared cover');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent edits stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  remote.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const optionDecision = decisionFor(plan, 'row:["wp_options","option_name:forms_settings"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.preconditions.length, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(optionDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(JSON.parse(JSON.stringify(remote)), plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matched post title');
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'local-advanced');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching restore, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "restored";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "restored";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent restore, matching independent edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "restored";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "restored";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matched post title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent edits plus file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "matched about";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "matched about";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const fileDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.preconditions.length, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(fileDecision.decision, 'already-in-sync');
  assert.equal(fileDecision.change.localChange, 'update');
  assert.equal(fileDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(JSON.parse(JSON.stringify(remote)), plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "matched about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matched post title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent delete, edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('keeps remote-only plugin removals while a live-preconditioned row delete, matching edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: blue; }';

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const remote = baseSite();
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent file deletion, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/archive.txt'] = 'base archive';

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/uploads/gallery/archive.txt'] = 'shared archive';

  const remote = baseSite();
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/uploads/gallery/archive.txt'] = 'shared archive';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/uploads/gallery/archive.txt'], 'shared archive');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: blue; }';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: black; }');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent delete, matching edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: maroon; }');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching restore, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "restored";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete local.files['wp-content/uploads/gallery/cover.txt'];

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['about.php'] = '<?php echo "restored";';
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'create');
  assert.equal(restoreDecision.change.remoteChange, 'create');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent row deletion, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.db.wp_posts['ID:1'].post_title = 'Base title';

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.db.wp_posts['ID:1'].post_title = 'Shared title';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  remote.db.wp_posts['ID:1'].post_title = 'Shared title';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const editDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared title');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: maroon; }');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  local.db.wp_posts['ID:2'].post_title = 'Shared post 2';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete local.files['wp-content/uploads/gallery/cover.txt'];

  const remote = baseSite();
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent delete, matching edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/themes/theme/style.css'] = 'body { color: black; }';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  local.db.wp_posts['ID:2'].post_title = 'Shared post 2';

  const remote = baseSite();
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const matchingEdit = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: maroon; }');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent edit stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/themes/theme/style.css'] = 'body { color: blue; }';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  local.db.wp_posts['ID:2'].post_title = 'Shared post 2';

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: maroon; }');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent edits stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/themes/theme/style.css'] = 'body { color: blue; }';
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/themes/theme/style.css'] = 'body { color: plum; }';
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };
  local.db.wp_posts['ID:3'].post_title = 'Shared post 3';

  const remote = baseSite();
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: plum; }';
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: plum; }');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['wp-content/themes/theme/style.css'] = 'body { color: blue; }';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['wp-content/themes/theme/style.css'] = 'body { color: olive; }';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: olive; }';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt/keep.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.files['wp-content/uploads/gallery/cover.txt/keep.txt'], undefined);
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: olive; }');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/themes/theme/style.css'] = 'body { color: blue; }';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  delete local.files['wp-content/uploads/gallery/cover.txt'];

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: maroon; }';
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const matchingEdit = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: maroon; }');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, matching independent row deletion, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base row title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: plum; }';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared title', post_status: 'publish' };
  delete local.db.wp_posts['ID:3'];

  const remote = baseSite();
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: plum; }';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared title', post_status: 'publish' };
  delete remote.db.wp_posts['ID:3'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const matchingEdit = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: plum; }');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared title');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:3'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, matching independent row deletion, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base row title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/themes/theme/style.css'] = 'body { color: slate; }';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared title', post_status: 'publish' };
  delete local.db.wp_posts['ID:3'];

  const remote = baseSite();
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/themes/theme/style.css'] = 'body { color: slate; }';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared title', post_status: 'publish' };
  delete remote.db.wp_posts['ID:3'];
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt');
  const matchingEdit = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'body { color: slate; }');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared title');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:3'), false);
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
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

test('blocks plugin-owned option deletions without explicit delete opt-in', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };

  const plan = planFor(base, local, baseSite());
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.match(blocker.reason, /delete mutations/);
  assert.throws(() => applyPlan(baseSite(), plan), /Refusing to apply/);
});

test('applies an allowed plugin-owned option delete only behind a live precondition while preserving matching independent edits and remote-only plugin drift on another plugin', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base gallery bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post title', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'image', path: 'wp-content/uploads/gallery/photo.txt', name: 'photo.txt', mimeType: 'image/png' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post title', post_status: 'publish' };
  local.meta = {
    pushPolicy: {
      pluginOwnedResources: {
        allowedResources: [
          {
            ...allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
            allowDelete: true,
          },
        ],
      },
    },
  };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery/photo.txt'] = {
    type: 'image',
    path: 'wp-content/uploads/gallery/photo.txt',
    name: 'photo.txt',
    mimeType: 'image/png',
  };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post title', post_status: 'publish' };
  remote.plugins.seo = { version: '1.0.0', active: true, description: 'remote-only plugin drift' };
  remote.files['wp-content/plugins/seo/seo.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const pluginOwnedDelete = mutationFor(plan, resourceKey);
  const matchingFileEdit = decisionFor(plan, 'file:about.php');
  const matchingFileTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const remoteOnlyPluginDecision = decisionFor(plan, 'plugin:seo');
  const remoteOnlyPluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/seo/seo.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(pluginOwnedDelete.action, 'delete');
  assert.equal(pluginOwnedDelete.changeKind, 'delete');
  assert.equal(pluginOwnedDelete.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(pluginOwnedDelete.pluginOwnedResource.supportsDelete, true);
  assert.equal(matchingFileEdit.decision, 'already-in-sync');
  assert.equal(matchingFileEdit.change.localChange, 'update');
  assert.equal(matchingFileEdit.change.remoteChange, 'update');
  assert.equal(matchingFileTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingFileTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingFileTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(remoteOnlyPluginDecision.decision, 'keep-remote');
  assert.equal(remoteOnlyPluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_options, 'option_name:forms_settings'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery/photo.txt'].type, 'image');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post title');
  assert.equal(result.site.plugins.seo.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/seo/seo.php'], '<?php /* remote-only plugin drift */');
  assert.equal(result.site.plugins.forms.version, '1.0.0');
});

test('blocks plugin-owned option updates when the owning plugin was removed remotely and only the dependency is declared', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.pushIntents = [
    {
      id: 'update-forms-settings',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      dependencies: { plugins: ['forms'] },
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
      ),
    },
  ];
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
});

test('blocks unsupported plugin-owned option updates while preserving unrelated remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  const remote = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
});

test('blocks unsupported plugin-owned option updates while preserving matching independent delete, edit, type swap, and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  local.files['wp-content/uploads/gallery/cover.txt'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery/cover.txt'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blockerJson.includes('local-advanced'), false);
  assert.equal(blockerJson.includes('base cover'), false);
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
});

test('blocks unsupported plugin-owned option updates while preserving matching independent delete, edit, type swap, and remote-only plugin removal', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';

  const remote = baseSite();
  delete remote.files['wp-content/uploads/gallery/cover.txt'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blockerJson.includes('local-advanced'), false);
  assert.equal(blockerJson.includes('base cover'), false);
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matched post title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent restore, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['about.php'] = '<?php echo "restored";';
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['about.php'] = '<?php echo "restored";';
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matched post title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent restore stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "restored";';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "restored";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:index.php').action, 'delete');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['about.php'] = '<?php echo "local about";';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['about.php'] = '<?php echo "local about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.files['about.php'], '<?php echo "local about";');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent row delete, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.db.wp_options['option_name:site_tagline'] = {
    option_name: 'site_tagline',
    option_value: 'Base tagline',
  };

  const local = JSON.parse(JSON.stringify(base));
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.db.wp_options['option_name:site_tagline'].option_value = 'Shared tagline';

  const remote = JSON.parse(JSON.stringify(base));
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.db.wp_options['option_name:site_tagline'].option_value = 'Shared tagline';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, 'file:index.php').action, 'delete');
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery').action, 'put');
  assert.equal(decisionFor(plan, 'row:["wp_options","option_name:site_tagline"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.db.wp_options['option_name:site_tagline'].option_value, 'Shared tagline');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent row edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.db.wp_options['option_name:site_tagline'] = {
    option_name: 'site_tagline',
    option_value: 'Base tagline',
  };

  const local = JSON.parse(JSON.stringify(base));
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.db.wp_options['option_name:site_tagline'].option_value = 'Shared tagline';

  const remote = JSON.parse(JSON.stringify(base));
  delete remote.files['wp-content/uploads/gallery/keep.txt'];
  remote.db.wp_options['option_name:site_tagline'].option_value = 'Shared tagline';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const rowDecision = decisionFor(plan, 'row:["wp_options","option_name:site_tagline"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_options['option_name:site_tagline'].option_value, 'Shared tagline');
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent file and row edits stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/themes/theme/style.css'] = 'base theme css';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/themes/theme/style.css'] = 'shared theme css';
  local.db.wp_posts['ID:1'].post_title = 'Shared independent title';

  const remote = baseSite();
  remote.files['wp-content/themes/theme/style.css'] = 'shared theme css';
  remote.db.wp_posts['ID:1'].post_title = 'Shared independent title';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const fileDecision = decisionFor(plan, 'file:wp-content/themes/theme/style.css');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(fileDecision.decision, 'already-in-sync');
  assert.equal(fileDecision.change.localChange, 'update');
  assert.equal(fileDecision.change.remoteChange, 'update');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/themes/theme/style.css'], 'shared theme css');
  assert.equal(result.site.db.wp_posts['ID:1'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['about.php'] = '<?php echo "local about";';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['about.php'] = '<?php echo "local about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.files['about.php'], '<?php echo "local about";');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, restore, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/sidebar.txt'] = 'base sidebar';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['about.php'] = '<?php echo "restored";';
  local.files['wp-content/uploads/gallery/sidebar.txt'] = 'matched sidebar';
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['about.php'] = '<?php echo "restored";';
  remote.files['wp-content/uploads/gallery/sidebar.txt'] = 'matched sidebar';
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/sidebar.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(result.site.files['wp-content/uploads/gallery/sidebar.txt'], 'matched sidebar');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matched post title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent delete, restore, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/sidebar.txt'] = 'base sidebar';

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['about.php'] = '<?php echo "restored";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  local.files['wp-content/uploads/gallery/sidebar.txt'] = 'shared sidebar';

  const remote = JSON.parse(JSON.stringify(base));
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['about.php'] = '<?php echo "restored";';
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/sidebar.txt'] = 'shared sidebar';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt/keep.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/sidebar.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt/keep.txt'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.files['wp-content/uploads/gallery/sidebar.txt'], 'shared sidebar');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete plus matching independent edit and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['index.php'] = '<?php echo "base index";';
  base.files['about.php'] = '<?php echo "base about";';
  base.files['page.php'] = '<?php echo "base page";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared independent edit";';
  local.files['page.php'] = { type: 'directory' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared independent edit";';
  remote.files['page.php'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:index.php').action, 'delete');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:page.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared independent edit";');
  assert.equal(result.site.files['page.php'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, matching independent delete, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['index.php'] = '<?php echo "base index";';
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = 'base gallery';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base keep';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.files['wp-content/uploads/gallery/keep.txt'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(mutationFor(plan, 'file:index.php').action, 'delete');
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery').action, 'put');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/keep.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent edit, row delete, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['about.php'] = '<?php echo "base about";';
  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const rowDeleteDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(rowDeleteDecision.decision, 'already-in-sync');
  assert.equal(rowDeleteDecision.change.localChange, 'delete');
  assert.equal(rowDeleteDecision.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and matching independent restore stay safe with apply verification', () => {
  const base = baseSite();

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = 'restored gallery file';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'restored gallery file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.ok(deleteMutation);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'restored gallery file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent type swap, and matching independent delete stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['wp-content/uploads/gallery/sidecar.txt'] = 'base sidecar';

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/sidecar.txt'];

  const remote = JSON.parse(JSON.stringify(base));
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/sidecar.txt'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt/keep.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/sidecar.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt/keep.txt'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/sidecar.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, matching independent delete, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['wp-content/uploads/archive'] = 'base archive';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base second post',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['wp-content/uploads/archive'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local second post',
    post_status: 'publish',
  };

  const remote = JSON.parse(JSON.stringify(base));
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['wp-content/uploads/archive'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Local second post',
    post_status: 'publish',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/cover.txt/keep.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/archive').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt/keep.txt'), false);
  assert.deepEqual(result.site.files['wp-content/uploads/archive'], { type: 'directory' });
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Local second post');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matched post title');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, and matching file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base second post',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Shared second post',
    post_status: 'publish',
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Shared second post',
    post_status: 'publish',
  };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt/keep.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared second post');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent delete, edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['wp-content/uploads/gallery/sidecar.txt'] = 'base sidecar';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base second post',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  delete local.files['wp-content/uploads/gallery/sidecar.txt'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Shared second post',
    post_status: 'publish',
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  delete remote.files['wp-content/uploads/gallery/sidecar.txt'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Shared second post',
    post_status: 'publish',
  };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/sidecar.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt/keep.txt'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/sidecar.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared second post');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent restore, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['about.php'] = '<?php echo "restored";';
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['about.php'] = '<?php echo "restored";';
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matched post title');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent restore, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/cover.txt'] = 'base cover';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base keep';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Base post title',
    post_status: 'publish',
  };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery/cover.txt'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  local.files['about.php'] = '<?php echo "restored";';
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'];
  remote.files['about.php'] = '<?php echo "restored";';
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'Matched post title',
    post_status: 'publish',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt').action, 'delete');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:2"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.txt'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.files['about.php'], '<?php echo "restored";');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Matched post title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
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

test('blocks unknown plugin-owned custom table rows while preserving matching independent edits and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_forms_entries","entry_id:9"]';
  const base = baseSite();
  base.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'base-private-entry', __pluginOwner: 'forms' },
  };
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local index";';
  local.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'local-private-entry', __pluginOwner: 'forms' },
  };
  const remote = baseSite();
  remote.db.wp_forms_entries = {
    'entry_id:9': { entry_id: 9, payload: 'base-private-entry', __pluginOwner: 'forms' },
  };
  remote.files['index.php'] = '<?php echo "local index";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const editDecision = decisionFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blockerJson.includes('base-private-entry'), false);
  assert.equal(blockerJson.includes('local-private-entry'), false);
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
});

test('blocks plugin-owned rows with missing driver metadata while preserving remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-advanced';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
    }),
  };
  const remote = baseSite();
  remote.plugins.seo = { version: '1.0.0', active: true };
  remote.files['wp-content/plugins/seo/seo.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'missing-plugin-driver');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.driver, null);
  assert.equal(blockerJson.includes('local-advanced'), false);
});

test('blocks plugin-owned deletes with missing driver metadata while preserving matching independent delete, restore, and remote-only plugin drift', () => {
  const ownedResourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const restoredResourceKey = 'row:["wp_options","option_name:blogname"]';
  const deletedResourceKey = 'row:["wp_posts","ID:1"]';
  const base = baseSite();
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base', token: 'plugin-owned-secret' },
    __pluginOwner: 'forms',
  };
  base.db.wp_options['option_name:blogname'] = {
    option_name: 'blogname',
    option_value: 'Base Site',
  };
  base.db.wp_posts['ID:1'] = { ID: 1, post_title: 'Base post', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.db.wp_options['option_name:blogname'] = {
    option_name: 'blogname',
    option_value: 'Shared Site',
  };
  delete local.db.wp_posts['ID:1'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey: ownedResourceKey,
      pluginOwner: 'forms',
    }),
  };

  const remote = baseSite();
  remote.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base', token: 'plugin-owned-secret' },
    __pluginOwner: 'forms',
  };
  remote.db.wp_options['option_name:blogname'] = {
    option_name: 'blogname',
    option_value: 'Shared Site',
  };
  delete remote.db.wp_posts['ID:1'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === ownedResourceKey);
  const restoreDecision = decisionFor(plan, restoredResourceKey);
  const deleteDecision = decisionFor(plan, deletedResourceKey);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, ownedResourceKey), undefined);
  assert.equal(blocker.class, 'missing-plugin-driver');
  assert.equal(blocker.reason, 'Plugin-owned resource row:["wp_options","option_name:forms_settings"] is missing explicit driver metadata for plugin forms.');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('plugin-owned-secret'), false);
  assert.equal(planJson.includes('Base post'), false);
  assert.equal(planJson.includes('Shared Site'), false);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(plan.mutations.length, 0);
});

test('blocks plugin-owned deletes with missing driver metadata while preserving matching independent deletes, type swaps, and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared title', post_status: 'publish' };
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
    }),
  };

  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete remote.db.wp_posts['ID:1'];
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(conflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.resourceKey, resourceKey);
  assert.equal(conflictJson.includes('remote-only plugin drift'), false);
  assert.equal(conflictJson.includes('Shared title'), false);
});

test('stops plugin-owned deletes with missing driver metadata while preserving matching independent deletes, edits, type swaps, and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.db.wp_posts['ID:1'] = { ID: 1, post_title: 'Base post title', post_status: 'publish' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared title', post_status: 'publish' };
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
    }),
  };

  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete remote.db.wp_posts['ID:1'];
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const matchingFileEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(conflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingFileEdit.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.pluginOwner, 'forms');
  assert.equal(conflict.resourceKey, resourceKey);
  assert.equal(conflictJson.includes('remote-only plugin drift'), false);
  assert.equal(conflictJson.includes('Shared title'), false);
});

test('stops plugin-owned deletes with missing driver metadata while preserving a matching restore and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.db.wp_posts['ID:1'].post_title = 'Shared restored title';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
    }),
  };

  const remote = baseSite();
  remote.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };
  remote.db.wp_posts['ID:1'].post_title = 'Shared restored title';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey)
    ?? plan.conflicts.find((entry) => entry.resourceKey === resourceKey);
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.ok(blocker);
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('Shared restored title'), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.equal(plan.preconditions.length, 0);
});

test('blocks plugin-owned deletes when the owner plugin was removed remotely even with an unrelated safe edit', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local ordinary edit";';
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };
  const remote = baseSite();
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const fileMutation = mutationFor(plan, 'file:index.php');
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileMutation.action, 'put');
  assert.equal(fileMutation.changeKind, 'update');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blockerJson.includes('local ordinary edit'), false);
  assert.equal(blockerJson.includes('forms_settings'), true);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "base";');
  assert.equal(remote.plugins.forms, undefined);
});

test('blocks plugin-owned deletes when the owner plugin was removed remotely while preserving a matching independent edit', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.files['index.php'] = '<?php echo "local ordinary edit";';
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };
  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "local ordinary edit";';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const editDecision = decisionFor(plan, 'file:index.php');
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blockerJson.includes('local ordinary edit'), false);
  assert.equal(blockerJson.includes('forms_settings'), true);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "local ordinary edit";');
  assert.equal(remote.plugins.forms, undefined);
});

test('blocks plugin-owned deletes when the owner plugin was removed remotely while preserving matching independent delete, edit, and type swap', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.db.wp_posts['ID:1'] = { ID: 1, post_title: 'Base post title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete local.db.wp_posts['ID:1'];
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete remote.db.wp_posts['ID:1'];
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blockerJson.includes('shared about'), false);
  assert.equal(blockerJson.includes('base photo'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(remote.files['wp-content/uploads/gallery/photo.txt'], { type: 'directory' });
  assert.equal(Object.hasOwn(remote.db.wp_posts, 'ID:1'), false);
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
});

test('blocks plugin-owned deletes when the owner plugin was removed remotely while preserving matching independent delete, edit, type swap, and remote-only plugin removals', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.db.wp_posts['ID:1'] = { ID: 1, post_title: 'Base post title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete local.db.wp_posts['ID:1'];
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete remote.db.wp_posts['ID:1'];
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];
  delete remote.plugins.seo;
  delete remote.files['wp-content/plugins/seo/seo.php'];

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blockerJson.includes('shared about'), false);
  assert.equal(blockerJson.includes('base photo'), false);
  assert.equal(blockerJson.includes('seo'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(remote.files['wp-content/uploads/gallery/photo.txt'], { type: 'directory' });
  assert.equal(Object.hasOwn(remote.db.wp_posts, 'ID:1'), false);
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(remote.plugins, 'seo'), false);
});

test('blocks plugin-owned deletes while preserving matching independent deletions, edits, type swaps, and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };

  const remote = baseSite();
  delete remote.files['index.php'];
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';
  remote.plugins.seo = { version: '1.0.0', active: true };
  remote.files['wp-content/plugins/seo/seo.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const remoteOnlyPluginDecision = decisionFor(plan, 'plugin:seo');
  const remoteOnlyPluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/seo/seo.php');
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(fileDelete, undefined);
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(remoteOnlyPluginDecision.decision, 'keep-remote');
  assert.equal(remoteOnlyPluginFileDecision.decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blockerJson.includes('Shared independent title'), false);
  assert.equal(blockerJson.includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.files, 'index.php'), false);
  assert.equal(Object.hasOwn(remote.db.wp_posts, 'ID:1'), false);
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(remote.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/seo/seo.php'], '<?php /* remote-only plugin drift */');
});

test('blocks plugin-owned deletes when the owner plugin was removed remotely while preserving matching independent delete, edit, type swap, and remote-only plugin drift with bounded evidence', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.db.wp_posts['ID:1'] = { ID: 1, post_title: 'Base post title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete local.db.wp_posts['ID:1'];
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete remote.db.wp_posts['ID:1'];
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];
  remote.plugins.seo = { version: '1.0.0', active: true };
  remote.files['wp-content/plugins/seo/seo.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const remoteOnlyPluginDecision = decisionFor(plan, 'plugin:seo');
  const remoteOnlyPluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/seo/seo.php');
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(remoteOnlyPluginDecision.decision, 'keep-remote');
  assert.equal(remoteOnlyPluginFileDecision.decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.ownerContext.length, 2);
  assert.equal(blocker.ownerContextTruncated, false);
  assert.equal(blockerJson.includes('shared about'), false);
  assert.equal(blockerJson.includes('base photo'), false);
  assert.equal(blockerJson.includes('remote-only plugin drift'), false);
  assert.equal(blockerJson.includes('plugin:seo'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.files, 'index.php'), true);
  assert.equal(Object.hasOwn(remote.db.wp_posts, 'ID:1'), false);
  assert.equal(remote.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(remote.files['wp-content/uploads/gallery/photo.txt'], { type: 'directory' });
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
  assert.equal(remote.plugins.seo.version, '1.0.0');
  assert.equal(remote.files['wp-content/plugins/seo/seo.php'], '<?php /* remote-only plugin drift */');
});

test('applies plugin-owned deletes when the owner context independently matches and remote-only plugin drift is preserved', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  const local = baseSite();
  local.plugins.forms.description = 'shared forms drift';
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* shared forms drift */';
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };
  const remote = baseSite();
  remote.plugins.forms.description = 'shared forms drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* shared forms drift */';
  remote.plugins.seo = { version: '1.0.0', active: true };
  remote.files['wp-content/plugins/seo/seo.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const remoteOnlyPluginDecision = decisionFor(plan, 'plugin:seo');
  const remoteOnlyPluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/seo/seo.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.action, 'delete');
  assert.equal(mutation.changeKind, 'delete');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(pluginDecision.decision, 'already-in-sync');
  assert.equal(pluginFileDecision.decision, 'already-in-sync');
  assert.equal(remoteOnlyPluginDecision.decision, 'keep-remote');
  assert.equal(remoteOnlyPluginFileDecision.decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.db.wp_options, 'option_name:forms_settings'), false);
  assert.equal(result.site.plugins.forms.description, 'shared forms drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* shared forms drift */');
  assert.equal(result.site.files['wp-content/plugins/seo/seo.php'], '<?php /* remote-only plugin drift */');
});

test('applies plugin-owned deletes when a matching independent edit and remote-only plugin drift are present', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared about";';
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blockerJson.includes('shared about'), false);

  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_options['option_name:forms_settings'].option_value.mode, 'base');
  assert.equal(remote.files['about.php'], '<?php echo "shared about";');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('applies plugin-owned deletes when a matching independent edit, file type swap, and remote-only plugin drift are present', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  remote.plugins.seo = { version: '1.0.0', active: true };
  remote.files['wp-content/plugins/seo/seo.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const remoteOnlyPluginDecision = decisionFor(plan, 'plugin:seo');
  const remoteOnlyPluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/seo/seo.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.action, 'delete');
  assert.equal(mutation.changeKind, 'delete');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(remoteOnlyPluginDecision.decision, 'keep-remote');
  assert.equal(remoteOnlyPluginFileDecision.decision, 'keep-remote');
  assert.equal(Object.hasOwn(result.site.db.wp_options, 'option_name:forms_settings'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery/photo.txt'].type, 'directory');
  assert.equal(result.site.files['wp-content/plugins/seo/seo.php'], '<?php /* remote-only plugin drift */');
});

test('applies plugin-owned deletes when remote-only plugin removals are present alongside a matching independent edit', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.plugins.seo = { version: '1.0.0', active: true };
  base.files['wp-content/plugins/seo/seo.php'] = '<?php /* base seo */';
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared about";';
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.plugins.seo;
  delete remote.files['wp-content/plugins/seo/seo.php'];

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const removedPluginDecision = decisionFor(plan, 'plugin:seo');
  const removedPluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/seo/seo.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.action, 'delete');
  assert.equal(mutation.changeKind, 'delete');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(removedPluginDecision.decision, 'already-in-sync');
  assert.equal(removedPluginDecision.change.localChange, 'delete');
  assert.equal(removedPluginDecision.change.remoteChange, 'delete');
  assert.equal(removedPluginFileDecision.decision, 'already-in-sync');
  assert.equal(removedPluginFileDecision.change.localChange, 'delete');
  assert.equal(removedPluginFileDecision.change.remoteChange, 'delete');
  assert.equal(Object.hasOwn(result.site.db.wp_options, 'option_name:forms_settings'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(Object.hasOwn(result.site.plugins, 'seo'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/seo/seo.php'), false);
});

test('blocks plugin-owned deletes when matching independent delete, restore, and file type swap are present', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/archive'] = { type: 'directory' };
  base.files['wp-content/uploads/archive/keep.txt'] = 'base archive bytes';
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/archive'] = 'shared replacement file';
  local.files['wp-content/uploads/archive/keep.txt'] = 'restored archive bytes';
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/archive'] = 'shared replacement file';
  remote.files['wp-content/uploads/archive/keep.txt'] = 'restored archive bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/archive');
  const matchingRestore = decisionFor(plan, 'file:wp-content/uploads/archive/keep.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutation, undefined);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.ok(blocker);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.equal(planJson.includes('shared about'), false);
  assert.equal(planJson.includes('restored archive bytes'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.db.wp_options, 'option_name:forms_settings'), true);
  assert.equal(remote.files['about.php'], '<?php echo "shared about";');
  assert.equal(remote.files['wp-content/uploads/archive'], 'shared replacement file');
  assert.equal(remote.files['wp-content/uploads/archive/keep.txt'], 'restored archive bytes');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('blocks plugin-owned updates when the owner plugin was removed remotely while preserving unrelated safe edits and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  local.files['index.php'] = '<?php echo "local ordinary edit";';
  local.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'local' },
    __pluginOwner: 'forms',
  };
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(resourceKey, 'forms', 'wp-option'),
    ),
  };

  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "local ordinary edit";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const editDecision = decisionFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(conflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.resourceKey, resourceKey);
  assert.equal(conflictJson.includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "local ordinary edit";');
  assert.equal(remote.plugins.forms, undefined);
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

test('blocks local featured-image references when the remote deleted the referenced post', () => {
  const resourceKey = 'row:["wp_postmeta","meta_id:46"]';
  const targetResourceKey = 'row:["wp_posts","ID:2"]';
  const base = baseSite();
  base.db.wp_postmeta = {};
  base.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'base featured image target',
    post_content: 'base featured image body',
    post_status: 'publish',
  };
  base.db.wp_postmeta['meta_id:46'] = {
    meta_id: 46,
    post_id: 2,
    meta_key: '_thumbnail_id',
    meta_value: 2,
    note: 'base featured image note',
  };
  const local = baseSite();
  local.db.wp_postmeta = {};
  local.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'base featured image target',
    post_content: 'base featured image body',
    post_status: 'publish',
  };
  local.db.wp_postmeta['meta_id:46'] = {
    meta_id: 46,
    post_id: 2,
    meta_key: '_thumbnail_id',
    meta_value: 2,
    note: 'local featured image note',
  };
  const remote = baseSite();
  remote.db.wp_postmeta = {};
  remote.db.wp_posts['ID:2'] = {
    ID: 2,
    post_title: 'base featured image target',
    post_content: 'base featured image body',
    post_status: 'publish',
  };
  remote.db.wp_postmeta['meta_id:46'] = {
    meta_id: 46,
    post_id: 2,
    meta_key: '_thumbnail_id',
    meta_value: 2,
    note: 'base featured image note',
  };
  delete remote.db.wp_posts['ID:2'];

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
  assert.equal(reference.relationshipKey, 'wp_postmeta.post_id');
  assert.equal(reference.relationshipType, 'postmeta-post');
  assert.equal(reference.targetResourceKey, targetResourceKey);
  assert.equal(reference.targetChange.remoteChange, 'delete');
  assert.equal(reference.targetRemoteHash.length, 64);
  assert.equal(planJson.includes('base featured image target'), false);
  assert.equal(planJson.includes('base featured image body'), false);
  assert.equal(planJson.includes('local featured image note'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.db.wp_posts['ID:2'], undefined);
});

test('blocks a file type swap that would hide a live remote descendant while preserving remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant bytes';
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const evidence = plan.conflicts[0] || plan.blockers[0];
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations >= 0, true);
  assert.equal(plan.summary.blockers + plan.summary.conflicts > 0, true);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery').action, 'put');
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery').changeKind, 'type-change');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(evidence.class, 'file-conflict');
  assert.equal(evidence.resourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(evidenceJson.includes('base descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
});

test('blocks a file delete that would hide a live remote descendant while preserving matching independent edits and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant bytes';
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const evidence = plan.conflicts[0] || plan.blockers[0];
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(evidence.class, 'file-conflict');
  assert.equal(evidence.resourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(evidenceJson.includes('base descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
});

test('blocks a file delete that would hide a live remote descendant while preserving a matching edit and remote-only plugin drift with bounded evidence', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant bytes';
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const evidence = plan.conflicts[0] || plan.blockers[0];
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(evidence.class, 'file-conflict');
  assert.equal(evidence.resourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(evidenceJson.includes('base descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['wp-content/uploads/gallery/keep.txt'], 'remote descendant bytes');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
});

test('blocks a file delete that would hide a live remote descendant while preserving remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const evidence = plan.conflicts[0] || plan.blockers[0];
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(evidence.class, 'file-conflict');
  assert.equal(evidence.resourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(evidenceJson.includes('base descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
});

test('blocks a file delete that would hide a live remote descendant while preserving matching independent delete, edit, type swap, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Base post 5', post_status: 'publish' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Shared post 5', post_status: 'publish' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant bytes';
  delete remote.files['index.php'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Shared post 5', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const evidence = plan.conflicts[0] || plan.blockers[0];
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(decisionFor(plan, 'file:index.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'row:["wp_posts","ID:5"]').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(evidence.class, 'file-conflict');
  assert.equal(evidence.resourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(evidenceJson.includes('base descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote-only plugin drift'), false);
  assert.equal(plan.preconditions.length, 0);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
});

test('blocks a file type swap that would hide a live remote descendant while preserving a matching independent edit and remote-only plugin removal', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant bytes';
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const evidence = plan.conflicts[0] || plan.blockers[0];
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery').action, 'put');
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery').changeKind, 'type-change');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
  assert.equal(evidence.class, 'file-conflict');
  assert.equal(evidence.resourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(evidenceJson.includes('base descendant bytes'), false);
  assert.equal(evidenceJson.includes('remote descendant bytes'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
});

test('blocks a file type swap that would hide a live remote descendant while preserving matching independent delete, edit, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Base post 5', post_status: 'publish' };

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Shared post 5', post_status: 'publish' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant bytes';
  delete remote.files['index.php'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Shared post 5', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:5"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(conflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflictJson.includes('base descendant bytes'), false);
  assert.equal(conflictJson.includes('remote descendant bytes'), false);
  assert.equal(conflictJson.includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
});

test('blocks a direct file conflict while preserving an unrelated live delete and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "local about";';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "remote about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const evidence = plan.conflicts[0] || plan.blockers[0];
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.action, 'delete');
  assert.equal(mutation.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(evidence.class, 'file-conflict');
  assert.equal(evidence.resourceKey, 'file:about.php');
  assert.equal(evidenceJson.includes('local about'), false);
  assert.equal(evidenceJson.includes('remote about'), false);
  assert.equal(evidenceJson.includes('remote-only plugin drift'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and file type swap preserve matching independent edits and deletions', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/keep.txt'];

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.files['wp-content/uploads/gallery/keep.txt'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');

  assert.equal(plan.status, 'ready');
  assert.ok(deleteMutation);
  assert.ok(typeSwapMutation);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/keep.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and file type swap apply with matching independent edit preservation', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/keep.txt'];

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.files['wp-content/uploads/gallery/keep.txt'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.ok(deleteMutation);
  assert.ok(typeSwapMutation);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:wp-content/uploads/gallery/keep.txt').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery'], { type: 'directory' });
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/keep.txt'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('blocks plugin-owned deletes when a matching independent edit, file type swap, and remote-only plugin drift are present', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy({
      resourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      allowDelete: true,
    }),
  };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery/photo.txt');

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutation, undefined);
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');

  assert.equal(plan.blockers[0].class, 'stale-plugin-owner-context');
  assert.equal(plan.blockers[0].resourceKey, resourceKey);
  assert.equal(plan.blockers[0].ownerContext.some((entry) => entry.resourceKey === 'plugin:forms'), true);
  assert.equal(plan.blockers[0].ownerContext.some((entry) => entry.resourceKey === 'file:wp-content/plugins/forms/forms.php'), true);
  assert.equal(JSON.stringify(plan.blockers).includes('remote-only plugin drift'), false);
});

test('blocks a plugin-owned delete without ownership metadata while preserving matching independent delete, edit, type swap, and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.files['wp-content/uploads/archive'] = 'base archive file';
  base.files['wp-content/uploads/archive/keep.txt'] = 'base archive bytes';
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base shared title 3', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_options['option_name:forms_settings'];
  local.files['wp-content/uploads/archive'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared shared title', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared shared title 3', post_status: 'publish' };

  const remote = baseSite();
  remote.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };
  remote.files['wp-content/uploads/archive'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared shared title', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared shared title 3', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/archive');
  const matchingDelete = decisionFor(plan, 'file:wp-content/uploads/archive/keep.txt');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingEditTwo = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutation, undefined);
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingEditTwo.decision, 'already-in-sync');
  assert.equal(matchingEditTwo.change.localChange, 'update');
  assert.equal(matchingEditTwo.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.ok(blocker);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.reason.includes('not covered by a supported resource driver policy'), true);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.equal(planJson.includes('Shared shared title'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.db.wp_options, 'option_name:forms_settings'), true);
  assert.deepEqual(remote.files['wp-content/uploads/archive'], { type: 'directory' });
  assert.equal(remote.db.wp_posts['ID:2'].post_title, 'Shared shared title');
  assert.equal(remote.db.wp_posts['ID:3'].post_title, 'Shared shared title 3');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent restore stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/archive/keep.txt'] = 'base archive bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/archive/keep.txt'] = 'restored archive bytes';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/archive/keep.txt'] = 'restored archive bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingRestore = decisionFor(plan, 'file:wp-content/uploads/archive/keep.txt');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(decisionFor(plan, 'file:about.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/archive/keep.txt'], 'restored archive bytes');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/cover.txt'] = 'shared gallery file';
  base.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base descendant';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared independent edit";';
  local.files['wp-content/uploads/gallery/cover.txt'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.txt/keep.txt'];

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared independent edit";';
  remote.files['wp-content/uploads/gallery/cover.txt'] = 'shared gallery file';
  remote.files['wp-content/uploads/gallery/cover.txt/keep.txt'] = 'base descendant';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);

  const deleteMutation = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery/cover.txt');

  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);

  assert.equal(result.site.files['about.php'], '<?php echo "shared independent edit";');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery/cover.txt'], { type: 'directory' });
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/archive'] = 'base archive bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/archive'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/archive'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/archive');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/archive'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete and matching independent edit stay safe', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent delete, and matching independent file type swap stay safe', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery/photo.txt'], { type: 'directory' });
  assert.equal(result.site.plugins.forms, undefined);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned delete and matching independent delete stay safe', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/notes.txt'] = 'base notes';

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/notes.txt'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = JSON.parse(JSON.stringify(base));
  delete remote.files['wp-content/uploads/notes.txt'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'file:wp-content/uploads/notes.txt');
  const matchingEdit = decisionFor(plan, 'file:about.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/notes.txt'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
});

test('keeps remote-only plugin changes while a matching independent delete stays already-in-sync', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/notes.txt'] = 'base notes';

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['wp-content/uploads/notes.txt'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = JSON.parse(JSON.stringify(base));
  delete remote.files['index.php'];
  delete remote.files['wp-content/uploads/notes.txt'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'file:wp-content/uploads/notes.txt');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteMutation, undefined);
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.preconditions.length, 0);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/notes.txt'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a matching file delete stays already-in-sync', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];

  const remote = baseSite();
  delete remote.files['index.php'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteDecision = decisionFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(deleteDecision.decision, 'already-in-sync');
  assert.equal(deleteDecision.change.localChange, 'delete');
  assert.equal(deleteDecision.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.equal(plan.preconditions.length, 0);
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, delete, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['legacy.txt'] = 'base legacy';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  delete local.files['legacy.txt'];
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const deleteMutationTwo = mutationFor(plan, 'file:legacy.txt');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery/photo.txt');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 3);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(deleteMutationTwo.action, 'delete');
  assert.equal(deleteMutationTwo.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'plugin:forms').decision, 'keep-remote');
  assert.equal(decisionFor(plan, 'file:wp-content/plugins/forms/forms.php').decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(Object.hasOwn(result.site.files, 'legacy.txt'), false);
  assert.deepEqual(result.site.files['wp-content/uploads/gallery/photo.txt'], { type: 'directory' });
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery/photo.txt'], { type: 'directory' });
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned row delete and matching independent edit and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.db.wp_options['option_name:reprint_push_row_fixture_delete'] = {
    option_name: 'reprint_push_row_fixture_delete',
    option_value: { mode: 'base' },
  };
  base.db.wp_options['option_name:reprint_push_row_fixture_shared'] = {
    option_name: 'reprint_push_row_fixture_shared',
    option_value: { mode: 'base-shared' },
  };

  const local = baseSite();
  delete local.db.wp_options['option_name:reprint_push_row_fixture_delete'];
  local.db.wp_options['option_name:reprint_push_row_fixture_shared'] = {
    option_name: 'reprint_push_row_fixture_shared',
    option_value: { mode: 'shared' },
  };
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.db.wp_options['option_name:reprint_push_row_fixture_shared'] = {
    option_name: 'reprint_push_row_fixture_shared',
    option_value: { mode: 'shared' },
  };
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDeleteMutation = mutationFor(plan, 'row:["wp_options","option_name:reprint_push_row_fixture_delete"]');
  const matchingRow = decisionFor(plan, 'row:["wp_options","option_name:reprint_push_row_fixture_shared"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(rowDeleteMutation.action, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingRow.decision, 'already-in-sync');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.db.wp_options, 'option_name:reprint_push_row_fixture_delete'), false);
  assert.equal(result.site.db.wp_options['option_name:reprint_push_row_fixture_shared'].option_value.mode, 'shared');
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery/photo.txt'], { type: 'directory' });
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent edit and delete, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.files['wp-content/uploads/notes.txt'] = 'base notes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  delete local.files['wp-content/uploads/notes.txt'];
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.files['wp-content/uploads/notes.txt'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingDelete = decisionFor(plan, 'file:wp-content/uploads/notes.txt');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/notes.txt'), false);
  assert.deepEqual(result.site.files['wp-content/uploads/gallery/photo.txt'], { type: 'directory' });
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent row deletion, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.db.wp_options['option_name:reprint_push_file_delete_fixture'] = {
    option_name: 'reprint_push_file_delete_fixture',
    option_value: { mode: 'base' },
  };
  base.db.wp_options['option_name:reprint_push_file_shared_fixture'] = {
    option_name: 'reprint_push_file_shared_fixture',
    option_value: { mode: 'base-shared' },
  };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_options['option_name:reprint_push_file_delete_fixture'];
  local.db.wp_options['option_name:reprint_push_file_shared_fixture'] = {
    option_name: 'reprint_push_file_shared_fixture',
    option_value: { mode: 'shared' },
  };
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };

  const remote = JSON.parse(JSON.stringify(base));
  delete remote.db.wp_options['option_name:reprint_push_file_delete_fixture'];
  remote.db.wp_options['option_name:reprint_push_file_shared_fixture'] = {
    option_name: 'reprint_push_file_shared_fixture',
    option_value: { mode: 'shared' },
  };
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_options","option_name:reprint_push_file_delete_fixture"]');
  const matchingRow = decisionFor(plan, 'row:["wp_options","option_name:reprint_push_file_shared_fixture"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRow.decision, 'already-in-sync');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_options, 'option_name:reprint_push_file_delete_fixture'), false);
  assert.equal(result.site.db.wp_options['option_name:reprint_push_file_shared_fixture'].option_value.mode, 'shared');
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery/photo.txt'], { type: 'directory' });
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent restore, and matching type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery/photo.txt'] = 'base photo';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery/photo.txt'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const deleteMutation = mutationFor(plan, 'file:index.php');
  const matchingRestore = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery/photo.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(deleteMutation.action, 'delete');
  assert.equal(deleteMutation.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored title');
  assert.deepEqual(result.site.files['wp-content/uploads/gallery/photo.txt'], { type: 'directory' });
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('stops a file delete conflict while preserving remote-only plugin removals and matching independent edits', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';

  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "Remote secret file update";';
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const conflictJson = JSON.stringify(conflict);
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:index.php');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(conflictJson.includes('Remote secret file update'), false);
  assert.equal(conflictJson.includes('shared about'), false);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "Remote secret file update";');
  assert.equal(remote.files['about.php'], '<?php echo "shared about";');
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(remote.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('stops a file delete conflict while preserving remote-only plugin removals and matching independent delete, restore, edit, and type swap', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.files['wp-content/uploads/archive'] = { type: 'directory' };
  base.files['wp-content/uploads/archive/keep.txt'] = 'base archive bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.files['wp-content/uploads/archive'] = 'shared archive file';

  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "Remote secret file update";';
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.files['wp-content/uploads/archive'] = 'shared archive file';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const conflictJson = JSON.stringify(conflict);
  const matchingDelete = decisionFor(plan, 'file:wp-content/uploads/archive/keep.txt');
  const matchingRestore = decisionFor(plan, 'file:wp-content/uploads/archive');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:index.php');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(conflictJson.includes('Remote secret file update'), false);
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'type-change');
  assert.equal(matchingRestore.change.remoteChange, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "Remote secret file update";');
  assert.equal(remote.files['about.php'], '<?php echo "shared about";');
  assert.equal(remote.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(remote.files['wp-content/uploads/archive'], 'shared archive file');
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(remote.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('stops a file delete conflict while preserving remote-only plugin drift and matching independent delete, restore, edit, and type swap', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.files['wp-content/uploads/archive'] = { type: 'directory' };
  base.files['wp-content/uploads/archive/keep.txt'] = 'base archive bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.files['wp-content/uploads/archive'] = 'shared archive file';

  const remote = baseSite();
  remote.files['index.php'] = '<?php echo "Remote secret file update";';
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.files['wp-content/uploads/archive'] = 'shared archive file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts[0];
  const conflictJson = JSON.stringify(conflict);
  const matchingDelete = decisionFor(plan, 'file:wp-content/uploads/archive/keep.txt');
  const matchingRestore = decisionFor(plan, 'file:wp-content/uploads/archive');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.resourceKey, 'file:index.php');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(conflictJson.includes('Remote secret file update'), false);
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'type-change');
  assert.equal(matchingRestore.change.remoteChange, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['index.php'], '<?php echo "Remote secret file update";');
  assert.equal(remote.files['about.php'], '<?php echo "shared about";');
  assert.equal(remote.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(remote.files['wp-content/uploads/archive'], 'shared archive file');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
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

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent delete, edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDeleteDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowDeleteDecision.decision, 'already-in-sync');
  assert.equal(rowDeleteDecision.change.localChange, 'delete');
  assert.equal(rowDeleteDecision.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent delete, edit, and file type swap stay safe', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent row restore, edit, and type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent edit, and matching independent file type swap stay safe', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.deepEqual(result.site.files['wp-content/uploads/cover'], { type: 'directory' });
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent delete, and matching independent type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin drift while live-preconditioned file and row deletes coexist with a matching independent type swap', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDeleteDecision = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const editDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(fileDelete.resourceKey, 'file:index.php');
  assert.equal(rowDeleteDecision.decision, 'already-in-sync');
  assert.equal(rowDeleteDecision.change.localChange, 'delete');
  assert.equal(rowDeleteDecision.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared independent title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent restore, and matching independent file type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base delete title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  delete local.db.wp_posts['ID:3'];

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  delete remote.db.wp_posts['ID:3'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const independentDelete = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(independentDelete.decision, 'already-in-sync');
  assert.equal(independentDelete.change.localChange, 'delete');
  assert.equal(independentDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored title');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:3'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned delete, matching independent restore, matching independent delete, and matching independent type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base delete title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  delete local.db.wp_posts['ID:3'];

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  delete remote.db.wp_posts['ID:3'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const independentDelete = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(independentDelete.decision, 'already-in-sync');
  assert.equal(independentDelete.change.localChange, 'delete');
  assert.equal(independentDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored title');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:3'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned row delete, matching independent row restore, and matching independent file type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base delete title', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  delete local.db.wp_posts['ID:3'];

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored title');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:3'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned delete, matching independent delete, restore, and file type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base delete title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  delete local.db.wp_posts['ID:3'];

  const remote = baseSite();
  delete remote.db.wp_posts['ID:1'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  delete remote.db.wp_posts['ID:3'];
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingRestore = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingIndependentDelete = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(matchingIndependentDelete.decision, 'already-in-sync');
  assert.equal(matchingIndependentDelete.change.localChange, 'delete');
  assert.equal(matchingIndependentDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored title');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:3'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('recognizes matching independent file deletions as already in sync while remote-only plugin drift is preserved', () => {
  const base = baseSite();
  const local = baseSite();
  delete local.files['index.php'];
  const remote = baseSite();
  delete remote.files['index.php'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(fileDelete, undefined);
  assert.equal(decisionFor(plan, 'file:index.php').decision, 'already-in-sync');
  assert.equal(decisionFor(plan, 'file:index.php').change.localChange, 'delete');
  assert.equal(decisionFor(plan, 'file:index.php').change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('recognizes matching independent file restores as already in sync while remote-only plugin drift is preserved', () => {
  const base = baseSite();
  base.files['wp-content/uploads/archive/keep.txt'] = 'base archive bytes';

  const local = baseSite();
  local.files['wp-content/uploads/archive/keep.txt'] = 'restored archive bytes';

  const remote = baseSite();
  remote.files['wp-content/uploads/archive/keep.txt'] = 'restored archive bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const restoreDecision = decisionFor(plan, 'file:wp-content/uploads/archive/keep.txt');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/archive/keep.txt'), undefined);
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  const result = applyPlan(remote, plan);
  assert.equal(result.site.files['wp-content/uploads/archive/keep.txt'], 'restored archive bytes');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent row restore, and matching file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored title');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a matching independent plugin-owned update stays in sync', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  local.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'shared' },
    __pluginOwner: 'forms',
  };

  const remote = baseSite();
  remote.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'shared' },
    __pluginOwner: 'forms',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const updateDecision = decisionFor(plan, resourceKey);
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(updateDecision.decision, 'already-in-sync');
  assert.equal(updateDecision.change.localChange, 'update');
  assert.equal(updateDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'shared');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent file delete, and file type swap stay safe', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent restore, and matching independent type swap stay safe', () => {
  const base = baseSite();
  base.files['wp-content/uploads/archive'] = { type: 'directory' };
  base.files['wp-content/uploads/archive/keep.txt'] = 'base archive bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base restored title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['wp-content/uploads/archive'] = 'shared replacement file';
  local.files['wp-content/uploads/archive/keep.txt'] = 'restored archive bytes';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/archive'] = 'shared replacement file';
  remote.files['wp-content/uploads/archive/keep.txt'] = 'restored archive bytes';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared restored title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:wp-content/uploads/archive/keep.txt');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/archive');
  const rowRestoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'update');
  assert.equal(restoreDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(rowRestoreDecision.decision, 'already-in-sync');
  assert.equal(rowRestoreDecision.change.localChange, 'update');
  assert.equal(rowRestoreDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['wp-content/uploads/archive'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/uploads/archive/keep.txt'], 'restored archive bytes');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared restored title');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a local file delete conflict while preserving matching remote-only plugin drift', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';

  const local = baseSite();
  delete local.files['about.php'];

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "remote about";';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:about.php'), undefined);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.reason, 'Local and remote both changed this resource after the pull base.');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('<?php echo "remote about";'), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.equal(planJson.includes('base about'), false);
  assert.equal(plan.preconditions.length, 0);
});

test('stops a local file delete conflict while preserving a matching independent edit, type swap, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Base matched title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['about.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Shared matched title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "remote about";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Shared matched title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:5"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:about.php'), undefined);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.reason, 'Local and remote both changed this resource after the pull base.');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('<?php echo "remote about";'), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.equal(planJson.includes('Shared matched title'), false);
});

test('stops a local file delete conflict while preserving matching independent edit, type swap, and remote-only plugin change', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Base matched title', post_status: 'publish' };

  const local = baseSite();
  delete local.files['about.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Shared matched title', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "remote about";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Shared matched title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:5"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const planJson = JSON.stringify(plan);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:about.php'), undefined);
  assert.equal(conflict.class, 'file-conflict');
  assert.equal(conflict.reason, 'Local and remote both changed this resource after the pull base.');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(planJson.includes('<?php echo "remote about";'), false);
  assert.equal(planJson.includes('remote-only plugin drift'), false);
  assert.equal(planJson.includes('Shared matched title'), false);
  assert.equal(plan.preconditions.length, 0);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.files['about.php'], '<?php echo "remote about";');
  assert.equal(remote.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(remote.db.wp_posts['ID:5'].post_title, 'Shared matched title');
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(remote.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('blocks a plugin-owned delete while preserving matching independent edit, file type swap, and remote-only plugin drift', () => {
  const resourceKey = 'row:["wp_options","option_name:forms_settings"]';
  const base = baseSite();
  base.meta = pluginOwnedResourcePolicy(
    allowedPluginOwnedResource(resourceKey, 'forms'),
  );
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base', token: 'plugin-owned-secret' },
    __pluginOwner: 'forms',
  };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base shared title', post_status: 'publish' };

  const local = baseSite();
  local.meta = pluginOwnedResourcePolicy(
    allowedPluginOwnedResource(resourceKey, 'forms'),
  );
  delete local.db.wp_options['option_name:forms_settings'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };

  const remote = baseSite();
  remote.meta = pluginOwnedResourcePolicy(
    allowedPluginOwnedResource(resourceKey, 'forms'),
  );
  remote.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'base' },
    __pluginOwner: 'forms',
  };
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared independent title', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const planJson = JSON.stringify(plan);
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const rowDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey)
    ?? plan.conflicts.find((entry) => entry.resourceKey === resourceKey);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, resourceKey), undefined);
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(rowDecision.decision, 'already-in-sync');
  assert.equal(rowDecision.change.localChange, 'update');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.ok(blocker);
  assert.equal(planJson.includes('plugin-owned-secret'), false);
  assert.equal(planJson.includes('Base shared title'), false);
  assert.equal(plan.mutations.length, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(plan.blockers.length + plan.conflicts.length, 1);
});

test('blocks a file type swap that would hide a live remote descendant while preserving matching independent delete, edit, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Base matched title', post_status: 'publish' };

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Shared matched title', post_status: 'publish' };
  delete local.files['index.php'];

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant';
  remote.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Shared matched title', post_status: 'publish' };
  delete remote.files['index.php'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const typeSwapConflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const matchingDeleteDecision = decisionFor(plan, 'file:index.php');
  const matchingEditDecision = decisionFor(plan, 'row:["wp_posts","ID:5"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(typeSwapConflict.class, 'file-topology-conflict');
  assert.equal(typeSwapConflict.relatedChange.localChange, 'delete');
  assert.equal(typeSwapConflict.relatedChange.remoteChange, 'update');
  assert.equal(matchingDeleteDecision.decision, 'already-in-sync');
  assert.equal(matchingDeleteDecision.change.localChange, 'delete');
  assert.equal(matchingDeleteDecision.change.remoteChange, 'delete');
  assert.equal(matchingEditDecision.decision, 'already-in-sync');
  assert.equal(matchingEditDecision.change.localChange, 'update');
  assert.equal(matchingEditDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.mutations.length, 0);
  assert.equal(plan.preconditions.length, 0);
});

test('blocks a file delete that would hide a live remote descendant while preserving matching independent delete, restore, edit, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = 'base gallery file';
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant bytes';
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:8'] = { ID: 8, post_title: 'Base matched title 8', post_status: 'publish' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  delete local.files['wp-content/uploads/gallery/keep.txt'];
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:8'] = { ID: 8, post_title: 'Shared matched title 8', post_status: 'publish' };

  const remote = JSON.parse(JSON.stringify(base));
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant bytes';
  delete remote.files['index.php'];
  remote.files['about.php'] = '<?php echo "shared about";';
  delete remote.db.wp_posts['ID:1'];
  remote.db.wp_posts['ID:8'] = { ID: 8, post_title: 'Shared matched title 8', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteConflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const matchingDelete = decisionFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingRestore = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:8"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(deleteConflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(deleteConflict.class, 'file-topology-conflict');
  assert.equal(deleteConflict.relatedResourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(conflictJson.includes('base descendant bytes'), false);
  assert.equal(conflictJson.includes('remote descendant bytes'), false);
  assert.equal(conflictJson.includes('remote-only plugin drift'), false);
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'delete');
  assert.equal(matchingRestore.change.remoteChange, 'delete');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.mutations.length, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(remote.plugins.forms.description, 'remote-only plugin drift');
});

test('blocks a file delete that would hide a live remote descendant while preserving matching independent edit, type swap, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.db.wp_posts['ID:6'] = { ID: 6, post_title: 'Base matched title 6', post_status: 'publish' };

  const local = baseSite();
  delete local.files['wp-content/uploads/gallery'];
  local.db.wp_posts['ID:6'] = { ID: 6, post_title: 'Shared matched title 6', post_status: 'publish' };
  local.files['wp-content/uploads/cover'] = 'shared cover bytes';

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant';
  remote.db.wp_posts['ID:6'] = { ID: 6, post_title: 'Shared matched title 6', post_status: 'publish' };
  remote.files['wp-content/uploads/cover'] = 'shared cover bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const deleteConflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const matchingEditDecision = decisionFor(plan, 'row:["wp_posts","ID:6"]');
  const matchingTypeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(deleteConflict.class, 'file-topology-conflict');
  assert.equal(deleteConflict.relatedChange.localChange, 'delete');
  assert.equal(deleteConflict.relatedChange.remoteChange, 'update');
  assert.equal(matchingEditDecision.decision, 'already-in-sync');
  assert.equal(matchingEditDecision.change.localChange, 'update');
  assert.equal(matchingEditDecision.change.remoteChange, 'update');
  assert.equal(matchingTypeSwapDecision.decision, 'already-in-sync');
  assert.equal(matchingTypeSwapDecision.change.localChange, 'create');
  assert.equal(matchingTypeSwapDecision.change.remoteChange, 'create');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.mutations.length, 0);
  assert.equal(plan.preconditions.length, 0);
});

test('blocks a file type swap that would hide a live remote descendant while preserving a matching independent delete, edit, restore, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.db.wp_posts['ID:7'] = { ID: 7, post_title: 'Base matched title 7', post_status: 'publish' };
  base.db.wp_posts['ID:8'] = { ID: 8, post_title: 'Base matched title 8', post_status: 'publish' };

  const local = baseSite();
  delete local.files['about.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:7'] = { ID: 7, post_title: 'Shared matched title 7', post_status: 'publish' };
  local.db.wp_posts['ID:8'] = { ID: 8, post_title: 'Shared matched title 8', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "base about";';
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant';
  remote.db.wp_posts['ID:7'] = { ID: 7, post_title: 'Shared matched title 7', post_status: 'publish' };
  remote.db.wp_posts['ID:8'] = { ID: 8, post_title: 'Shared matched title 8', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const typeSwapConflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const matchingDelete = mutationFor(plan, 'file:about.php');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:7"]');
  const matchingRestore = decisionFor(plan, 'row:["wp_posts","ID:8"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 1);
  assert.ok(matchingDelete);
  assert.equal(matchingDelete.action, 'delete');
  assert.equal(matchingDelete.changeKind, 'delete');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(typeSwapConflict.class, 'file-topology-conflict');
  assert.equal(typeSwapConflict.relatedChange.localChange, 'delete');
  assert.equal(typeSwapConflict.relatedChange.remoteChange, 'update');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.mutations.length, 1);
  assert.equal(plan.preconditions.length, 1);
});

test('blocks a file type swap that would hide a live remote descendant while preserving a matching independent edit and remote-only plugin removal', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.db.wp_posts['ID:9'] = { ID: 9, post_title: 'Base matched title 9', post_status: 'publish' };

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:9'] = { ID: 9, post_title: 'Shared matched title 9', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant';
  remote.db.wp_posts['ID:9'] = { ID: 9, post_title: 'Shared matched title 9', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const typeSwapConflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:9"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(typeSwapConflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(typeSwapConflict.class, 'file-topology-conflict');
  assert.equal(typeSwapConflict.relatedResourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(conflictJson.includes('remote descendant bytes'), false);
  assert.equal(conflictJson.includes('shared replacement file'), false);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.mutations.length, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(remote.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('blocks a file type swap that would hide a live remote descendant while preserving a matching independent edit and remote-only plugin removal with bounded evidence', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.db.wp_posts['ID:10'] = { ID: 10, post_title: 'Base matched title 10', post_status: 'publish' };

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:10'] = { ID: 10, post_title: 'Shared matched title 10', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/keep.txt'] = 'remote descendant';
  remote.db.wp_posts['ID:10'] = { ID: 10, post_title: 'Shared matched title 10', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const typeSwapConflict = plan.conflicts.find((entry) => entry.resourceKey === 'file:wp-content/uploads/gallery');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:10"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const conflictJson = JSON.stringify(typeSwapConflict);

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, 'file:wp-content/uploads/gallery'), undefined);
  assert.equal(typeSwapConflict.class, 'file-topology-conflict');
  assert.equal(typeSwapConflict.resourceKey, 'file:wp-content/uploads/gallery');
  assert.equal(typeSwapConflict.relatedResourceKey, 'file:wp-content/uploads/gallery/keep.txt');
  assert.equal(typeSwapConflict.change.localChange, 'type-change');
  assert.equal(typeSwapConflict.relatedChange.remoteChange, 'update');
  assert.equal(conflictJson.includes('remote descendant bytes'), false);
  assert.equal(conflictJson.includes('remote about'), false);
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(plan.preconditions.length, 0);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply/);
  assert.equal(Object.hasOwn(remote.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(remote.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent edit, and matching independent type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin drift at the live release boundary while a ready delete plan preserves matching independent edits', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'basic' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const fileEditDecision = decisionFor(plan, 'file:about.php');
  const rowEditDecision = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(fileEditDecision.decision, 'already-in-sync');
  assert.equal(fileEditDecision.change.localChange, 'update');
  assert.equal(fileEditDecision.change.remoteChange, 'update');
  assert.equal(rowEditDecision.decision, 'already-in-sync');
  assert.equal(rowEditDecision.change.localChange, 'update');
  assert.equal(rowEditDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);

  const result = applyPlan(remote, plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin drift at the live release boundary while a ready delete plan preserves a matching plugin-owned resource', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'basic' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'shared' },
    __pluginOwner: 'forms',
  };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'shared' },
    __pluginOwner: 'forms',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const pluginOwnedDecision = decisionFor(plan, 'row:["wp_options","option_name:forms_settings"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(pluginOwnedDecision.decision, 'already-in-sync');
  assert.equal(pluginOwnedDecision.change.localChange, 'update');
  assert.equal(pluginOwnedDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'shared');
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].__pluginOwner, 'forms');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps same-remote release boundaries and refuses drift after a ready delete plan is computed', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(result.site.files['index.php'], undefined);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');

  const driftedRemote = baseSite();
  driftedRemote.files['about.php'] = '<?php echo "shared about";';
  driftedRemote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  driftedRemote.plugins.forms.description = 'remote-only plugin drift';
  driftedRemote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';
  driftedRemote.files['index.php'] = '<?php echo "remote drift";';

  const driftedError = captureError(() => applyPlan(driftedRemote, plan));

  assert.ok(driftedError instanceof PushPlanError);
  assert.equal(driftedError.code, 'PRECONDITION_FAILED');
  assert.equal(driftedRemote.files['index.php'], '<?php echo "remote drift";');
  assert.equal(driftedRemote.plugins.forms.description, 'remote-only plugin drift');
});

test('keeps remote-only plugin drift at the live release boundary while a ready delete plan preserves late plugin-owned drift', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'basic' },
    __pluginOwner: 'forms',
  };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'shared' },
    __pluginOwner: 'forms',
  };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'shared' },
    __pluginOwner: 'forms',
  };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(result.site.files['index.php'], undefined);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'shared');
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].__pluginOwner, 'forms');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');

  const driftedRemote = baseSite();
  driftedRemote.files['about.php'] = '<?php echo "shared about";';
  driftedRemote.db.wp_options['option_name:forms_settings'] = {
    option_name: 'forms_settings',
    option_value: { mode: 'shared' },
    __pluginOwner: 'forms',
  };
  driftedRemote.plugins.forms.description = 'remote-only plugin drift';
  driftedRemote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';
  driftedRemote.db.wp_options['option_name:forms_settings'].option_value.mode = 'late drift';

  const driftedResult = applyPlan(driftedRemote, plan);

  assert.equal(driftedResult.site.files['index.php'], undefined);
  assert.equal(driftedResult.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'late drift');
  assert.equal(driftedResult.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(driftedRemote.db.wp_options['option_name:forms_settings'].option_value.mode, 'late drift');
  assert.equal(driftedRemote.plugins.forms.description, 'remote-only plugin drift');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent file edit, row edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  local.db.wp_posts['ID:2'].post_title = 'Shared post 2';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.db.wp_posts['ID:2'].post_title = 'Shared post 2';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const fileEditDecision = decisionFor(plan, 'file:about.php');
  const rowEditDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(fileEditDecision.decision, 'already-in-sync');
  assert.equal(fileEditDecision.change.localChange, 'update');
  assert.equal(fileEditDecision.change.remoteChange, 'update');
  assert.equal(rowEditDecision.decision, 'already-in-sync');
  assert.equal(rowEditDecision.change.localChange, 'update');
  assert.equal(rowEditDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while live-preconditioned file and row deletes preserve matching independent edit and type swap', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:1'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const rowEditDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(rowEditDecision.decision, 'already-in-sync');
  assert.equal(rowEditDecision.change.localChange, 'update');
  assert.equal(rowEditDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent delete, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };

  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'file:about.php');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/keep.txt'] = 'base descendant';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const independentTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const rowEditDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(independentTypeSwap.decision, 'already-in-sync');
  assert.equal(independentTypeSwap.change.localChange, 'type-change');
  assert.equal(independentTypeSwap.change.remoteChange, 'type-change');
  assert.equal(rowEditDecision.decision, 'already-in-sync');
  assert.equal(rowEditDecision.change.localChange, 'update');
  assert.equal(rowEditDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent restore, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.files['wp-content/uploads/archive'] = { type: 'directory' };
  base.files['wp-content/uploads/archive/keep.txt'] = 'base archive bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.files['wp-content/uploads/archive'] = 'shared archive file';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.files['wp-content/uploads/archive'] = 'shared archive file';
  remote.plugins.forms.description = 'remote-only plugin change';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin change */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const restoreDecision = decisionFor(plan, 'file:wp-content/uploads/archive');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(restoreDecision.decision, 'already-in-sync');
  assert.equal(restoreDecision.change.localChange, 'type-change');
  assert.equal(restoreDecision.change.remoteChange, 'type-change');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.files['wp-content/uploads/archive'], 'shared archive file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin change');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin change */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent delete, restore, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const rowEditDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const rowRestoreDecision = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(rowEditDecision.decision, 'already-in-sync');
  assert.equal(rowEditDecision.change.localChange, 'update');
  assert.equal(rowEditDecision.change.remoteChange, 'update');
  assert.equal(rowRestoreDecision.decision, 'already-in-sync');
  assert.equal(rowRestoreDecision.change.localChange, 'update');
  assert.equal(rowRestoreDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent delete, edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };

  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'file:about.php');
  const matchingEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent file edit, and matching independent type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent delete, restore, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = { type: 'directory' };
  base.files['wp-content/uploads/cover/keep.txt'] = 'base descendant';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/cover'] = 'shared replacement file';
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/cover'] = 'shared replacement file';
  delete remote.db.wp_posts['ID:1'];
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingRowRestore = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(matchingRowRestore.decision, 'already-in-sync');
  assert.equal(matchingRowRestore.change.localChange, 'update');
  assert.equal(matchingRowRestore.change.remoteChange, 'update');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.equal(result.site.files['wp-content/uploads/cover'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned file delete and matching independent delete, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  delete remote.db.wp_posts['ID:1'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingFileEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingRowRestore = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingFileEdit.decision, 'already-in-sync');
  assert.equal(matchingFileEdit.change.localChange, 'update');
  assert.equal(matchingFileEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(matchingRowRestore.decision, 'already-in-sync');
  assert.equal(matchingRowRestore.change.localChange, 'update');
  assert.equal(matchingRowRestore.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned row delete, matching independent restore, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingFileEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingRowRestore = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(matchingFileEdit.decision, 'already-in-sync');
  assert.equal(matchingFileEdit.change.localChange, 'update');
  assert.equal(matchingFileEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(matchingRowRestore.decision, 'already-in-sync');
  assert.equal(matchingRowRestore.change.localChange, 'update');
  assert.equal(matchingRowRestore.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned row delete, matching independent row restore, edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const rowRestoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const rowEditDecision = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(rowRestoreDecision.decision, 'already-in-sync');
  assert.equal(rowRestoreDecision.change.localChange, 'update');
  assert.equal(rowRestoreDecision.change.remoteChange, 'update');
  assert.equal(rowEditDecision.decision, 'already-in-sync');
  assert.equal(rowEditDecision.change.localChange, 'update');
  assert.equal(rowEditDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent row restore, edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowRestoreDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowRestoreDecision.decision, 'already-in-sync');
  assert.equal(rowRestoreDecision.change.localChange, 'create');
  assert.equal(rowRestoreDecision.change.remoteChange, 'create');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned row delete, matching independent file delete, restore, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };
  base.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Base post 4', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:4'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Base post 4', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:4"]');
  const matchingFileDelete = decisionFor(plan, 'file:about.php');
  const matchingRowRestore = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(matchingRowRestore.decision, 'already-in-sync');
  assert.equal(matchingRowRestore.change.localChange, 'update');
  assert.equal(matchingRowRestore.change.remoteChange, 'update');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:4'), false);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent file type swap, and matching independent row delete stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete local.db.wp_posts['ID:2'];

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete remote.db.wp_posts['ID:2'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent edit, and matching independent file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned row delete, matching independent row delete, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };
  base.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Base post 4', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:4'];
  delete local.db.wp_posts['ID:2'];
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  delete remote.db.wp_posts['ID:2'];
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Base post 4', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:4"]');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:4'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned row delete, matching independent file delete, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  delete remote.files['index.php'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingFileDelete = decisionFor(plan, 'file:index.php');
  const matchingFileEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(matchingFileEdit.decision, 'already-in-sync');
  assert.equal(matchingFileEdit.change.localChange, 'update');
  assert.equal(matchingFileEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent delete, and matching independent type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.db.wp_posts['ID:2'];

  const remote = baseSite();
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.db.wp_posts['ID:2'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingDelete = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent edit, type swap, and row delete stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.db.wp_posts['ID:2'];

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete remote.db.wp_posts['ID:2'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent create, edit, restore, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.files['contact.php'] = '<?php echo "shared contact";';
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.files['contact.php'] = '<?php echo "shared contact";';
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const createDecision = decisionFor(plan, 'file:contact.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const rowEditDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const rowRestoreDecision = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(createDecision.decision, 'already-in-sync');
  assert.equal(createDecision.change.localChange, 'create');
  assert.equal(createDecision.change.remoteChange, 'create');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(rowEditDecision.decision, 'already-in-sync');
  assert.equal(rowEditDecision.change.localChange, 'update');
  assert.equal(rowEditDecision.change.remoteChange, 'update');
  assert.equal(rowRestoreDecision.decision, 'already-in-sync');
  assert.equal(rowRestoreDecision.change.localChange, 'update');
  assert.equal(rowRestoreDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.files['contact.php'], '<?php echo "shared contact";');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent row delete, restore, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete local.db.wp_posts['ID:1'];
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete remote.db.wp_posts['ID:1'];
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingRowRestore = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileEdit.decision, 'already-in-sync');
  assert.equal(matchingFileEdit.change.localChange, 'update');
  assert.equal(matchingFileEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(matchingRowRestore.decision, 'already-in-sync');
  assert.equal(matchingRowRestore.change.localChange, 'update');
  assert.equal(matchingRowRestore.change.remoteChange, 'update');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent edit, and matching independent type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent edit, matching independent type swap, and matching independent delete stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete local.db.wp_posts['ID:2'];

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.db.wp_posts['ID:2'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const editDecision = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const rowDeleteDecision = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(editDecision.decision, 'already-in-sync');
  assert.equal(editDecision.change.localChange, 'update');
  assert.equal(editDecision.change.remoteChange, 'update');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(rowDeleteDecision.decision, 'already-in-sync');
  assert.equal(rowDeleteDecision.change.localChange, 'delete');
  assert.equal(rowDeleteDecision.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while matching independent file and row deletes, restores, edits, and type swaps already match the live remote', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.files['contact.php'] = '<?php echo "base contact";';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['about.php'];
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.files['contact.php'] = '<?php echo "shared contact";';
  delete local.db.wp_posts['ID:1'];
  delete local.db.wp_posts['ID:2'];
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  delete remote.files['index.php'];
  delete remote.files['about.php'];
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.files['contact.php'] = '<?php echo "shared contact";';
  delete remote.db.wp_posts['ID:1'];
  delete remote.db.wp_posts['ID:2'];
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const indexDelete = decisionFor(plan, 'file:index.php');
  const aboutDelete = decisionFor(plan, 'file:about.php');
  const typeSwapDecision = decisionFor(plan, 'file:wp-content/uploads/cover');
  const contactEdit = decisionFor(plan, 'file:contact.php');
  const rowDelete = decisionFor(plan, 'row:["wp_posts","ID:1"]');
  const rowDelete2 = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const rowRestoreDecision = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(indexDelete.decision, 'already-in-sync');
  assert.equal(indexDelete.change.localChange, 'delete');
  assert.equal(indexDelete.change.remoteChange, 'delete');
  assert.equal(aboutDelete.decision, 'already-in-sync');
  assert.equal(aboutDelete.change.localChange, 'delete');
  assert.equal(aboutDelete.change.remoteChange, 'delete');
  assert.equal(typeSwapDecision.decision, 'already-in-sync');
  assert.equal(typeSwapDecision.change.localChange, 'type-change');
  assert.equal(typeSwapDecision.change.remoteChange, 'type-change');
  assert.equal(contactEdit.decision, 'already-in-sync');
  assert.equal(contactEdit.change.localChange, 'update');
  assert.equal(contactEdit.change.remoteChange, 'update');
  assert.equal(rowDelete.decision, 'already-in-sync');
  assert.equal(rowDelete.change.localChange, 'delete');
  assert.equal(rowDelete.change.remoteChange, 'delete');
  assert.equal(rowDelete2.decision, 'already-in-sync');
  assert.equal(rowDelete2.change.localChange, 'delete');
  assert.equal(rowDelete2.change.remoteChange, 'delete');
  assert.equal(rowRestoreDecision.decision, 'already-in-sync');
  assert.equal(rowRestoreDecision.change.localChange, 'update');
  assert.equal(rowRestoreDecision.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'about.php'), false);
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.files['contact.php'], '<?php echo "shared contact";');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned file delete, matching independent restore, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const matchingRowRestore = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingRowEdit = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowRestore.decision, 'already-in-sync');
  assert.equal(matchingRowRestore.change.localChange, 'update');
  assert.equal(matchingRowRestore.change.remoteChange, 'update');
  assert.equal(matchingRowEdit.decision, 'already-in-sync');
  assert.equal(matchingRowEdit.change.localChange, 'update');
  assert.equal(matchingRowEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned file delete, matching independent row delete, restore, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete local.db.wp_posts['ID:2'];

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  delete remote.db.wp_posts['ID:2'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent row delete stay safe with apply verification', () => {
  const base = baseSite();
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:2'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = 'shared replacement file';

  const remote = baseSite();
  delete remote.db.wp_posts['ID:2'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'shared replacement file';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'], 'shared replacement file');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned row delete, matching independent edit, and matching file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while a live-preconditioned file delete, matching independent restore, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  local.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Shared post 2', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/gallery');
  const matchingRowRestore = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(matchingRowRestore.decision, 'already-in-sync');
  assert.equal(matchingRowRestore.change.localChange, 'update');
  assert.equal(matchingRowRestore.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:2'].post_title, 'Shared post 2');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('allows a live-preconditioned directory delete when the live descendant is also deleted locally and remote-only plugin drift is preserved', () => {
  const base = baseSite();
  base.files['wp-content/uploads/gallery'] = { type: 'directory' };
  base.files['wp-content/uploads/gallery/cover.jpg'] = 'base descendant bytes';

  const local = baseSite();
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.files['wp-content/uploads/gallery/cover.jpg'];
  delete local.files['wp-content/uploads/gallery'];

  const remote = baseSite();
  remote.files['wp-content/uploads/gallery'] = { type: 'directory' };
  remote.files['wp-content/uploads/gallery/cover.jpg'] = 'base descendant bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const directoryDelete = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const descendantDelete = mutationFor(plan, 'file:wp-content/uploads/gallery/cover.jpg');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.blockers.length, 0);
  assert.equal(directoryDelete.action, 'delete');
  assert.equal(directoryDelete.changeKind, 'delete');
  assert.equal(descendantDelete.action, 'delete');
  assert.equal(descendantDelete.changeKind, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/uploads/gallery/cover.jpg'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while live-preconditioned file delete and type swap mutations preserve a matching independent edit', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = 'base cover bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/cover');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file type swap and matching independent edit stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = 'base cover bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/cover');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned file delete, matching independent edit, and file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = 'base cover bytes';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned row delete, matching independent row delete, restore, edit, and type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:2'] = { ID: 2, post_title: 'Base post 2', post_status: 'publish' };
  base.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Base post 3', post_status: 'publish' };

  const local = baseSite();
  delete local.db.wp_posts['ID:1'];
  delete local.db.wp_posts['ID:2'];
  local.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  delete remote.db.wp_posts['ID:2'];
  remote.db.wp_posts['ID:3'] = { ID: 3, post_title: 'Shared post 3', post_status: 'publish' };
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const rowDelete = mutationFor(plan, 'row:["wp_posts","ID:1"]');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:2"]');
  const matchingRowRestore = decisionFor(plan, 'row:["wp_posts","ID:3"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(rowDelete.action, 'delete');
  assert.equal(rowDelete.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(matchingRowRestore.decision, 'already-in-sync');
  assert.equal(matchingRowRestore.change.localChange, 'update');
  assert.equal(matchingRowRestore.change.remoteChange, 'update');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:1'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:2'), false);
  assert.equal(result.site.db.wp_posts['ID:3'].post_title, 'Shared post 3');
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned file delete, matching independent edit, and matching file type swap stay safe with apply verification', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin removals while live-preconditioned file delete and file type swap mutations preserve a matching independent edit', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = 'base cover bytes';
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/cover');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin changes while live-preconditioned file delete and file type swap mutations preserve a matching independent edit', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = 'base cover bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/cover');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and file type swap preserve a matching independent edit and still require live preconditions', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = 'base cover bytes';
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/cover');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
});

test('keeps remote-only plugin changes while a live-preconditioned file type swap preserves a matching independent edit and restore', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';
  base.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Base post 4', post_status: 'publish' };

  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  local.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Restored post 4', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'base gallery bytes';
  remote.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Restored post 4', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingRestore = decisionFor(plan, 'row:["wp_posts","ID:4"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(result.site.db.wp_posts['ID:4'].post_title, 'Restored post 4');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file type swap preserves a matching independent edit and delete', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/gallery'] = 'base gallery bytes';
  base.db.wp_posts['ID:7'] = { ID: 7, post_title: 'Base row 7', post_status: 'draft' };

  const local = baseSite();
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/gallery'] = { type: 'directory' };
  delete local.db.wp_posts['ID:7'];

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/gallery'] = 'base gallery bytes';
  delete remote.db.wp_posts['ID:7'];
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const typeSwapMutation = mutationFor(plan, 'file:wp-content/uploads/gallery');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingDelete = decisionFor(plan, 'row:["wp_posts","ID:7"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(typeSwapMutation.action, 'put');
  assert.equal(typeSwapMutation.changeKind, 'type-change');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingDelete.decision, 'already-in-sync');
  assert.equal(matchingDelete.change.localChange, 'delete');
  assert.equal(matchingDelete.change.remoteChange, 'delete');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/gallery'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:7'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while matching independent delete, edit, and file type swap stay already in sync beside a live-preconditioned file delete', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Base post 4', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:4'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  delete remote.db.wp_posts['ID:4'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingRowDelete = decisionFor(plan, 'row:["wp_posts","ID:4"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingRowDelete.decision, 'already-in-sync');
  assert.equal(matchingRowDelete.change.localChange, 'delete');
  assert.equal(matchingRowDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:4'), false);
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin changes while a live-preconditioned file delete and matching independent row delete preserve a matching independent edit and file type swap', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Base post 4', post_status: 'publish' };

  const local = baseSite();
  delete local.files['index.php'];
  delete local.db.wp_posts['ID:4'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  delete remote.db.wp_posts['ID:4'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const rowDelete = decisionFor(plan, 'row:["wp_posts","ID:4"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(rowDelete.decision, 'already-in-sync');
  assert.equal(rowDelete.change.localChange, 'delete');
  assert.equal(rowDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.db.wp_posts, 'ID:4'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('stops a directory delete that would hide a live remote descendant while preserving a matching independent delete, edit, type swap, and remote-only plugin drift', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['sidebar.php'] = '<?php echo "base sidebar";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.files['wp-content/uploads/cover/keep.txt'] = 'base descendant';
  base.files['wp-content/uploads/banner'] = 'base banner bytes';

  const local = baseSite();
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  delete local.files['wp-content/uploads/cover/keep.txt'];
  delete local.files['sidebar.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/banner'] = { type: 'directory' };

  const remote = baseSite();
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.files['wp-content/uploads/cover/keep.txt'] = 'remote descendant';
  delete remote.files['sidebar.php'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/banner'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const directoryMutation = mutationFor(plan, 'file:wp-content/uploads/cover');
  const matchingFileDelete = decisionFor(plan, 'file:sidebar.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');

  assert.equal(plan.status, 'conflict');
  assert.equal(plan.summary.conflicts > 0, true);
  assert.equal(directoryMutation, undefined);
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(plan.conflicts[0].class, 'file-conflict');
  assert.equal(plan.conflicts[0].change.base.state, 'present');
  assert.equal(plan.conflicts[0].change.remote.state, 'present');
  assert.equal(JSON.stringify(plan.conflicts[0]).includes('base descendant'), false);
  assert.equal(JSON.stringify(plan.conflicts[0]).includes('remote-only plugin drift'), false);
});

test('keeps remote-only plugin changes while a live-preconditioned file delete preserves a matching independent row restore and file type swap', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  local.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Restored post 4', post_status: 'publish' };
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  remote.db.wp_posts['ID:4'] = { ID: 4, post_title: 'Restored post 4', post_status: 'publish' };
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingRowRestore = decisionFor(plan, 'row:["wp_posts","ID:4"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingRowRestore.decision, 'already-in-sync');
  assert.equal(matchingRowRestore.change.localChange, 'create');
  assert.equal(matchingRowRestore.change.remoteChange, 'create');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:4'].post_title, 'Restored post 4');
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});

test('keeps remote-only plugin removals while a live-preconditioned file delete preserves a matching independent restore and edit', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Base row 5', post_status: 'draft' };

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Restored row 5', post_status: 'publish' };

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.db.wp_posts['ID:5'] = { ID: 5, post_title: 'Restored row 5', post_status: 'publish' };
  delete remote.plugins.forms;
  delete remote.files['wp-content/plugins/forms/forms.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingRestore = decisionFor(plan, 'row:["wp_posts","ID:5"]');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.db.wp_posts['ID:5'].post_title, 'Restored row 5');
  assert.equal(Object.hasOwn(result.site.plugins, 'forms'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/forms/forms.php'), false);
});

test('keeps remote-only plugin drift and removals while a live-preconditioned file delete preserves a matching independent restore, edit, and type swap', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';
  base.db.wp_posts['ID:6'] = { ID: 6, post_title: 'Base row 6', post_status: 'draft' };
  base.plugins.seo = { version: '1.0.0', active: false };
  base.files['wp-content/plugins/seo/seo.php'] = '<?php /* seo 1.0 */';

  const local = baseSite();
  delete local.files['index.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };
  local.db.wp_posts['ID:6'] = { ID: 6, post_title: 'Restored row 6', post_status: 'publish' };
  local.plugins.seo = { version: '1.0.0', active: false };
  local.files['wp-content/plugins/seo/seo.php'] = '<?php /* seo 1.0 */';

  const remote = baseSite();
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.db.wp_posts['ID:6'] = { ID: 6, post_title: 'Restored row 6', post_status: 'publish' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';
  delete remote.plugins.seo;
  delete remote.files['wp-content/plugins/seo/seo.php'];

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingRestore = decisionFor(plan, 'row:["wp_posts","ID:6"]');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const removedPluginDecision = decisionFor(plan, 'plugin:seo');
  const removedPluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/seo/seo.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingRestore.decision, 'already-in-sync');
  assert.equal(matchingRestore.change.localChange, 'update');
  assert.equal(matchingRestore.change.remoteChange, 'update');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assert.equal(removedPluginDecision.decision, 'keep-remote');
  assert.equal(removedPluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(result.site.db.wp_posts['ID:6'].post_title, 'Restored row 6');
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
  assert.equal(Object.hasOwn(result.site.plugins, 'seo'), false);
  assert.equal(Object.hasOwn(result.site.files, 'wp-content/plugins/seo/seo.php'), false);
});

test('keeps remote-only plugin drift while a live-preconditioned file delete preserves a matching independent file delete, edit, and type swap', () => {
  const base = baseSite();
  base.files['about.php'] = '<?php echo "base about";';
  base.files['sidebar.php'] = '<?php echo "base sidebar";';
  base.files['wp-content/uploads/cover'] = 'base cover bytes';

  const local = baseSite();
  delete local.files['index.php'];
  delete local.files['sidebar.php'];
  local.files['about.php'] = '<?php echo "shared about";';
  local.files['wp-content/uploads/cover'] = { type: 'directory' };

  const remote = baseSite();
  delete remote.files['sidebar.php'];
  remote.files['about.php'] = '<?php echo "shared about";';
  remote.files['wp-content/uploads/cover'] = { type: 'directory' };
  remote.plugins.forms.description = 'remote-only plugin drift';
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-only plugin drift */';

  const plan = planFor(base, local, remote);
  const fileDelete = mutationFor(plan, 'file:index.php');
  const matchingFileDelete = decisionFor(plan, 'file:sidebar.php');
  const matchingEdit = decisionFor(plan, 'file:about.php');
  const matchingTypeSwap = decisionFor(plan, 'file:wp-content/uploads/cover');
  const pluginDecision = decisionFor(plan, 'plugin:forms');
  const pluginFileDecision = decisionFor(plan, 'file:wp-content/plugins/forms/forms.php');
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(fileDelete.action, 'delete');
  assert.equal(fileDelete.changeKind, 'delete');
  assert.equal(matchingFileDelete.decision, 'already-in-sync');
  assert.equal(matchingFileDelete.change.localChange, 'delete');
  assert.equal(matchingFileDelete.change.remoteChange, 'delete');
  assert.equal(matchingEdit.decision, 'already-in-sync');
  assert.equal(matchingEdit.change.localChange, 'update');
  assert.equal(matchingEdit.change.remoteChange, 'update');
  assert.equal(matchingTypeSwap.decision, 'already-in-sync');
  assert.equal(matchingTypeSwap.change.localChange, 'type-change');
  assert.equal(matchingTypeSwap.change.remoteChange, 'type-change');
  assert.equal(pluginDecision.decision, 'keep-remote');
  assert.equal(pluginFileDecision.decision, 'keep-remote');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(Object.hasOwn(result.site.files, 'index.php'), false);
  assert.equal(Object.hasOwn(result.site.files, 'sidebar.php'), false);
  assert.equal(result.site.files['about.php'], '<?php echo "shared about";');
  assert.equal(result.site.files['wp-content/uploads/cover'].type, 'directory');
  assert.equal(result.site.plugins.forms.description, 'remote-only plugin drift');
  assert.equal(result.site.files['wp-content/plugins/forms/forms.php'], '<?php /* remote-only plugin drift */');
});
