import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { enumerateResources, resourceHash } from '../src/resources.js';

import {
  DEFAULT_GENERATED_PUSH_CASES,
  MIN_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
  runGeneratedPushHarness,
} from '../scripts/harness/generated-push-cases.js';


const fixedNow = new Date('2026-05-28T00:00:00.000Z');

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function focusedIndependentFileRemoteRowFixture() {
  const base = {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/uploads/shared.txt': 'base shared upload',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
      wp_options: {},
    },
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files['wp-content/uploads/shared.txt'] = 'local file edit should be applied';
  remote.db.wp_posts['ID:1'].post_title = 'Remote editorial row edit must be preserved';

  return {
    label: 'focused-independent-file-row',
    base,
    local,
    remote,
    localFileKey: 'file:wp-content/uploads/shared.txt',
    remoteRowKey: rowResourceKey('wp_posts', 'ID:1'),
  };
}

function generatedIndependentFileRemoteRowFixture() {
  for (const testCase of generatePushHarnessCases()) {
    if (testCase.family !== 'independent-local-and-remote' || !testCase.tags.has('independent-merge')) {
      continue;
    }

    const localFileKeys = oneSidedChangedResourceKeys(testCase, {
      prefix: 'file:',
      side: 'local',
    });
    const remoteRowKeys = oneSidedChangedResourceKeys(testCase, {
      prefix: 'row:',
      side: 'remote',
    });

    if (localFileKeys.length > 0 && remoteRowKeys.length > 0) {
      return {
        label: `${testCase.id}:${testCase.family}`,
        base: testCase.base,
        local: testCase.local,
        remote: testCase.remote,
        localFileKey: localFileKeys[0],
        remoteRowKey: remoteRowKeys[0],
      };
    }
  }

  assert.fail('generated harness did not produce an independent local file plus remote row fixture');
}

function oneSidedChangedResourceKeys({ base, local, remote }, { prefix, side }) {
  return enumerateResources(base, local, remote)
    .filter((resource) => {
      if (!resource.key.startsWith(prefix)) {
        return false;
      }

      const baseHash = resourceHash(base, resource);
      const localHash = resourceHash(local, resource);
      const remoteHash = resourceHash(remote, resource);

      if (side === 'local') {
        return localHash !== baseHash && remoteHash === baseHash;
      }
      return remoteHash !== baseHash && localHash === baseHash;
    })
    .map((resource) => resource.key)
    .sort((left, right) => left.localeCompare(right));
}

function assertIndependentLocalFileRemoteRowInvariant(fixture) {
  const plan = createPushPlan({
    base: fixture.base,
    local: fixture.local,
    remote: fixture.remote,
    now: fixedNow,
  });
  const fileMutation = plan.mutations.find((mutation) => mutation.resourceKey === fixture.localFileKey);
  const rowMutation = plan.mutations.find((mutation) => mutation.resourceKey === fixture.remoteRowKey);
  const rowDecision = plan.decisions.find((decision) => decision.resourceKey === fixture.remoteRowKey);

  assert.equal(plan.status, 'ready', fixture.label);
  assert.ok(fileMutation, `${fixture.label} should plan the independent local file mutation`);
  assert.equal(fileMutation.action, 'put', fixture.label);
  assert.equal(fileMutation.change.localChange === 'create' || fileMutation.change.localChange === 'update', true);
  assert.equal(fileMutation.change.remoteChange, 'unchanged', fixture.label);
  assert.equal(rowMutation, undefined, `${fixture.label} must not overwrite the independently edited remote row`);
  assert.equal(rowDecision?.decision, 'keep-remote', fixture.label);
  assert.equal(rowDecision.change.localChange, 'unchanged', fixture.label);
  assert.equal(rowDecision.change.remoteChange, 'update', fixture.label);

  const precondition = plan.preconditions.find((entry) => entry.mutationId === fileMutation.id);
  assert.ok(precondition, `${fixture.label} should bind the file mutation to live remote state`);
  assert.equal(precondition.resourceKey, fixture.localFileKey, fixture.label);
  assert.equal(precondition.expectedHash, fileMutation.remoteBeforeHash, fixture.label);
  assert.equal(precondition.expectedHash, resourceHash(fixture.remote, fileMutation.resource), fixture.label);
  assert.equal(precondition.checkedAgainst, 'live-remote', fixture.label);

  const applied = applyPlan(cloneJson(fixture.remote), plan).site;
  assert.equal(resourceHashByKey(applied, fixture, fixture.localFileKey), resourceHashByKey(fixture.local, fixture, fixture.localFileKey));
  assert.equal(resourceHashByKey(applied, fixture, fixture.remoteRowKey), resourceHashByKey(fixture.remote, fixture, fixture.remoteRowKey));

  const staleRemote = cloneJson(fixture.remote);
  staleRemote.files[fileMutation.resource.path] = `stale remote file edit for ${fixture.label}`;
  const staleError = captureError(() => applyPlan(staleRemote, plan));
  assert.ok(staleError instanceof PushPlanError, fixture.label);
  assert.equal(staleError.code, 'PRECONDITION_FAILED', fixture.label);
  assert.equal(resourceHashByKey(staleRemote, fixture, fixture.remoteRowKey), resourceHashByKey(fixture.remote, fixture, fixture.remoteRowKey));
}

function resourceHashByKey(site, fixture, resourceKey) {
  const resource = enumerateResources(fixture.base, fixture.local, fixture.remote, site)
    .find((entry) => entry.key === resourceKey);
  assert.ok(resource, `missing resource ${resourceKey}`);
  return resourceHash(site, resource);
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to throw');
}

const requiredFamilies = [
  'local-file-update',
  'remote-only-post-update',
  'independent-local-and-remote',
  'direct-row-conflict',
  'local-delete',
  'same-independent-content',
  'supported-plugin-option',
  'unsupported-plugin-owned-row',
  'plugin-owner-context-drift',
  'file-topology-conflict',
  'same-plan-post-parent-graph',
  'stale-graph-reference',
  'same-plan-taxonomy-graph',
  'same-plan-comment-graph',
  'supported-forms-lab-table',
  'forms-lab-delete-blocked',
  'atomic-plugin-stack-ready',
  'atomic-plugin-missing-dependency',
  'plugin-file-update',
  'plugin-context-metadata-drift',
  'remote-delete-local-unchanged',
  'local-create',
  'delete-edit-conflict',
  'same-plan-user-meta-graph',
  'same-plan-graph',
  'plugin-owned-supported',
  'plugin-owned-unsupported',
  'file-topology',
  'expected-conflict',
  'atomic-ready',
  'atomic-blocked',
];

test('generated push harness covers 300+ general cases from trivial to highly complex', () => {
  const report = runGeneratedPushHarness();
  const { summary } = report;

  assert.equal(summary.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.ok(summary.totalCases >= MIN_GENERATED_PUSH_CASES);
  assert.equal(Object.keys(summary.tiers).length, 10);
  for (let tier = 0; tier <= 9; tier++) {
    assert.ok(summary.tiers[tier] > 0, `missing tier ${tier}`);
  }

  for (const family of requiredFamilies) {
    assert.ok(summary.featureFamilies[family] > 0, `missing generated family ${family}`);
  }

  assert.ok(summary.statuses.ready > 0, 'expected ready generated cases');
  assert.ok(summary.statuses.conflict > 0, 'expected conflict generated cases');
  assert.ok(summary.statuses.blocked > 0, 'expected blocked generated cases');
  assert.ok(summary.maxResourceCount >= 45, 'high-complexity cases need broad resource surfaces');
  assert.ok(summary.maxMutationCount >= 15, 'high-complexity cases need substantial mutation plans');
  assert.ok(summary.statusByTier.ready[9] > 0, 'tier 9 must include ready/apply cases');
  assert.ok(summary.maxReadyResourceCount >= 45, 'ready cases need high-complexity resource surfaces');
  assert.ok(summary.maxReadyMutationCount >= 15, 'ready cases need substantial mutation plans');
  assert.ok(summary.totalMutations > summary.totalCases, 'harness should exercise more mutations than cases');
  assert.ok(summary.totalConflicts > 0);
  assert.ok(summary.totalBlockers > 0);
  assert.ok(summary.totalDecisions > 0);
});

test('proves independent local file plus remote row edit over focused and generated fixtures', () => {
  for (const fixture of [
    focusedIndependentFileRemoteRowFixture(),
    generatedIndependentFileRemoteRowFixture(),
  ]) {
    assertIndependentLocalFileRemoteRowInvariant(fixture);
  }
});
