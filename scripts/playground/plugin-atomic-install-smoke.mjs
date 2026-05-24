#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPushPlan } from '../../src/planner.js';
import { resourceHash } from '../../src/resources.js';
import { digest } from '../../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const muPluginDir = path.join(repoRoot, 'scripts/playground/rest-mu-plugins');
const tmpDir = path.join(repoRoot, '.tmp', 'plugin-atomic-install-smoke');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');
const serverStartupTimeoutMs = 120_000;
const idempotencyHeader = 'X-Reprint-Push-Idempotency-Key';

const dependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const dependentPlugin = 'reprint-push-atomic-dependent-fixture';
const failingPlugin = 'reprint-push-atomic-failing-fixture';
const atomicGroupId = 'install-atomic-plugin-stack';
const dependentOptionKey = 'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]';

fs.mkdirSync(tmpDir, { recursive: true });

const blueprints = {
  base: writeBlueprint('atomic-base', basePhp()),
  local: writeBlueprint('atomic-local', localPhp({
    dependencyVersion: '1.0.0',
    dependentVersion: '2.0.0',
    includeDependency: true,
    includeDependent: true,
    dependentSlug: dependentPlugin,
    dependentName: 'Reprint Push Atomic Dependent Fixture',
    dependentActive: true,
    dependentExtra: '',
  })),
  remoteDependencyDrift: writeBlueprint('atomic-remote-dependency-drift', localPhp({
    dependencyVersion: '1.1.0',
    dependentVersion: '2.0.0',
    includeDependency: true,
    includeDependent: false,
  })),
  remotePreinstalledDependency: writeBlueprint('atomic-remote-preinstalled-dependency', localPhp({
    dependencyVersion: '1.0.0',
    dependentVersion: '2.0.0',
    includeDependency: true,
    includeDependent: false,
  })),
  localActivationFailure: writeBlueprint('atomic-local-activation-failure', localPhp({
    dependencyVersion: '1.0.0',
    dependentVersion: '1.0.0',
    includeDependency: true,
    includeDependent: true,
    dependentSlug: failingPlugin,
    dependentName: 'Reprint Push Atomic Failing Fixture',
    dependentActive: true,
    dependentExtra: "register_activation_hook(__FILE__, function () { throw new Exception('fixture activation failure'); });\n",
  })),
};

const snapshots = Object.fromEntries(
  Object.entries(blueprints).map(([name, blueprintPath]) => [name, exportSnapshot(name, blueprintPath)]),
);

for (const snapshot of Object.values(snapshots)) {
  snapshot.meta.fixture = snapshot.meta.fixture || 'plugin-atomic';
}

const positiveLocal = withAtomicIntent(snapshots.local, {
  dependency: {
    name: dependencyPlugin,
    expectedVersion: '1.0.0',
    active: true,
  },
  resources: positiveResourceKeys(),
});
const readyPlan = createPushPlan({
  base: snapshots.base,
  local: positiveLocal,
  remote: snapshots.base,
  now: fixedNow,
});

assert.equal(readyPlan.status, 'ready');
assert.equal(readyPlan.summary.conflicts, 0);
assert.equal(readyPlan.summary.blockers, 0);
assert.equal(readyPlan.summary.atomicGroups, 1);
assert.equal(readyPlan.atomicGroups[0].status, 'ready');
assert.deepEqual(readyPlan.mutations.map((mutation) => mutation.resourceKey).sort(), positiveResourceKeys().sort());
assertTargetHashes(readyPlan, snapshots.base, 'expectedHash', 'positive ready preconditions');

const summary = {
  transport: {
    host: '127.0.0.1',
    servers: [],
  },
  positive: {},
  negative: {},
  failureInjection: {},
  residualRisks: [
    'Playground smoke uses fixture-only plugin file/resource allowlists, not arbitrary plugin installation.',
    'During-publish failure is a deterministic lab hook proving blocked recovery classification, not production rollback.',
  ],
};

let readyReceipt;

await withPlaygroundServer('plugin-atomic-positive', blueprints.base, async (server) => {
  summary.transport.servers.push(server.summary);

  const initial = await getSnapshot(server);
  assert.equal(hasPlugin(initial.body.snapshot, dependentPlugin), false, 'base must lack dependent plugin');
  assert.equal(hasPlugin(initial.body.snapshot, dependencyPlugin), false, 'base must lack dependency plugin');

  const dryRunBefore = await getSnapshot(server);
  const dryRun = await postLab(server, '/dry-run', { plan: readyPlan });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.equal(dryRun.body.mode, 'dry-run');
  assert.equal(dryRun.body.applied, 0);
  assert.equal(dryRun.body.verifiedPreconditions.length, readyPlan.mutations.length);
  readyReceipt = dryRun.body.receipt;
  assert.ok(readyReceipt?.receiptHash, 'dry-run receipt hash missing');
  await assertNoTargetMutation(server, dryRunBefore.body.snapshot, 'positive dry-run');

  const applyBody = { plan: readyPlan, receipt: readyReceipt };
  const apply = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: 'plugin-atomic-positive-apply' });
  assert.equal(apply.status, 200);
  assert.equal(apply.body.ok, true);
  assert.equal(apply.body.applied, readyPlan.mutations.length);
  assert.equal(apply.body.idempotency?.freshMutationWork, true);

  const after = await getSnapshot(server);
  assertPluginStackInstalled(after.body.snapshot, dependentPlugin);
  assertAppliedHashes(readyPlan, after.body.snapshot);
  const afterDigest = digest(targetSurface(after.body.snapshot));

  const journalAfterApply = await getDbJournal(server);
  const mutationEventsAfterApply = countJournalEvents(journalEntries(journalAfterApply.body), 'mutation-applied');
  assert.equal(mutationEventsAfterApply, readyPlan.mutations.length);

  const replay = await postLab(server, '/apply', applyBody, { [idempotencyHeader]: 'plugin-atomic-positive-apply' });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.ok, true);
  assert.equal(replay.body.code, 'BATCH_ALREADY_COMMITTED');
  assert.equal(replay.body.idempotency?.freshMutationWork, false);
  const afterReplay = await getSnapshot(server);
  assert.equal(digest(targetSurface(afterReplay.body.snapshot)), afterDigest, 'idempotency replay changed plugin state');
  const journalAfterReplay = await getDbJournal(server);
  assert.equal(
    countJournalEvents(journalEntries(journalAfterReplay.body), 'mutation-applied'),
    mutationEventsAfterApply,
    'idempotency replay must not record fresh mutation work',
  );

  summary.positive = {
    dryRun: {
      status: dryRun.status,
      readOnly: true,
      receipt: Boolean(readyReceipt?.receiptHash),
    },
    apply: {
      status: apply.status,
      applied: apply.body.applied,
      installedPlugins: [dependencyPlugin, dependentPlugin],
      activated: [
        after.body.snapshot.plugins[dependencyPlugin].active,
        after.body.snapshot.plugins[dependentPlugin].active,
      ],
      allowlistedDataWritten: Boolean(after.body.snapshot.db.wp_options['option_name:reprint_push_atomic_fixture_data']),
    },
    replay: {
      status: replay.status,
      code: replay.body.code,
      freshMutationWork: replay.body.idempotency?.freshMutationWork,
      mutationEventsUnchanged: true,
    },
  };
});

assert.ok(readyReceipt, 'positive dry-run receipt was not captured');

await withPlaygroundServer('plugin-atomic-negative', blueprints.base, async (server) => {
  summary.transport.servers.push(server.summary);

  const cases = [
    {
      name: 'missingDependency',
      plan: blockedPlan({
        local: withoutPluginResources(positiveLocal, dependencyPlugin),
        dependency: { name: dependencyPlugin, expectedVersion: '1.0.0', active: true },
        resources: positiveResourceKeys().filter((key) => !key.includes(dependencyPlugin)),
      }),
      expectedBlocker: 'missing-plugin-dependency',
    },
    {
      name: 'dependencyOutsideAtomicGroup',
      plan: blockedPlan({
        local: withAtomicIntent(snapshots.local, {
          dependency: { name: dependencyPlugin, expectedVersion: '1.0.0', active: true },
          resources: positiveResourceKeys().filter((key) => key !== `plugin:${dependencyPlugin}`),
        }),
      }),
      expectedBlocker: 'plugin-dependency-outside-atomic-group',
    },
    {
      name: 'incompatibleVersion',
      plan: blockedPlan({
        local: withAtomicIntent(snapshots.local, {
          dependency: { name: dependencyPlugin, expectedVersion: '9.9.9', active: true },
          resources: positiveResourceKeys(),
        }),
      }),
      expectedBlocker: 'incompatible-plugin-dependency-version',
    },
    {
      name: 'hashMismatch',
      plan: blockedPlan({
        local: withAtomicIntent(snapshots.local, {
          dependency: { name: dependencyPlugin, expectedHash: '0'.repeat(64), active: true },
          resources: positiveResourceKeys(),
        }),
      }),
      expectedBlocker: 'plugin-dependency-hash-mismatch',
    },
    {
      name: 'activationRequirement',
      plan: blockedPlan({
        local: withAtomicIntent(withInactivePlugin(snapshots.local, dependencyPlugin), {
          dependency: { name: dependencyPlugin, expectedVersion: '1.0.0', active: true },
          resources: positiveResourceKeys(),
        }),
      }),
      expectedBlocker: 'incompatible-plugin-dependency-activation',
    },
    {
      name: 'remoteDependencyDrift',
      plan: createPushPlan({
        base: withoutPluginResources(snapshots.local, dependentPlugin),
        local: withAtomicIntent(snapshots.local, {
          dependency: { name: dependencyPlugin, expectedVersion: '1.0.0', active: true },
          resources: positiveResourceKeys().filter((key) => !key.includes(dependencyPlugin)),
        }),
        remote: snapshots.remoteDependencyDrift,
        now: fixedNow,
      }),
      expectedBlocker: 'remote-plugin-dependency-drift',
    },
  ];

  for (const testCase of cases) {
    assertPlanBlocked(testCase.plan, testCase.expectedBlocker);
    const before = await getSnapshot(server);
    const dryRun = await postLab(server, '/dry-run', { plan: testCase.plan });
    await assertPlanNotReadyNoMutation(server, dryRun, before.body.snapshot, `${testCase.name} dry-run`);
    const apply = await postLab(
      server,
      '/apply',
      { plan: testCase.plan, receipt: readyReceipt },
      { [idempotencyHeader]: `plugin-atomic-${testCase.name}` },
    );
    await assertPlanNotReadyNoMutation(server, apply, before.body.snapshot, `${testCase.name} apply`);
    summary.negative[testCase.name] = {
      blocker: testCase.expectedBlocker,
      dryRunStatus: dryRun.status,
      applyStatus: apply.status,
      code: apply.body.code,
      targetUnchanged: true,
    };
  }
});

await withPlaygroundServer('plugin-atomic-forged-ready', blueprints.base, async (server) => {
  summary.transport.servers.push(server.summary);

  const dependencyMutationId = readyPlan.mutations.find((mutation) => mutation.resourceKey === `plugin:${dependencyPlugin}`)?.id;
  const cases = [
    {
      name: 'missingDependencyClosure',
      plan: tamperReadyPlan(readyPlan, (plan) => {
        plan.mutations = plan.mutations.filter((mutation) => mutation.resourceKey !== `plugin:${dependencyPlugin}`);
        plan.preconditions = plan.preconditions.filter((entry) => entry.mutationId !== dependencyMutationId);
        plan.atomicGroups[0].mutationIds = plan.atomicGroups[0].mutationIds.filter((id) => id !== dependencyMutationId);
      }),
    },
    {
      name: 'missingAtomicGroupEvidence',
      plan: tamperReadyPlan(readyPlan, (plan) => {
        delete plan.atomicGroups;
        plan.summary.atomicGroups = 0;
      }),
      expectedMessage: /requires an atomic group dependency requirement/,
    },
    {
      name: 'missingDependencyRequirementEvidence',
      plan: tamperReadyPlan(readyPlan, (plan) => {
        delete plan.atomicGroups[0].dependencies;
        delete plan.atomicGroups[0].dependencyRequirements;
      }),
      expectedMessage: /requires an atomic group dependency requirement/,
    },
    {
      name: 'rowOnlyMissingAtomicGroupEvidence',
      plan: tamperReadyPlan(readyPlan, (plan) => {
        const rowMutationIds = new Set(
          plan.mutations
            .filter((mutation) => mutation.resourceKey === dependentOptionKey)
            .map((mutation) => mutation.id),
        );
        plan.mutations = plan.mutations.filter((mutation) => rowMutationIds.has(mutation.id));
        plan.preconditions = plan.preconditions.filter((entry) => rowMutationIds.has(entry.mutationId));
        delete plan.atomicGroups;
        plan.summary.atomicGroups = 0;
        plan.summary.mutations = plan.mutations.length;
      }),
      expectedMessage: /requires an atomic group dependency requirement/,
    },
    {
      name: 'incompatibleVersion',
      plan: tamperReadyPlan(readyPlan, (plan) => {
        plan.atomicGroups[0].dependencyRequirements[0].expectedVersion = '9.9.9';
      }),
    },
    {
      name: 'hashMismatch',
      plan: tamperReadyPlan(readyPlan, (plan) => {
        plan.atomicGroups[0].dependencyRequirements[0].expectedHash = '0'.repeat(64);
      }),
    },
    {
      name: 'badActiveRequirement',
      plan: tamperReadyPlan(readyPlan, (plan) => {
        plan.atomicGroups[0].dependencyRequirements[0].active = false;
      }),
    },
  ];

  for (const testCase of cases) {
    const before = await getSnapshot(server);
    const apply = await postLab(
      server,
      '/apply',
      { plan: testCase.plan, receipt: forgedReceipt(testCase.plan, before.body.snapshot) },
      { [idempotencyHeader]: `plugin-atomic-forged-${testCase.name}` },
    );
    await assertAtomicDependencyInvalidNoMutation(server, apply, before.body.snapshot, `${testCase.name} apply`);
    if (testCase.expectedMessage) {
      assert.match(apply.body.message, testCase.expectedMessage, `${testCase.name} error message`);
    }
    summary.negative[`forgedReady${testCase.name}`] = {
      status: apply.status,
      code: apply.body.code,
      targetUnchanged: true,
    };
  }
});

const remoteDependencyEvidenceBase = snapshots.remotePreinstalledDependency;
const remoteDependencyEvidenceLocal = withAtomicIntent(withUpdatedDependentOption(remoteDependencyEvidenceBase), {
  dependency: { name: dependencyPlugin, expectedVersion: '1.0.0', active: true },
  resources: [dependentOptionKey],
});
const remoteDependencyEvidencePlan = createPushPlan({
  base: remoteDependencyEvidenceBase,
  local: remoteDependencyEvidenceLocal,
  remote: remoteDependencyEvidenceBase,
  now: fixedNow,
});
assert.equal(remoteDependencyEvidencePlan.status, 'ready');
assert.equal(remoteDependencyEvidencePlan.atomicGroups[0].dependencyRequirements[0].source, 'live-remote');

await withPlaygroundServer('plugin-atomic-forged-stale-evidence', blueprints.remoteDependencyDrift, async (server) => {
  summary.transport.servers.push(server.summary);

  const before = await getSnapshot(server);
  assert.equal(before.body.snapshot.plugins[dependencyPlugin]?.version, '1.1.0');
  const apply = await postLab(
    server,
    '/apply',
    { plan: remoteDependencyEvidencePlan, receipt: forgedReceipt(remoteDependencyEvidencePlan, remoteDependencyEvidenceBase) },
    { [idempotencyHeader]: 'plugin-atomic-forged-stale-evidence' },
  );
  await assertAtomicDependencyInvalidNoMutation(server, apply, before.body.snapshot, 'stale dependency evidence apply');
  summary.negative.forgedReadyStaleDependencyEvidence = {
    status: apply.status,
    code: apply.body.code,
    targetUnchanged: true,
  };
});

await withPlaygroundServer('plugin-atomic-stale-precondition', blueprints.remotePreinstalledDependency, async (server) => {
  summary.transport.servers.push(server.summary);

  const before = await getSnapshot(server);
  assert.equal(hasPlugin(before.body.snapshot, dependencyPlugin), true, 'stale fixture should have dependency already installed');
  const stale = await postLab(
    server,
    '/apply',
    { plan: readyPlan, receipt: readyReceipt },
    { [idempotencyHeader]: 'plugin-atomic-stale-precondition' },
  );
  assert.equal(stale.status, 412);
  assert.equal(stale.body.ok, false);
  assert.equal(stale.body.code, 'PRECONDITION_FAILED');
  const after = await getSnapshot(server);
  assert.equal(digest(targetSurface(after.body.snapshot)), digest(targetSurface(before.body.snapshot)), 'stale precondition mutated target');
  summary.negative.stalePrecondition = {
    status: stale.status,
    code: stale.body.code,
    resourceKey: stale.body.resourceKey,
    targetUnchanged: true,
  };
});

const failingLocal = withAtomicIntent(snapshots.localActivationFailure, {
  dependency: { name: dependencyPlugin, expectedVersion: '1.0.0', active: true },
  resources: [
    `file:wp-content/plugins/${dependencyPlugin}/${dependencyPlugin}.php`,
    `file:wp-content/plugins/${failingPlugin}/${failingPlugin}.php`,
    `plugin:${dependencyPlugin}`,
    `plugin:${failingPlugin}`,
    dependentOptionKey,
  ],
});
const activationFailurePlan = createPushPlan({
  base: snapshots.base,
  local: failingLocal,
  remote: snapshots.base,
  now: fixedNow,
});
assert.equal(activationFailurePlan.status, 'ready');

await withPlaygroundServer('plugin-atomic-activation-failure', blueprints.base, async (server) => {
  summary.transport.servers.push(server.summary);

  const dryRun = await postLab(server, '/dry-run', { plan: activationFailurePlan });
  assert.equal(dryRun.status, 200);
  const body = { plan: activationFailurePlan, receipt: dryRun.body.receipt };
  const failed = await postLab(server, '/apply', body, { [idempotencyHeader]: 'plugin-atomic-activation-failure' });
  assert.equal(failed.status, 500);
  assert.equal(failed.body.ok, false);
  assert.ok(
    ['APPLY_LOOP_FAILED', 'LAB_INJECTED_APPLY_FAILURE'].includes(failed.body.code),
    `unexpected activation failure code ${failed.body.code}: ${JSON.stringify(failed.body)}`,
  );
  assert.equal(failed.body.recovery?.required, true);
  assert.notEqual(failed.body.recovery?.state, 'fully-updated-remote');
  const afterFailed = await getSnapshot(server);
  assert.equal(afterFailed.body.snapshot.plugins[failingPlugin]?.active, false, 'failing plugin must not be active after activation failure');
  const failedDigest = digest(targetSurface(afterFailed.body.snapshot));

  const retry = await postLab(server, '/apply', body, { [idempotencyHeader]: 'plugin-atomic-activation-failure' });
  const activationFailureRetryFreshMutationWork = retry.body.idempotency?.freshMutationWork ?? false;
  assert.equal(activationFailureRetryFreshMutationWork, false);
  const afterRetry = await getSnapshot(server);
  assert.equal(digest(targetSurface(afterRetry.body.snapshot)), failedDigest, 'activation failure retry overwrote target');

  summary.negative.activationFailure = {
    status: failed.status,
    code: failed.body.code,
    recoveryState: failed.body.recovery?.state,
    failingPluginActive: Boolean(afterFailed.body.snapshot.plugins[failingPlugin]?.active),
    retryFreshMutationWork: activationFailureRetryFreshMutationWork,
  };
});

await withPlaygroundServer('plugin-atomic-fail-before-group-commit', blueprints.base, async (server) => {
  summary.transport.servers.push(server.summary);

  const before = await getSnapshot(server);
  const dryRun = await postLab(server, '/dry-run', { plan: readyPlan });
  const body = {
    plan: readyPlan,
    receipt: dryRun.body.receipt,
    labFailAfterMutations: 0,
  };
  const failed = await postLab(server, '/apply', body, { [idempotencyHeader]: 'plugin-atomic-fail-before-commit' });
  assert.equal(failed.status, 500);
  assert.equal(failed.body.ok, false);
  assert.equal(failed.body.code, 'LAB_INJECTED_APPLY_FAILURE');
  assert.equal(failed.body.applied, 0);
  assert.equal(failed.body.recovery?.state, 'old-remote');
  await assertNoTargetMutation(server, before.body.snapshot, 'fail before group commit');

  const retry = await postLab(server, '/apply', body, { [idempotencyHeader]: 'plugin-atomic-fail-before-commit' });
  const beforeCommitRetryFreshMutationWork = retry.body.idempotency?.freshMutationWork ?? false;
  assert.equal(beforeCommitRetryFreshMutationWork, false);

  summary.failureInjection.beforeGroupCommit = {
    status: failed.status,
    code: failed.body.code,
    applied: failed.body.applied,
    recoveryState: failed.body.recovery?.state,
    oldRemotePreserved: true,
    retryFreshMutationWork: beforeCommitRetryFreshMutationWork,
  };
});

await withPlaygroundServer('plugin-atomic-fail-during-group-publish', blueprints.base, async (server) => {
  summary.transport.servers.push(server.summary);

  const dryRun = await postLab(server, '/dry-run', { plan: readyPlan });
  const body = {
    plan: readyPlan,
    receipt: dryRun.body.receipt,
    labFailAfterMutations: 1,
  };
  const failed = await postLab(server, '/apply', body, { [idempotencyHeader]: 'plugin-atomic-fail-during-publish' });
  assert.equal(failed.status, 500);
  assert.equal(failed.body.ok, false);
  assert.equal(failed.body.code, 'LAB_INJECTED_APPLY_FAILURE');
  assert.equal(failed.body.recovery?.state, 'blocked-recovery');
  const afterFailed = await getSnapshot(server);
  const failedDigest = digest(targetSurface(afterFailed.body.snapshot));
  assert.notEqual(hasPlugin(afterFailed.body.snapshot, dependentPlugin), true, 'dependent plugin must not be successfully installed after partial failure');

  const retry = await postLab(server, '/apply', body, { [idempotencyHeader]: 'plugin-atomic-fail-during-publish' });
  const duringPublishRetryFreshMutationWork = retry.body.idempotency?.freshMutationWork ?? false;
  assert.equal(duringPublishRetryFreshMutationWork, false);
  const afterRetry = await getSnapshot(server);
  assert.equal(digest(targetSurface(afterRetry.body.snapshot)), failedDigest, 'partial failure retry overwrote target');

  summary.failureInjection.duringGroupPublish = {
    status: failed.status,
    code: failed.body.code,
    applied: failed.body.applied,
    recoveryState: failed.body.recovery?.state,
    retryFreshMutationWork: duringPublishRetryFreshMutationWork,
    targetUnchangedOnRetry: true,
  };
});

console.log(JSON.stringify(summary, null, 2));

function writeBlueprint(name, phpCode) {
  const file = path.join(tmpDir, `${name}.blueprint.json`);
  const blueprint = {
    $schema: 'https://playground.wordpress.net/blueprint-schema.json',
    meta: {
      title: `Reprint Push ${name}`,
      description: 'Fixture generated by plugin atomic install smoke.',
      author: 'Reprint Push Lab',
    },
    preferredVersions: {
      php: '8.3',
      wp: 'latest',
    },
    steps: [
      {
        step: 'setSiteOptions',
        options: {
          blogname: `Reprint Push ${name}`,
          reprint_push_fixture: name,
        },
      },
      {
        step: 'runPHP',
        code: phpCode,
      },
    ],
  };
  fs.writeFileSync(file, `${JSON.stringify(blueprint, null, 2)}\n`);
  return file;
}

function basePhp() {
  return "<?php require_once '/wordpress/wp-load.php'; update_option('reprint_push_fixture', 'plugin-atomic-base');";
}

function localPhp({
  dependencyVersion,
  dependentVersion,
  includeDependency,
  includeDependent,
  dependentSlug = dependentPlugin,
  dependentName = 'Reprint Push Atomic Dependent Fixture',
  dependentActive = true,
  dependentExtra = '',
}) {
  const pluginWrites = [];
  if (includeDependency) {
    pluginWrites.push(writePluginPhp({
      slug: dependencyPlugin,
      name: 'Reprint Push Atomic Dependency Fixture',
      version: dependencyVersion,
      active: true,
      extra: "function reprint_push_atomic_dependency_fixture_loaded() { return 'dependency-loaded'; }\n",
    }));
  }
  if (includeDependent) {
    pluginWrites.push(writePluginPhp({
      slug: dependentSlug,
      name: dependentName,
      version: dependentVersion,
      active: dependentActive,
      extra: dependentExtra,
    }));
  }

  return [
    "<?php require_once '/wordpress/wp-load.php';",
    "update_option('reprint_push_fixture', 'plugin-atomic-local');",
    helperPhp(),
    ...pluginWrites,
    "update_option('reprint_push_atomic_fixture_data', array('owner'=>'reprint-push-atomic-dependent-fixture','mode'=>'local-install','revision'=>'plugin-atomic-001','enabled'=>true,'plugins'=>array('dependency'=>'1.0.0','dependent'=>'2.0.0')));",
  ].join(' ');
}

function helperPhp() {
  return [
    'function reprint_push_atomic_write_plugin($slug, $name, $version, $active, $extra) {',
    '  $dir = WP_PLUGIN_DIR . "/" . $slug;',
    '  wp_mkdir_p($dir);',
    '  $header = "<?php\\n/*\\nPlugin Name: " . $name . "\\nVersion: " . $version . "\\n*/\\n";',
    '  file_put_contents($dir . "/" . $slug . ".php", $header . $extra);',
    '  $basename = $slug . "/" . $slug . ".php";',
    '  $active_plugins = get_option("active_plugins", array());',
    '  if (!is_array($active_plugins)) { $active_plugins = array(); }',
    '  $active_plugins = array_values(array_diff($active_plugins, array($basename)));',
    '  if ($active) { $active_plugins[] = $basename; }',
    '  update_option("active_plugins", $active_plugins);',
    '}',
  ].join(' ');
}

function writePluginPhp({ slug, name, version, active, extra }) {
  return `reprint_push_atomic_write_plugin(${phpString(slug)}, ${phpString(name)}, ${phpString(version)}, ${active ? 'true' : 'false'}, ${phpString(extra)});`;
}

function phpString(value) {
  return JSON.stringify(String(value));
}

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

async function withPlaygroundServer(name, blueprintPath, run) {
  const server = await startPlaygroundServerWithRetry(name, blueprintPath);
  try {
    await run(server);
  } finally {
    await stopPlaygroundServer(server);
  }
}

async function startPlaygroundServerWithRetry(name, blueprintPath) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await startPlaygroundServer(name, blueprintPath);
    } catch (error) {
      lastError = error;
      if (attempt === 3) {
        break;
      }
      await sleep(1_000 * attempt);
    }
  }
  throw lastError;
}

async function startPlaygroundServer(name, blueprintPath) {
  const port = await findLocalPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = [];
  const args = [
    '--yes',
    '@wp-playground/cli@latest',
    'server',
    '--blueprint',
    blueprintPath,
    '--mount',
    `${repoRoot}:/workspace`,
    '--mount',
    `${muPluginDir}:/wordpress/wp-content/mu-plugins`,
    '--site-url',
    baseUrl,
    '--port',
    String(port),
    '--workers',
    '1',
    '--verbosity',
    'quiet',
  ];

  const child = spawn('npx', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, localhostListenPreloadOption()),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => pushLog(logs, chunk));
  child.stderr.on('data', (chunk) => pushLog(logs, chunk));

  let listenerCheck;
  try {
    await waitForServer(child, baseUrl, logs);
    listenerCheck = assertLocalhostListener(port);
  } catch (error) {
    await stopChildProcess(child);
    throw error;
  }

  return {
    name,
    port,
    baseUrl,
    child,
    logs,
    summary: {
      name,
      baseUrl,
      port,
      listenerCheck,
      stopped: false,
    },
  };
}

async function stopPlaygroundServer(server) {
  await stopChildProcess(server.child);
  assert.equal(await isPortAccepting(server.port), false, `Playground server still accepts connections on ${server.baseUrl}`);
  server.summary.stopped = true;
}

async function stopChildProcess(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGTERM');
  try {
    await waitForExit(child, 12_000);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child, 12_000);
  }
}

async function waitForServer(child, baseUrl, logs) {
  const deadline = Date.now() + serverStartupTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Playground server exited early with ${child.exitCode}\n${logs.join('')}`);
    }

    try {
      const response = await fetch(`${baseUrl}/wp-json/`);
      if (response.status === 200) {
        await response.arrayBuffer();
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Playground server at ${baseUrl}: ${lastError?.message ?? 'unknown'}\n${logs.join('')}`);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Timed out waiting for Playground server exit'));
    }, timeoutMs);

    function onExit() {
      clearTimeout(timer);
      resolve();
    }

    child.once('exit', onExit);
  });
}

async function findLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.equal(typeof address, 'object');
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function assertLocalhostListener(port) {
  const result = spawnSync('ss', ['-H', '-ltn', 'sport', '=', `:${port}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return {
      tool: 'ss',
      status: 'skipped',
      reason: (result.stderr || result.stdout || 'ss command unavailable').trim(),
    };
  }

  const lines = result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  assert.ok(lines.length > 0, `No listener found for Playground port ${port}`);

  for (const line of lines) {
    const fields = line.split(/\s+/);
    const localAddress = fields[3] || '';
    assert.ok(
      localAddress === `127.0.0.1:${port}` || localAddress === `[127.0.0.1]:${port}`,
      `Playground listener must be 127.0.0.1 only, got: ${line}`,
    );
  }

  return {
    tool: 'ss',
    status: 'checked',
    listeners: lines,
  };
}

function localhostListenPreloadOption() {
  const source = `
import http from 'node:http';
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function reprintPushLocalhostListen(...args) {
  if (typeof args[0] === 'number' && (args.length === 1 || typeof args[1] === 'function')) {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  if (typeof args[0] === 'number' && typeof args[1] === 'number') {
    return originalListen.call(this, args[0], '127.0.0.1', ...args.slice(1));
  }
  return Reflect.apply(originalListen, this, args);
};
`;
  return `--import=data:text/javascript,${encodeURIComponent(source)}`;
}

function appendNodeOption(existing, option) {
  return [existing, option].filter(Boolean).join(' ');
}

async function isPortAccepting(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function getSnapshot(server) {
  const response = await getLab(server, '/snapshot');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.ok(response.body.snapshot, 'snapshot response missing snapshot');
  return response;
}

async function getDbJournal(server) {
  const response = await getLab(server, '/db-journal?limit=80');
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  return response;
}

async function getLab(server, pathSuffix) {
  return requestJson(server, 'GET', `/wp-json/reprint-push-lab/v1${pathSuffix}`);
}

async function postLab(server, pathSuffix, body, headers = {}) {
  return requestJson(server, 'POST', `/wp-json/reprint-push-lab/v1${pathSuffix}`, body, headers);
}

async function requestJson(server, method, pathname, body = undefined, headers = {}) {
  const response = await fetch(`${server.baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? headers : {
      'content-type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Expected JSON from ${method} ${pathname}, got HTTP ${response.status}\n${text}\n${error.message}`);
  }
  return {
    status: response.status,
    body: json,
  };
}

function withAtomicIntent(snapshot, { dependency, resources }) {
  const copy = JSON.parse(JSON.stringify(snapshot));
  copy.pushIntents = [
    {
      id: atomicGroupId,
      kind: 'plugin-install',
      label: 'Install atomic dependent plugin fixture',
      requireAtomic: true,
      resources,
      dependencies: {
        plugins: [dependency],
      },
      resourcePolicy: {
        allowedResources: [
          {
            resourceKey: dependentOptionKey,
            pluginOwner: dependency.name === failingPlugin ? failingPlugin : dependentPlugin,
            driver: 'wp-option',
          },
        ],
      },
    },
  ];
  return copy;
}

function blockedPlan({ local, dependency, resources } = {}) {
  return createPushPlan({
    base: snapshots.base,
    local: local || withAtomicIntent(snapshots.local, { dependency, resources }),
    remote: snapshots.base,
    now: fixedNow,
  });
}

function withoutPluginResources(snapshot, plugin) {
  const copy = JSON.parse(JSON.stringify(snapshot));
  delete copy.plugins?.[plugin];
  for (const key of Object.keys(copy.files || {})) {
    if (key.startsWith(`wp-content/plugins/${plugin}/`)) {
      delete copy.files[key];
    }
  }
  return copy;
}

function withInactivePlugin(snapshot, plugin) {
  const copy = JSON.parse(JSON.stringify(snapshot));
  assert.ok(copy.plugins?.[plugin], `missing plugin in fixture snapshot: ${plugin}`);
  copy.plugins[plugin].active = false;
  return copy;
}

function withUpdatedDependentOption(snapshot) {
  const copy = JSON.parse(JSON.stringify(snapshot));
  copy.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: {
      enabled: true,
      mode: 'remote-dependency-evidence-update',
      owner: dependentPlugin,
      plugins: {
        dependency: '1.0.0',
        dependent: '2.0.0',
      },
      revision: 'plugin-atomic-002',
    },
    __pluginOwner: dependentPlugin,
  };
  return copy;
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

function forgedReceipt(plan, snapshot) {
  const evidence = planEvidence(plan);
  const verifiedPreconditions = plan.preconditions.map((precondition) => ({
    mutationId: String(precondition.mutationId),
    resourceKey: String(precondition.resourceKey),
    expectedHash: String(precondition.expectedHash),
    actualHash: String(precondition.expectedHash),
  }));
  const receipt = {
    schemaVersion: 1,
    protocol: 'reprint-push-lab',
    mode: 'dry-run',
    planId: plan.id ?? null,
    planHash: evidence.planHash,
    planFingerprint: evidence.planFingerprint,
    summaryHash: evidence.summaryHash,
    mutationSetHash: evidence.mutationSetHash,
    preconditionSetHash: evidence.preconditionSetHash,
    snapshotHash: digest(snapshot),
    mutationCount: plan.mutations.length,
    verifiedResourceKeys: plan.mutations.map((mutation) => String(mutation.resourceKey)),
    planPreconditions: planPreconditionHashes(plan.preconditions),
    preconditionHashes: verifiedPreconditions,
  };
  receipt.receiptHash = digest(receipt);
  return receipt;
}

function planEvidence(plan) {
  const mutations = plan.mutations || [];
  const preconditions = plan.preconditions || [];
  return {
    planHash: digest(plan),
    planFingerprint: digest({
      id: plan.id ?? null,
      status: plan.status ?? null,
      summary: plan.summary ?? null,
      mutations: mutationBindings(mutations),
      preconditions: preconditionBindings(preconditions),
    }),
    summaryHash: digest(plan.summary ?? null),
    mutationSetHash: digest(mutationBindings(mutations)),
    preconditionSetHash: digest(preconditionBindings(preconditions)),
  };
}

function mutationBindings(mutations) {
  return mutations.map((mutation) => ({
    id: String(mutation.id),
    resourceKey: String(mutation.resourceKey),
    resource: mutation.resource,
    action: mutation.action ?? null,
    changeKind: mutation.changeKind ?? null,
    baseHash: mutation.baseHash ?? null,
    remoteBeforeHash: mutation.remoteBeforeHash ?? null,
    localHash: mutation.localHash ?? null,
  }));
}

function preconditionBindings(preconditions) {
  return preconditions.map((precondition) => ({
    mutationId: String(precondition.mutationId),
    resourceKey: String(precondition.resourceKey),
    resource: precondition.resource,
    expectedHash: String(precondition.expectedHash),
  }));
}

function planPreconditionHashes(preconditions) {
  return preconditions.map((precondition) => ({
    mutationId: String(precondition.mutationId),
    resourceKey: String(precondition.resourceKey),
    expectedHash: String(precondition.expectedHash),
  }));
}

function positiveResourceKeys() {
  return [
    `file:wp-content/plugins/${dependencyPlugin}/${dependencyPlugin}.php`,
    `file:wp-content/plugins/${dependentPlugin}/${dependentPlugin}.php`,
    `plugin:${dependencyPlugin}`,
    `plugin:${dependentPlugin}`,
    dependentOptionKey,
  ];
}

function assertPlanBlocked(plan, expectedClass) {
  assert.equal(plan.status, 'blocked', `expected blocked plan for ${expectedClass}`);
  assert.ok(
    plan.blockers.some((blocker) => blocker.class === expectedClass),
    `missing blocker class ${expectedClass}: ${JSON.stringify(plan.blockers)}`,
  );
}

async function assertAtomicDependencyInvalidNoMutation(server, response, expectedSnapshot, label) {
  assert.equal(response.status, 409, `${label} HTTP status`);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'ATOMIC_GROUP_DEPENDENCY_INVALID');
  assert.equal(response.body.dbJournal?.event || response.body.journal?.event, 'apply-rejected');
  await assertNoTargetMutation(server, expectedSnapshot, label);
}

async function assertPlanNotReadyNoMutation(server, response, expectedSnapshot, label) {
  assert.equal(response.status, 409, `${label} HTTP status`);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.code, 'PLAN_NOT_READY');
  assert.equal(response.body.journal?.event || response.body.dbJournal?.event || 'plan-not-ready', 'plan-not-ready');
  await assertNoTargetMutation(server, expectedSnapshot, label);
}

async function assertNoTargetMutation(server, expectedSnapshot, label) {
  const after = await getSnapshot(server);
  assert.equal(digest(targetSurface(after.body.snapshot)), digest(targetSurface(expectedSnapshot)), `${label} target surface changed`);
}

function assertPluginStackInstalled(snapshot, expectedDependentPlugin) {
  assert.equal(snapshot.files[`wp-content/plugins/${dependencyPlugin}/${dependencyPlugin}.php`]?.includes('Atomic Dependency'), true);
  assert.equal(snapshot.files[`wp-content/plugins/${expectedDependentPlugin}/${expectedDependentPlugin}.php`]?.includes('Plugin Name:'), true);

  assert.equal(snapshot.plugins[dependencyPlugin]?.version, '1.0.0');
  assert.equal(snapshot.plugins[dependencyPlugin]?.active, true);
  assert.equal(snapshot.plugins[expectedDependentPlugin]?.active, true);

  const data = snapshot.db.wp_options['option_name:reprint_push_atomic_fixture_data'];
  assert.equal(data.__pluginOwner, dependentPlugin);
  assert.deepEqual(data.option_value, {
    enabled: true,
    mode: 'local-install',
    owner: dependentPlugin,
    plugins: {
      dependency: '1.0.0',
      dependent: '2.0.0',
    },
    revision: 'plugin-atomic-001',
  });
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
      `applied hash mismatch: ${mutation.resourceKey}`,
    );
  }
}

function hasPlugin(snapshot, plugin) {
  return Object.hasOwn(snapshot.plugins || {}, plugin);
}

function targetSurface(snapshot) {
  return {
    files: snapshot.files,
    plugins: snapshot.plugins,
    db: snapshot.db,
  };
}

function journalEntries(body) {
  const journal = body.journal ?? body.dbJournal ?? body;
  return journal.entries ?? journal.latestRows ?? body.entries ?? [];
}

function countJournalEvents(entries, event) {
  return entries.filter((entry) => journalEvent(entry) === event).length;
}

function journalEvent(entry) {
  return entry.event ?? entry.eventName ?? entry.event_name ?? entry.type ?? entry.name;
}

function parseMarkedJson(stdout, begin, end, missingMessage) {
  const match = stdout.match(new RegExp(`${begin}\\n([\\s\\S]*)\\n${end}`));
  if (!match) {
    throw new Error(missingMessage);
  }
  return JSON.parse(match[1]);
}

function pushLog(logs, chunk) {
  logs.push(chunk);
  while (logs.join('').length > 20_000) {
    logs.shift();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
