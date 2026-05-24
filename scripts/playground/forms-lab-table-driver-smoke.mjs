#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPlan } from '../../src/apply.js';
import { createPushPlan } from '../../src/planner.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');
const baseBlueprint = 'fixtures/playground/remote-base.blueprint.json';
const resourceKey = 'row:["wp_reprint_push_forms_lab","id:1"]';

const base = exportSnapshot('base', path.join(repoRoot, baseBlueprint));
const local = JSON.parse(JSON.stringify(base));
local.db.wp_reprint_push_forms_lab['id:1'] = {
  id: 1,
  form_slug: 'contact',
  payload: {
    owner: 'forms',
    mode: 'semantic-local',
    rules: {
      maxAttachments: '3',
      requireConsent: true,
    },
    version: '2',
  },
  updated_marker: 'semantic_local',
  __pluginOwner: 'forms',
};

const plan = createPushPlan({
  base,
  local,
  remote: base,
  now: fixedNow,
});

assert.equal(plan.status, 'ready');
assert.deepEqual(plan.mutations.map((mutation) => mutation.resourceKey), [resourceKey]);
assert.equal(plan.mutations[0].pluginOwnedResource.driver, 'fixture-forms-lab-table');
assert.equal(plan.mutations[0].pluginOwnedResource.driverEvidence.source, 'live-remote');
assert.equal(
  plan.mutations[0].pluginOwnedResource.driverEvidence.baseHash,
  plan.mutations[0].pluginOwnedResource.driverEvidence.remoteHash,
);

const replayModel = applyPlan(JSON.parse(JSON.stringify(base)), plan);
const replay = applyPlan(replayModel.site, plan, { journal: replayModel.journal });
assert.equal(replay.appliedMutations, 0, 'completed replay must perform zero fresh mutation work');

const tmpDir = path.join(repoRoot, '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const planPath = path.join(tmpDir, 'playground-forms-lab-table-plan.json');
fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);

const forgedPlanPath = path.join(tmpDir, 'playground-forms-lab-table-forged-plan.json');
const forgedPlan = JSON.parse(JSON.stringify(plan));
delete forgedPlan.mutations[0].pluginOwnedResource.driverEvidence;
fs.writeFileSync(forgedPlanPath, `${JSON.stringify(forgedPlan, null, 2)}\n`);
const rejected = runProtocolDryRun(forgedPlanPath);
assertProtocolRejects(rejected, /Unsupported plugin-owned mutation driver/);

const forgedOptionPlanPath = path.join(tmpDir, 'playground-forms-lab-table-forged-option-driver-plan.json');
const forgedOptionPlan = JSON.parse(JSON.stringify(plan));
forgedOptionPlan.mutations[0].pluginOwnedResource = {
  pluginOwner: 'forms',
  driver: 'wp-option',
  policySource: 'forged',
};
fs.writeFileSync(forgedOptionPlanPath, `${JSON.stringify(forgedOptionPlan, null, 2)}\n`);
assertProtocolRejects(
  runProtocolDryRun(forgedOptionPlanPath),
  /Unsupported plugin-owned mutation driver/,
);

const applyResult = applyPlanToBase(planPath);
assert.equal(applyResult.ok, true);
assert.equal(applyResult.applied, 1);
assert.deepEqual(applyResult.verified, [resourceKey]);

const row = applyResult.after.db.wp_reprint_push_forms_lab['id:1'];
assert.equal(row.__pluginOwner, 'forms');
assert.equal(row.form_slug, 'contact');
assert.equal(row.updated_marker, 'semantic_local');
assert.deepEqual(row.payload, local.db.wp_reprint_push_forms_lab['id:1'].payload);

console.log(JSON.stringify({
  status: plan.status,
  applied: applyResult.applied,
  replayApplied: replay.appliedMutations,
  verified: applyResult.verified,
  row: {
    id: row.id,
    form_slug: row.form_slug,
    updated_marker: row.updated_marker,
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
  const result = spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    path.join(repoRoot, baseBlueprint),
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

function runProtocolDryRun(planPath) {
  return spawnSync('npx', [
    '--yes',
    '@wp-playground/cli@latest',
    'php',
    '--blueprint',
    path.join(repoRoot, baseBlueprint),
    '--mount',
    `${repoRoot}:/workspace`,
    '--verbosity',
    'quiet',
    '--',
    '/workspace/scripts/playground/push-remote-endpoint.php',
    'dry-run',
    `/workspace/${path.relative(repoRoot, planPath)}`,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });
}

function assertProtocolRejects(result, messagePattern) {
  assert.notEqual(result.status, 0, 'forged protocol dry-run should fail');
  const payload = parseMarkedJson(
    result.stdout,
    'REPRINT_PUSH_PROTOCOL_JSON_BEGIN',
    'REPRINT_PUSH_PROTOCOL_JSON_END',
    `Protocol markers missing\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'INVALID_PLAN');
  assert.match(payload.message, messagePattern);
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}
