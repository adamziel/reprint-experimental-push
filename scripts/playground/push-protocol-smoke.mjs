#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPushPlan } from '../../src/planner.js';
import { digest } from '../../src/stable-json.js';
import { resourceHash } from '../../src/resources.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');

const fixtures = {
  base: 'fixtures/playground/remote-base.blueprint.json',
  local: 'fixtures/playground/local-edited.blueprint.json',
  remoteChanged: 'fixtures/playground/remote-changed.blueprint.json',
};

const tmpDir = path.join(repoRoot, '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const endpointWrapperPath = path.join(tmpDir, 'push-protocol-endpoint-readback.php');
fs.writeFileSync(endpointWrapperPath, endpointWrapperSource());

const snapshots = Object.fromEntries(
  Object.entries(fixtures).map(([name, fixture]) => [
    name,
    exportSnapshot(name, path.join(repoRoot, fixture)),
  ]),
);

assert.equal(snapshots.base.meta.fixture, 'remote-base');
assert.equal(snapshots.local.meta.fixture, 'local-edited');
assert.equal(snapshots.remoteChanged.meta.fixture, 'remote-changed');
const readyLocalSnapshot = snapshots.local;

const readyPlan = createPushPlan({
  base: snapshots.base,
  local: readyLocalSnapshot,
  remote: snapshots.base,
  now: fixedNow,
});

assert.equal(readyPlan.status, 'ready');
assert.equal(readyPlan.summary.conflicts, 0);
assert.equal(readyPlan.summary.blockers, 0);
assert.ok(readyPlan.mutations.length > 0, 'expected ready plan mutations');
assertReadyPlanResources(readyPlan);

const readyPlanPath = writeJson('push-protocol-ready-plan.json', readyPlan);
const graphPostmetaResourceKey = 'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]';
const graphTargetPostResourceKey = 'row:["wp_posts","ID:2001"]';

const forgedGraphDependencyPlanPath = writeJson(
  'push-protocol-forged-graph-dependency-plan.json',
  tamperedPlan(readyPlan, (plan) => {
    const mutation = mutationForResourceKey(plan, graphPostmetaResourceKey);
    mutation.wordpressGraphReferences[0].dependency.targetLocalHash = '0'.repeat(64);
  }),
);

const forgedGraphDependencyDryRun = runEndpoint({
  name: 'forged graph dependency dry-run',
  blueprintPath: path.join(repoRoot, fixtures.base),
  mode: 'dry-run',
  planPath: forgedGraphDependencyPlanPath,
});

assertInvalidPlanNoMutation(forgedGraphDependencyDryRun, snapshots.base, 'forged graph dependency dry-run');

const misorderedGraphDependencyPlanPath = writeJson(
  'push-protocol-misordered-graph-dependency-plan.json',
  tamperedPlan(readyPlan, (plan) => {
    plan.mutations.sort((left, right) => {
      if (left.resourceKey === graphPostmetaResourceKey) {
        return -1;
      }
      if (right.resourceKey === graphPostmetaResourceKey) {
        return 1;
      }
      return 0;
    });
    assert.ok(
      plan.mutations.findIndex((mutation) => mutation.resourceKey === graphPostmetaResourceKey)
        < plan.mutations.findIndex((mutation) => mutation.resourceKey === graphTargetPostResourceKey),
      'misordered graph dependency fixture must put the source before the target',
    );
  }),
);

const misorderedGraphDependencyDryRun = runEndpoint({
  name: 'misordered graph dependency dry-run',
  blueprintPath: path.join(repoRoot, fixtures.base),
  mode: 'dry-run',
  planPath: misorderedGraphDependencyPlanPath,
});

assertInvalidPlanNoMutation(misorderedGraphDependencyDryRun, snapshots.base, 'misordered graph dependency dry-run');

const missingReceiptApply = runEndpoint({
  name: 'ready apply missing receipt',
  blueprintPath: path.join(repoRoot, fixtures.base),
  mode: 'apply',
  planPath: readyPlanPath,
});

assertFailureNoMutation(missingReceiptApply, snapshots.base, {
  label: 'ready apply missing receipt',
  code: 'MISSING_DRY_RUN_RECEIPT',
  journalEvent: 'receipt-required',
});

const dryRun = runEndpoint({
  name: 'ready dry-run',
  blueprintPath: path.join(repoRoot, fixtures.base),
  mode: 'dry-run',
  planPath: readyPlanPath,
});

assert.equal(dryRun.status, 0);
assert.equal(dryRun.result.ok, true);
assert.equal(dryRun.result.mode, 'dry-run');
assert.equal(dryRun.result.applied, 0);
assert.equal(dryRun.result.receipt.mode, 'dry-run');
assertJournalEvent(dryRun.result, 'dry-run-recorded');
assertSnapshotContentEqual(dryRun.readback.beforeSnapshot, snapshots.base, 'dry-run before snapshot');
assertSnapshotEqual(dryRun.readback.afterSnapshot, dryRun.readback.beforeSnapshot, 'dry-run same-process readback');
assertSnapshotContentEqual(dryRun.result.currentSnapshot, snapshots.base, 'dry-run current snapshot');
assertTargetHashes(readyPlan, snapshots.base, 'expectedHash', 'dry-run base preconditions');
assert.deepEqual(
  dryRun.result.verifiedPreconditions.map((entry) => entry.resourceKey),
  readyPlan.mutations.map((mutation) => mutation.resourceKey),
);

const dryRunReceiptPath = writeJson('push-protocol-ready-dry-run-receipt.json', dryRun.result.receipt);

const planHashTamperedReceiptPath = writeJson(
  'push-protocol-tampered-plan-hash-receipt.json',
  tamperedReceipt(dryRun.result.receipt, (receipt) => {
    receipt.planHash = '0'.repeat(64);
  }),
);

const planHashTamperedApply = runEndpoint({
  name: 'ready apply tampered plan hash receipt',
  blueprintPath: path.join(repoRoot, fixtures.base),
  mode: 'apply',
  planPath: readyPlanPath,
  receiptPath: planHashTamperedReceiptPath,
});

assertFailureNoMutation(planHashTamperedApply, snapshots.base, {
  label: 'ready apply tampered plan hash receipt',
  code: 'RECEIPT_MISMATCH',
  journalEvent: 'receipt-mismatch',
});

const preconditionTamperedReceiptPath = writeJson(
  'push-protocol-tampered-precondition-hash-receipt.json',
  tamperedReceipt(dryRun.result.receipt, (receipt) => {
    assert.ok(receipt.preconditionHashes?.[0], 'tamper fixture needs at least one precondition hash');
    receipt.preconditionHashes[0].actualHash = 'f'.repeat(64);
  }),
);

const preconditionTamperedApply = runEndpoint({
  name: 'ready apply tampered precondition hash receipt',
  blueprintPath: path.join(repoRoot, fixtures.base),
  mode: 'apply',
  planPath: readyPlanPath,
  receiptPath: preconditionTamperedReceiptPath,
});

assertFailureNoMutation(preconditionTamperedApply, snapshots.base, {
  label: 'ready apply tampered precondition hash receipt',
  code: 'RECEIPT_MISMATCH',
  journalEvent: 'receipt-mismatch',
});

const apply = runEndpoint({
  name: 'ready apply',
  blueprintPath: path.join(repoRoot, fixtures.base),
  mode: 'apply',
  planPath: readyPlanPath,
  receiptPath: dryRunReceiptPath,
});

assert.equal(apply.status, 0);
assert.equal(apply.result.ok, true);
assert.equal(apply.result.mode, 'apply');
assert.equal(apply.result.applied, readyPlan.mutations.length);
assertJournalEventsOrdered(apply.result, ['apply-started', 'apply-committed']);
assert.deepEqual(
  apply.result.verifiedKeys,
  readyPlan.mutations.map((mutation) => mutation.resourceKey),
);
assertSnapshotContentEqual(apply.readback.beforeSnapshot, snapshots.base, 'apply before snapshot');
assertSnapshotEqual(apply.readback.afterSnapshot, apply.result.afterSnapshot, 'apply endpoint/readback after snapshot');
assertVisibleSurfaceEqual(apply.result.afterSnapshot, readyLocalSnapshot, 'apply final visible surface');
assertAppliedHashes(readyPlan, apply.result.afterSnapshot);
assertAppliedFixtureValues(apply.result.afterSnapshot);

const staleApply = runEndpoint({
  name: 'stale apply',
  blueprintPath: path.join(repoRoot, fixtures.remoteChanged),
  mode: 'apply',
  planPath: readyPlanPath,
  receiptPath: dryRunReceiptPath,
});

assert.notEqual(staleApply.status, 0, 'expected stale apply to fail');
assert.equal(staleApply.result.ok, false);
assert.equal(staleApply.result.code, 'PRECONDITION_FAILED');
assertJournalEvent(staleApply.result, 'precondition-failed');
assertNoJournalEvent(staleApply.result, 'apply-committed');
assertSnapshotContentEqual(staleApply.readback.beforeSnapshot, snapshots.remoteChanged, 'stale before snapshot');
assertSnapshotEqual(staleApply.readback.afterSnapshot, staleApply.readback.beforeSnapshot, 'stale same-process readback');
assertSnapshotContentEqual(staleApply.result.currentSnapshot, snapshots.remoteChanged, 'stale failure current snapshot');
assert.notDeepEqual(
  visibleSurface(staleApply.readback.afterSnapshot),
  visibleSurface(readyLocalSnapshot),
  'stale failure must leave remote drift instead of applying local state',
);

const conflictPlan = createPushPlan({
  base: snapshots.base,
  local: snapshots.local,
  remote: snapshots.remoteChanged,
  now: fixedNow,
});

assert.equal(conflictPlan.status, 'conflict');
assertConflictEvidence(conflictPlan);
const conflictPlanPath = writeJson('push-protocol-conflict-plan.json', conflictPlan);

const conflictDryRun = runEndpoint({
  name: 'conflict dry-run',
  blueprintPath: path.join(repoRoot, fixtures.base),
  mode: 'dry-run',
  planPath: conflictPlanPath,
});

assertPlanNotReady(conflictDryRun, snapshots.base, 'conflict dry-run');
assertConflictClasses(conflictDryRun.result);
assertConflictEvidence(conflictDryRun.result.audit, { expectDetectionDecisions: false });

const conflictApply = runEndpoint({
  name: 'conflict apply',
  blueprintPath: path.join(repoRoot, fixtures.base),
  mode: 'apply',
  planPath: conflictPlanPath,
  receiptPath: dryRunReceiptPath,
});

assertPlanNotReady(conflictApply, snapshots.base, 'conflict apply');
assertConflictClasses(conflictApply.result);
assertConflictEvidence(conflictApply.result.audit, { expectDetectionDecisions: false });

console.log(JSON.stringify({
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
  ready: {
    status: readyPlan.status,
    mutations: readyPlan.mutations.length,
    missingReceiptCode: missingReceiptApply.result.code,
    dryRunVerified: dryRun.result.verifiedPreconditions.length,
    tamperedReceiptCodes: [
      planHashTamperedApply.result.code,
      preconditionTamperedApply.result.code,
    ],
    invalidGraphDependencyCodes: [
      forgedGraphDependencyDryRun.result.code,
      misorderedGraphDependencyDryRun.result.code,
    ],
    applied: apply.result.applied,
    verifiedKeys: apply.result.verifiedKeys.length,
  },
  stale: {
    exitCode: staleApply.status,
    code: staleApply.result.code,
    resourceKey: staleApply.result.resourceKey,
    preservedFixture: staleApply.readback.afterSnapshot.meta.fixture,
  },
  conflict: {
    status: conflictPlan.status,
    dryRunExitCode: conflictDryRun.status,
    applyExitCode: conflictApply.status,
    classes: conflictClasses(conflictDryRun.result),
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

function runEndpoint({ name, blueprintPath, mode, planPath, receiptPath = null }) {
  const args = [
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
    `/workspace/${path.relative(repoRoot, endpointWrapperPath)}`,
    mode,
    `/workspace/${path.relative(repoRoot, planPath)}`,
  ];

  if (receiptPath) {
    args.push(`/workspace/${path.relative(repoRoot, receiptPath)}`);
  }

  const result = spawnSync('npx', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  const payload = {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    result: parseMarkedJson(
      result.stdout,
      'REPRINT_PUSH_PROTOCOL_JSON_BEGIN',
      'REPRINT_PUSH_PROTOCOL_JSON_END',
      `Protocol markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    ),
    readback: parseMarkedJson(
      result.stdout,
      'REPRINT_PUSH_PROTOCOL_READBACK_JSON_BEGIN',
      'REPRINT_PUSH_PROTOCOL_READBACK_JSON_END',
      `Readback markers missing for ${name}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    ),
  };

  return payload;
}

function writeJson(name, value) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function tamperedReceipt(receipt, mutate) {
  const next = JSON.parse(JSON.stringify(receipt));
  mutate(next);
  delete next.receiptHash;
  next.receiptHash = digest(next);
  return next;
}

function tamperedPlan(plan, mutate) {
  const next = JSON.parse(JSON.stringify(plan));
  mutate(next);
  next.status = 'ready';
  next.conflicts = [];
  next.blockers = [];
  next.summary.conflicts = 0;
  next.summary.blockers = 0;
  return next;
}

function mutationForResourceKey(plan, resourceKey) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resourceKey);
  assert.ok(mutation, `missing mutation ${resourceKey}`);
  return mutation;
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*?)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

function endpointWrapperSource() {
  return `<?php
if (!defined('ABSPATH')) {
    require_once '/wordpress/wp-load.php';
}
require_once '/workspace/scripts/playground/snapshot-lib.php';

$before_snapshot = reprint_push_export_snapshot();
register_shutdown_function(static function () use ($before_snapshot): void {
    $after_snapshot = reprint_push_export_snapshot();
    echo "\\nREPRINT_PUSH_PROTOCOL_READBACK_JSON_BEGIN\\n";
    echo json_encode([
        'beforeSnapshot' => $before_snapshot,
        'afterSnapshot' => $after_snapshot,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\\n";
    echo "REPRINT_PUSH_PROTOCOL_READBACK_JSON_END\\n";
});

$endpoint = '/workspace/scripts/playground/push-remote-endpoint.php';
$argv = array_merge([$endpoint], array_slice($argv, 1));
$argc = count($argv);
require $endpoint;
`;
}

function assertSnapshotEqual(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label} mismatch`);
  assert.equal(digest(actual), digest(expected), `${label} digest mismatch`);
}

function assertSnapshotContentEqual(actual, expected, label) {
  assert.deepEqual(snapshotContent(actual), snapshotContent(expected), `${label} content mismatch`);
  assert.equal(digest(snapshotContent(actual)), digest(snapshotContent(expected)), `${label} content digest mismatch`);
}

function snapshotContent(snapshot) {
  return {
    meta: {
      source: snapshot.meta.source,
      fixture: snapshot.meta.fixture,
      table_prefix: snapshot.meta.table_prefix,
    },
    ...visibleSurface(snapshot),
  };
}

function assertTargetHashes(plan, snapshot, preconditionHashField, label) {
  for (const precondition of plan.preconditions) {
    assert.equal(
      resourceHash(snapshot, precondition.resource),
      precondition[preconditionHashField],
      `${label}: ${precondition.resourceKey}`,
    );
  }
}

function assertAppliedHashes(plan, snapshot) {
  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(snapshot, mutation.resource),
      mutation.localHash,
      `applied hash mismatch for ${mutation.resourceKey}`,
    );
  }
}

function assertVisibleSurfaceEqual(actual, expected, label) {
  assert.deepEqual(visibleSurface(actual), visibleSurface(expected), `${label} mismatch`);
}

function visibleSurface(snapshot) {
  return {
    files: snapshot.files,
    db: snapshot.db,
    plugins: snapshot.plugins,
  };
}

function assertReadyPlanResources(plan) {
  const expectedReadyKeys = [
    'file:wp-content/uploads/reprint-push/local-only.txt',
    'file:wp-content/uploads/reprint-push/shared.txt',
    'row:["wp_options","option_name:reprint_push_forms_fixture"]',
    'row:["wp_options","option_name:reprint_push_plugin_payload"]',
    'row:["wp_postmeta","post_id:1001:meta_key:_reprint_push_forms_schema"]',
    'row:["wp_postmeta","post_id:2001:meta_key:_reprint_push_forms_schema"]',
    'row:["wp_posts","ID:1001"]',
    'row:["wp_posts","ID:2001"]',
  ];
  const readyKeys = plan.mutations.map((mutation) => mutation.resourceKey).sort();
  assert.deepEqual(readyKeys, [...expectedReadyKeys].sort(), 'ready mutations should match fixture-scoped resources');
  assertNoReadyMutation(plan, 'plugin:reprint-push-forms-fixture');
  assertNoReadyMutation(plan, 'row:["wp_reprint_push_forms_lab","id:1"]');
}

function assertNoReadyMutation(plan, resourceKey) {
  assert.ok(
    !plan.mutations.some((mutation) => mutation.resourceKey === resourceKey),
    `${resourceKey} must remain detection-only in ready plans`,
  );
}

function assertConflictEvidence(audit, { expectDetectionDecisions = true } = {}) {
  assertEvidenceEntry(
    audit.conflicts,
    'row:["wp_options","option_name:reprint_push_forms_fixture"]',
    'plugin-data-conflict',
  );
  assertEvidenceEntry(
    audit.conflicts,
    'row:["wp_options","option_name:reprint_push_plugin_payload"]',
    'plugin-data-conflict',
  );
  assertEvidenceEntry(
    audit.conflicts,
    'row:["wp_postmeta","post_id:1001:meta_key:_reprint_push_forms_schema"]',
    'plugin-data-conflict',
  );
  if (!expectDetectionDecisions) {
    return;
  }
  assertEvidenceEntry(audit.decisions, 'plugin:reprint-push-forms-fixture', 'keep-remote');
  assertEvidenceEntry(audit.decisions, 'row:["wp_reprint_push_forms_lab","id:1"]', 'keep-remote');
}

function assertEvidenceEntry(entries = [], resourceKey, expectedClassOrDecision) {
  const entry = entries.find((item) => item.resourceKey === resourceKey);
  assert.ok(entry, `missing audit evidence for ${resourceKey}`);
  assert.equal(entry.class ?? entry.decision, expectedClassOrDecision);
}

function assertAppliedFixtureValues(snapshot) {
  assert.equal(snapshot.meta.fixture, 'remote-base');

  const sharedPost = postByTitle(snapshot, 'Shared base post');
  assert.equal(sharedPost.post_content, 'Local edited content');
  assert.equal(sharedPost.post_status, 'publish');

  const localPost = postByTitle(snapshot, 'Local-only draft');
  assert.equal(localPost.post_content, 'Created locally after pull');
  assert.equal(localPost.post_status, 'draft');

  assert.equal(snapshot.files['wp-content/uploads/reprint-push/shared.txt'], 'local upload content');
  assert.equal(snapshot.files['wp-content/uploads/reprint-push/local-only.txt'], 'local-only upload content');

  const pluginPayload = snapshot.db.wp_options['option_name:reprint_push_plugin_payload'];
  assert.equal(pluginPayload.__pluginOwner, 'forms');
  assert.deepEqual(pluginPayload.option_value, {
    mode: 'local-edited',
    owner: 'forms',
    version: 2,
  });

  const formsFixture = snapshot.db.wp_options['option_name:reprint_push_forms_fixture'];
  assert.equal(formsFixture.__pluginOwner, 'forms');
  assert.deepEqual(formsFixture.option_value, {
    enabled: true,
    flags: {
      captcha: true,
      honeypot: true,
    },
    forms: {
      contact: {
        active: true,
        fields: ['email', 'message', 'phone'],
        limits: {
          daily: '40',
          perIp: '4',
        },
        title: 'Contact the studio',
        version: '2',
      },
      newsletter: {
        active: true,
        fields: ['email', 'source'],
        segments: ['general', 'product', 'local'],
        title: 'Newsletter',
        version: '1',
      },
    },
    owner: 'forms',
    revision: '002-local',
    routing: {
      notify: ['local-admin@example.test', 'ops@example.test'],
      storeSubmissions: true,
    },
  });

  const sharedSchema = snapshot.db.wp_postmeta['post_id:1001:meta_key:_reprint_push_forms_schema'];
  assert.equal(sharedSchema.__pluginOwner, 'forms');
  assert.deepEqual(sharedSchema.meta_value, {
    fields: [
      {
        enabled: true,
        key: 'email',
        label: 'Email address',
        type: 'email',
      },
      {
        enabled: true,
        key: 'message',
        label: 'Project brief',
        type: 'textarea',
      },
      {
        enabled: false,
        key: 'phone',
        label: 'Phone',
        type: 'tel',
      },
    ],
    form: 'contact',
    notifications: {
      admin: true,
      copyToSender: true,
    },
    owner: 'forms',
    required: ['email', 'message', 'phone'],
    schemaVersion: '2-local',
  });

  const customTableRow = snapshot.db.wp_reprint_push_forms_lab['id:1'];
  assert.equal(customTableRow.__pluginOwner, 'forms');
  assert.deepEqual(customTableRow.payload, {
    mode: 'base',
    owner: 'forms',
    rules: {
      maxAttachments: '2',
      requireConsent: true,
    },
    version: '1',
  });
}

function postByTitle(snapshot, title) {
  const entry = Object.values(snapshot.db.wp_posts).find((row) => row.post_title === title);
  assert.ok(entry, `missing post ${title}`);
  return entry;
}

function assertFailureNoMutation(endpointRun, expectedSnapshot, { label, code, journalEvent }) {
  assert.notEqual(endpointRun.status, 0, `expected ${label} to fail`);
  assert.equal(endpointRun.result.ok, false);
  assert.equal(endpointRun.result.code, code);
  assertJournalEvent(endpointRun.result, journalEvent);
  assertNoJournalEvent(endpointRun.result, 'apply-started');
  assertNoJournalEvent(endpointRun.result, 'apply-committed');
  assertSnapshotContentEqual(endpointRun.readback.beforeSnapshot, expectedSnapshot, `${label} before snapshot`);
  assertSnapshotEqual(endpointRun.readback.afterSnapshot, endpointRun.readback.beforeSnapshot, `${label} same-process readback`);
}

function assertInvalidPlanNoMutation(endpointRun, expectedSnapshot, label) {
  assert.notEqual(endpointRun.status, 0, `expected ${label} to fail`);
  assert.equal(endpointRun.result.ok, false);
  assert.equal(endpointRun.result.code, 'INVALID_PLAN');
  assertNoJournalEvent(endpointRun.result, 'apply-started');
  assertNoJournalEvent(endpointRun.result, 'apply-committed');
  assertSnapshotContentEqual(endpointRun.readback.beforeSnapshot, expectedSnapshot, `${label} before snapshot`);
  assertSnapshotEqual(endpointRun.readback.afterSnapshot, endpointRun.readback.beforeSnapshot, `${label} same-process readback`);
}

function assertPlanNotReady(endpointRun, expectedSnapshot, label) {
  assert.notEqual(endpointRun.status, 0, `expected ${label} to fail`);
  assert.equal(endpointRun.result.ok, false);
  assert.equal(endpointRun.result.code, 'PLAN_NOT_READY');
  assertJournalEvent(endpointRun.result, 'plan-not-ready');
  assertNoJournalEvent(endpointRun.result, 'apply-started');
  assertNoJournalEvent(endpointRun.result, 'apply-committed');
  assertSnapshotContentEqual(endpointRun.readback.beforeSnapshot, expectedSnapshot, `${label} before snapshot`);
  assertSnapshotEqual(endpointRun.readback.afterSnapshot, endpointRun.readback.beforeSnapshot, `${label} same-process readback`);
}

function assertConflictClasses(result) {
  const classes = conflictClasses(result);
  assert.ok(classes.includes('row-conflict'), 'missing row conflict audit');
  assert.ok(classes.includes('file-conflict'), 'missing file conflict audit');
  assert.ok(classes.includes('plugin-data-conflict'), 'missing plugin-data conflict audit');
}

function conflictClasses(result) {
  return [...new Set((result.audit?.conflicts || []).map((conflict) => conflict.class))].sort();
}

function assertJournalEvent(result, event) {
  assert.equal(result.journal?.event, event, `expected current journal event ${event}`);
  assert.equal(result.journal?.option, 'reprint_push_protocol_journal');
  assert.ok(Array.isArray(result.journal?.recent), 'missing bounded journal evidence');
  assert.ok(result.journal.recent.length <= 5, 'journal evidence must stay bounded');
  assert.ok(
    result.journal.recent.some((entry) => entry.event === event),
    `journal recent entries missing ${event}`,
  );
}

function assertNoJournalEvent(result, event) {
  assert.ok(
    !(result.journal?.recent || []).some((entry) => entry.event === event),
    `journal recent entries should not include ${event}`,
  );
}

function assertJournalEventsOrdered(result, events) {
  for (const event of events) {
    assert.ok(
      result.journal?.recent?.some((entry) => entry.event === event),
      `journal recent entries missing ${event}`,
    );
  }

  const positions = events.map((event) =>
    result.journal.recent.findIndex((entry) => entry.event === event)
  );

  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(
      positions[index - 1] < positions[index],
      `journal event ${events[index - 1]} must precede ${events[index]}`,
    );
  }

  assertJournalEvent(result, events.at(-1));
}
