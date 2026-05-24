#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPushPlan } from '../../src/planner.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');

const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
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
  remote: snapshots.base,
  now: fixedNow,
});

assert.equal(plan.status, 'ready');
assert.equal(plan.summary.conflicts, 0);
assert.equal(plan.summary.blockers, 0);
assert.ok(plan.mutations.length > 0, 'expected ready plan mutations');
assertPhpStableHashMatchesJsForUnicode();

const tmpDir = path.join(repoRoot, '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const planPath = path.join(tmpDir, 'playground-ready-plan.json');
fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

const mismatchedPlanPath = path.join(tmpDir, 'playground-mismatched-precondition-plan.json');
fs.writeFileSync(mismatchedPlanPath, `${JSON.stringify(planWithMismatchedPrecondition(plan), null, 2)}\n`);
assertApplyFails(mismatchedPlanPath, /Precondition resourceKey does not match mutation/);

const mismatchedResourcePlanPath = path.join(tmpDir, 'playground-mismatched-precondition-resource-plan.json');
fs.writeFileSync(
  mismatchedResourcePlanPath,
  `${JSON.stringify(planWithMismatchedPreconditionResource(plan), null, 2)}\n`,
);
assertApplyFails(mismatchedResourcePlanPath, /Precondition resource does not match mutation/);

const applyResult = applyPlanToBase(planPath);

assert.equal(applyResult.ok, true);
assert.equal(applyResult.applied, plan.mutations.length);
assert.deepEqual(
  new Set(applyResult.verified),
  new Set(plan.mutations.map((mutation) => mutation.resourceKey)),
);

const after = applyResult.after;
assert.equal(after.meta.fixture, 'remote-base');

const sharedPost = postByTitle(after, 'Shared base post');
assert.equal(sharedPost.post_content, 'Local edited content');
assert.equal(sharedPost.post_status, 'publish');

const localPost = postByTitle(after, 'Local-only draft');
assert.equal(localPost.post_content, 'Created locally after pull');
assert.equal(localPost.post_status, 'draft');

assert.equal(after.files['wp-content/uploads/reprint-push/shared.txt'], 'local upload content');
assert.equal(after.files['wp-content/uploads/reprint-push/local-only.txt'], 'local-only upload content');

const pluginPayload = after.db.wp_options['option_name:reprint_push_plugin_payload'];
assert.equal(pluginPayload.__pluginOwner, 'forms');
assert.deepEqual(pluginPayload.option_value, {
  mode: 'local-edited',
  owner: 'forms',
  version: 2,
});

console.log(JSON.stringify({
  status: plan.status,
  applied: applyResult.applied,
  verified: applyResult.verified,
  after: {
    fixture: after.meta.fixture,
    posts: Object.keys(after.db.wp_posts).length,
    options: Object.keys(after.db.wp_options).length,
    files: Object.keys(after.files).length,
  },
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

  return parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_SNAPSHOT_JSON_BEGIN',
    'REPRINT_PUSH_SNAPSHOT_JSON_END',
    `Snapshot markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

function applyPlanToBase(planPath) {
  const result = runApplyPlan(planPath);
  const payload = parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_APPLY_JSON_BEGIN',
    'REPRINT_PUSH_APPLY_JSON_END',
    `Apply markers missing\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );

  if (result.status !== 0) {
    throw new Error(`Playground apply failed\n${JSON.stringify(payload, null, 2)}\nSTDERR:\n${result.stderr}`);
  }

  return payload;
}

function assertApplyFails(planPath, expectedMessage) {
  const result = runApplyPlan(planPath);
  const payload = parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_APPLY_JSON_BEGIN',
    'REPRINT_PUSH_APPLY_JSON_END',
    `Apply markers missing for expected failure\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );

  assert.notEqual(result.status, 0, 'expected apply to fail');
  assert.equal(payload.ok, false);
  assert.match(payload.error.message, expectedMessage);
}

function runApplyPlan(planPath) {
  return spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    path.join(repoRoot, fixtures.base),
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/apply-plan-to-site.php',
    `/workspace/${path.relative(repoRoot, planPath)}`,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
}

function planWithMismatchedPrecondition(sourcePlan) {
  const planCopy = JSON.parse(JSON.stringify(sourcePlan));
  assert.ok(planCopy.mutations.length >= 2, 'mismatch check needs at least two mutations');
  const first = planCopy.mutations[0];
  const second = planCopy.mutations[1];
  const precondition = planCopy.preconditions.find((entry) => entry.mutationId === first.id);
  assert.ok(precondition, `missing precondition ${first.id}`);
  precondition.resourceKey = second.resourceKey;
  precondition.resource = second.resource;
  return planCopy;
}

function planWithMismatchedPreconditionResource(sourcePlan) {
  const planCopy = JSON.parse(JSON.stringify(sourcePlan));
  const fileMutation = planCopy.mutations.find((mutation) => mutation.resource.type === 'file');
  assert.ok(fileMutation, 'missing file mutation for resource mismatch check');
  const precondition = planCopy.preconditions.find((entry) => entry.mutationId === fileMutation.id);
  assert.ok(precondition, `missing precondition ${fileMutation.id}`);
  precondition.resource = {
    ...precondition.resource,
    path: 'wp-content/uploads/reprint-push/other.txt',
  };
  return planCopy;
}

function assertPhpStableHashMatchesJsForUnicode() {
  const value = {
    text: 'Zażółć gęślą jaźń / 東京',
    nested: {
      b: 'β',
      a: 'á',
    },
  };
  const result = spawnSync('php', [
    '-r',
    [
      'require $argv[1];',
      '$value = json_decode($argv[2], true);',
      'echo hash("sha256", reprint_push_stable_json($value));',
    ].join(' '),
    path.join(repoRoot, 'scripts/playground/snapshot-lib.php'),
    JSON.stringify(value),
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`PHP stable hash check failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }

  assert.equal(result.stdout, digest(value));
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

function postByTitle(snapshot, title) {
  const entry = Object.values(snapshot.db.wp_posts).find((row) => row.post_title === title);
  assert.ok(entry, `missing post ${title}`);
  return entry;
}
