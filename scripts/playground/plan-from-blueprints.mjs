#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPushPlan } from '../../src/planner.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');

const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
  remote: 'fixtures/playground/remote-changed.blueprint.json',
};

const snapshots = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [
    name,
    exportSnapshot(name, path.join(repoRoot, fixture)),
  ]),
);

const plan = createPushPlan({
  base: snapshots.base,
  local: snapshots.local,
  remote: snapshots.remote,
  now: fixedNow,
});

assert.equal(snapshots.base.meta.fixture, 'remote-base');
assert.equal(snapshots.local.meta.fixture, 'local-edited');
assert.equal(snapshots.remote.meta.fixture, 'remote-changed');

const sharedPostKey = postKeyByTitle(snapshots.base, 'Shared base post');
const localOnlyPostKey = postKeyByTitle(snapshots.local, 'Local-only draft');
assert.equal(sharedPostKey, postKeyByTitle(snapshots.local, 'Shared base post'));
assert.equal(sharedPostKey, postKeyByTitle(snapshots.remote, 'Shared base post'));

assert.equal(plan.status, 'conflict');
assertConflict(plan, sharedPostKey, 'row-conflict');
assertConflict(plan, 'file:wp-content/uploads/reprint-push/shared.txt', 'file-conflict');
assertConflict(plan, 'row:["wp_options","option_name:reprint_push_forms_fixture"]', 'plugin-data-conflict');
assertConflict(plan, 'row:["wp_options","option_name:reprint_push_plugin_payload"]', 'plugin-data-conflict');
assertConflict(plan, 'row:["wp_postmeta","post_id:1001:meta_key:_reprint_push_forms_schema"]', 'plugin-data-conflict');

assertMutation(plan, localOnlyPostKey, 'create');
assertMutation(plan, 'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]', 'create');
assertGraphDependency(
  plan,
  'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]',
  localOnlyPostKey,
);
assertMutation(plan, 'file:wp-content/uploads/reprint-push/local-only.txt', 'create');

assertDecision(plan, postKeyByTitle(snapshots.remote, 'Remote-only announcement'), 'keep-remote');
assertDecision(plan, 'plugin:reprint-push-forms-fixture', 'keep-remote');
assertDecision(plan, 'row:["wp_postmeta","post_id:3001:meta_key:_reprint_push_forms_schema"]', 'keep-remote');
assertDecision(plan, 'row:["wp_reprint_push_forms_lab","id:1"]', 'keep-remote');
assertDecision(plan, 'file:wp-content/uploads/reprint-push/remote-only.txt', 'keep-remote');

console.log(JSON.stringify({
  status: plan.status,
  snapshots: Object.fromEntries(
    Object.entries(snapshots).map(([name, snapshot]) => [
      name,
      {
        fixture: snapshot.meta.fixture,
        posts: Object.keys(snapshot.db.wp_posts).length,
        options: Object.keys(snapshot.db.wp_options).length,
        files: Object.keys(snapshot.files).length,
      },
    ]),
  ),
  summary: plan.summary,
  conflicts: plan.conflicts.map((conflict) => ({
    resourceKey: conflict.resourceKey,
    class: conflict.class,
  })),
  blockers: plan.blockers.map((blocker) => ({
    resourceKey: blocker.resourceKey,
    class: blocker.class,
  })),
}, null, 2));

function exportSnapshot(name, blueprintPath) {
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/export-site-snapshot.php',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status !== 0) {
    throw new Error(`Playground snapshot export failed for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  const match = result.stdout.match(/REPRINT_PUSH_SNAPSHOT_JSON_BEGIN\n([\s\S]*)\nREPRINT_PUSH_SNAPSHOT_JSON_END/);
  if (!match) {
    throw new Error(`Snapshot markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  return JSON.parse(match[1]);
}

function postKeyByTitle(snapshot, title) {
  const entry = Object.entries(snapshot.db.wp_posts).find(([, row]) => row.post_title === title);
  assert.ok(entry, `missing post ${title}`);
  return `row:["wp_posts","${entry[0]}"]`;
}

function assertConflict(plan, resourceKey, className) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === resourceKey);
  assert.ok(conflict, `missing conflict ${resourceKey}`);
  assert.equal(conflict.class, className);
}

function assertMutation(plan, resourceKey, changeKind) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resourceKey);
  assert.ok(mutation, `missing mutation ${resourceKey}`);
  assert.equal(mutation.changeKind, changeKind);
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
  assert.ok(precondition, `missing precondition ${mutation.id}`);
  assert.equal(precondition.checkedAgainst, 'live-remote');
}

function assertBlocker(plan, resourceKey, className) {
  const blocker = plan.blockers.find((entry) => entry.resourceKey === resourceKey);
  assert.ok(blocker, `missing blocker ${resourceKey}`);
  assert.equal(blocker.class, className);
}

function assertGraphDependency(plan, resourceKey, targetResourceKey) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resourceKey);
  const targetMutation = plan.mutations.find((entry) => entry.resourceKey === targetResourceKey);
  assert.ok(mutation, `missing graph source mutation ${resourceKey}`);
  assert.ok(targetMutation, `missing graph target mutation ${targetResourceKey}`);
  assert.ok(
    plan.mutations.indexOf(targetMutation) < plan.mutations.indexOf(mutation),
    `target ${targetResourceKey} must be ordered before ${resourceKey}`,
  );
  assert.deepEqual(mutation.dependsOnMutationIds, [targetMutation.id]);
  const reference = mutation.wordpressGraphReferences?.[0];
  assert.equal(reference?.resolutionPolicy, 'same-plan-local-create');
  assert.equal(reference?.dependency?.targetMutationId, targetMutation.id);
  assert.equal(reference?.targetResourceKey, targetResourceKey);
}

function assertDecision(plan, resourceKey, decision) {
  const entry = plan.decisions.find((item) => item.resourceKey === resourceKey);
  assert.ok(entry, `missing decision ${resourceKey}`);
  assert.equal(entry.decision, decision);
}
