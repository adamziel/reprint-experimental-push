import test from 'node:test';
import assert from 'node:assert/strict';

import { createPushPlan } from '../src/planner.js';

import {
  DEFAULT_GENERATED_PUSH_CASES,
  MIN_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

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
  'directory-descendant-conflict',
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
  'file-create-update-delete-mix-ready',
  'file-create-update-delete-mix-conflict',
  'file-create-update-delete-mix',
  'file-type-swap-ready',
  'file-type-swap-conflict',
  'file-type-swap',
  'type-swap-ready',
  'type-swap-conflict',
  'row-create-update-delete-mix-ready',
  'row-create-update-delete-mix-conflict',
  'row-create-update-delete-mix',
  'row-create',
  'row-update',
  'row-delete',
  'wp-posts-create-update-delete-ready',
  'wp-posts-create-update-delete-conflict',
  'wp-posts-create-update-delete',
  'wp-posts-create',
  'wp-posts-update',
  'wp-posts-delete',
  'wp-term-taxonomy-graph-ready',
  'wp-term-taxonomy-graph-stale',
  'wp-term-taxonomy-graph',
  'wp-terms-create',
  'wp-term-taxonomy-create',
  'wp-terms-remote-drift',
  'term-taxonomy-term-graph',
  'expected-blocked',
  'same-plan-user-meta-graph',
  'same-plan-graph',
  'plugin-owned-supported',
  'plugin-owned-unsupported',
  'file-topology',
  'directory-descendant',
  'directory-delete-with-remote-descendant',
  'type-change',
  'expected-conflict',
  'atomic-ready',
  'atomic-blocked',
  'atomic-plugin-install-stack',
  'atomic-remote-preserve',
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

test('RPP-0101 generated harness emits ready and non-ready file create/update/delete mix cases', () => {
  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'file-create-update-delete-mix-ready');
  const nonReadyCase = cases.find((testCase) => testCase.family === 'file-create-update-delete-mix-conflict');

  assert.ok(readyCase, 'missing ready file create/update/delete mix case');
  assert.ok(nonReadyCase, 'missing non-ready file create/update/delete mix case');
  assert.ok(readyCase.tags.has('file-create-update-delete-mix'));
  assert.ok(nonReadyCase.tags.has('file-create-update-delete-mix'));

  const ready = validateGeneratedCase(readyCase);
  const nonReady = validateGeneratedCase(nonReadyCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 3, 'ready mix should create, update, and delete files');
  assert.equal(nonReady.status, 'conflict');
  assert.ok(nonReady.conflicts >= 1, 'non-ready mix should expose a file conflict');
  assert.equal(nonReady.applied, false, 'non-ready mix must not apply mutations');
});

test('RPP-0102 directory descendant conflict exposes per-tier target counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.directoryDescendantConflict;

  assert.ok(coverage, 'missing directory descendant conflict target coverage');
  assert.equal(coverage.family, 'directory-descendant-conflict');
  assert.equal(coverage.total, report.summary.featureFamilies['directory-descendant-conflict']);
  assert.deepEqual(coverage.statuses, { conflict: coverage.total });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const conflictCase = generatePushHarnessCases()
    .find((testCase) => testCase.family === 'directory-descendant-conflict');
  assert.ok(conflictCase, 'missing generated directory descendant conflict case');
  assert.ok(conflictCase.tags.has('directory-descendant'));
  assert.ok(conflictCase.tags.has('directory-delete-with-remote-descendant'));

  const result = validateGeneratedCase(conflictCase);
  assert.equal(result.status, 'conflict');
  assert.ok(result.conflicts > 0, 'directory descendant case must conflict');
  assert.equal(result.applied, false, 'directory descendant conflict must not apply mutations');
});

test('RPP-0103 generated harness emits ready and non-ready file type-swap cases', () => {
  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'file-type-swap-ready');
  const nonReadyCase = cases.find((testCase) => testCase.family === 'file-type-swap-conflict');

  assert.ok(readyCase, 'missing ready file type-swap case');
  assert.ok(nonReadyCase, 'missing non-ready file type-swap case');
  assert.ok(readyCase.tags.has('file-type-swap'));
  assert.ok(nonReadyCase.tags.has('file-type-swap'));
  assert.ok(readyCase.tags.has('type-swap-ready'));
  assert.ok(nonReadyCase.tags.has('type-swap-conflict'));

  const ready = validateGeneratedCase(readyCase);
  const nonReady = validateGeneratedCase(nonReadyCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready type-swap should plan at least one file mutation');
  assert.equal(ready.applied, true, 'ready type-swap should apply through the harness');
  assert.equal(nonReady.status, 'conflict');
  assert.ok(nonReady.conflicts >= 1, 'non-ready type-swap should expose a file topology conflict');
  assert.equal(nonReady.applied, false, 'non-ready type-swap must not apply mutations');
});

test('RPP-0104 generated harness emits row create/update/delete mix with stale replay guard', () => {
  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'row-create-update-delete-mix-ready');
  const nonReadyCase = cases.find((testCase) => testCase.family === 'row-create-update-delete-mix-conflict');

  assert.ok(readyCase, 'missing ready row create/update/delete mix case');
  assert.ok(nonReadyCase, 'missing non-ready row create/update/delete mix case');
  assert.ok(readyCase.tags.has('row-create-update-delete-mix'));
  assert.ok(nonReadyCase.tags.has('row-create-update-delete-mix'));
  assertRowMixShape(readyCase);
  assertRowMixShape(nonReadyCase);

  const ready = validateGeneratedCase(readyCase);
  const nonReady = validateGeneratedCase(nonReadyCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 3, 'ready row mix should create, update, and delete rows');
  assert.equal(ready.applied, true, 'ready row mix should apply through the harness');
  assert.equal(ready.staleReplayRejected, true, 'ready row mix should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(nonReady.status, 'conflict');
  assert.ok(nonReady.conflicts >= 1, 'non-ready row mix should expose a row conflict');
  assert.equal(nonReady.applied, false, 'non-ready row mix must not apply mutations');
});

function assertRowMixShape(testCase) {
  const createRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => !testCase.base.db.wp_posts[id] && row.post_title.startsWith('Generated row mix create '));
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated row mix update '));
  const deleteRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([id, row]) => row.post_title.startsWith('Base row mix delete ')
      && !testCase.local.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]);

  assert.equal(createRows.length, 1, `${testCase.id} should create one row`);
  assert.equal(updateRows.length, 1, `${testCase.id} should update one row`);
  assert.equal(deleteRows.length, 1, `${testCase.id} should delete one row`);
}

test('RPP-0107 wp_posts create/update/delete target exposes per-tier ready and conflict coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpPostsCreateUpdateDelete;

  assert.ok(coverage, 'missing wp_posts create/update/delete target coverage');
  assert.equal(coverage.family, 'wp-posts-create-update-delete-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-posts-create-update-delete']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready wp_posts cases');
  assert.ok(coverage.statuses.conflict > 0, 'target should include conflicting wp_posts cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-posts-create-update-delete-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'wp-posts-create-update-delete-conflict');

  assert.ok(readyCase, 'missing ready wp_posts create/update/delete case');
  assert.ok(conflictCase, 'missing conflicting wp_posts create/update/delete case');
  assertWpPostsCreateUpdateDeleteShape(readyCase);
  assertWpPostsCreateUpdateDeleteShape(conflictCase);

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 3, 'ready wp_posts case should create, update, and delete rows');
  assert.equal(ready.applied, true, 'ready wp_posts case should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready wp_posts apply should preserve unplanned remote data');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'remote wp_posts drift should be a conflict');
  assert.equal(conflict.applied, false, 'conflicting wp_posts case must not apply mutations');
});

function assertWpPostsCreateUpdateDeleteShape(testCase) {
  const createRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => !testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated wp_posts create '));
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated wp_posts update '));
  const deleteRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([id, row]) => row.post_title.startsWith('Base wp_posts delete ')
      && !testCase.local.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]);

  assert.equal(createRows.length, 1, `${testCase.id} should create one wp_posts row`);
  assert.equal(updateRows.length, 1, `${testCase.id} should update one wp_posts row`);
  assert.equal(deleteRows.length, 1, `${testCase.id} should delete one wp_posts row`);
}

test('RPP-0112 wp_term_taxonomy graph target exposes per-tier ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermTaxonomyGraph;

  assert.ok(coverage, 'missing wp_term_taxonomy graph target coverage');
  assert.equal(coverage.family, 'wp-term-taxonomy-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-term-taxonomy-graph']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready wp_term_taxonomy graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include stale/non-ready graph cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-term-taxonomy-graph-ready');
  const staleCase = cases.find((testCase) => testCase.family === 'wp-term-taxonomy-graph-stale');

  assert.ok(readyCase, 'missing ready wp_term_taxonomy graph case');
  assert.ok(staleCase, 'missing stale wp_term_taxonomy graph case');
  assertTermTaxonomyGraphShape(readyCase, { staleTarget: false });
  assertTermTaxonomyGraphShape(staleCase, { staleTarget: true });

  const ready = validateGeneratedCase(readyCase);
  const stale = validateGeneratedCase(staleCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 2, 'ready graph should create term and term_taxonomy rows');
  assert.equal(ready.applied, true, 'ready wp_term_taxonomy graph should apply through the harness');
  assert.equal(ready.staleReplayRejected, true, 'ready wp_term_taxonomy graph should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.notEqual(stale.status, 'ready', 'stale graph should not be ready');
  assert.ok(stale.blockers >= 1, 'stale graph should record a graph identity blocker');
  assert.equal(stale.applied, false, 'stale graph must not apply mutations');
});

test('RPP-0116 atomic plugin install stack target emits ready and blocked hash-only cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.atomicPluginInstallStack;

  assert.ok(coverage, 'missing atomic plugin install stack target coverage');
  assert.equal(coverage.family, 'atomic-plugin-stack-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['atomic-plugin-install-stack']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready atomic plugin install cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include blocked atomic plugin install cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'atomic-plugin-stack-ready');
  const blockedCase = cases.find((testCase) => testCase.family === 'atomic-plugin-missing-dependency');

  assert.ok(readyCase, 'missing ready atomic plugin install case');
  assert.ok(blockedCase, 'missing blocked atomic plugin install case');
  assertAtomicPluginInstallStackShape(readyCase, { ready: true });
  assertAtomicPluginInstallStackShape(blockedCase, { ready: false });

  const ready = validateGeneratedCase(readyCase);
  const blocked = validateGeneratedCase(blockedCase);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.atomicGroups, 1, 'ready case should emit one atomic group');
  assert.ok(ready.mutations >= 5, 'ready atomic stack should plan dependency, dependent, and option resources');
  assert.equal(ready.applied, true, 'ready atomic plugin stack should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready atomic stack should preserve unplanned remote resources');
  assert.equal(ready.staleReplayRejected, true, 'ready atomic stack should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.atomicGroups, 1, 'blocked case should still emit one atomic group');
  assert.ok(blocked.blockers >= 1, 'blocked atomic stack should report a dependency blocker');
  assert.equal(blocked.applied, false, 'blocked atomic stack must not apply mutations');

  assertAtomicPluginInstallPlan(createGeneratedPlan(readyCase), { ready: true });
  assertAtomicPluginInstallPlan(createGeneratedPlan(blockedCase), { ready: false });
});

function assertTermTaxonomyGraphShape(testCase, { staleTarget }) {
  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([id, row]) => !testCase.base.db.wp_terms[id]
      && row.name.startsWith('Generated term taxonomy graph target '));
  const termTaxonomyRows = Object.entries(testCase.local.db.wp_term_taxonomy)
    .filter(([id, row]) => !testCase.base.db.wp_term_taxonomy[id]
      && row.description.startsWith('generated term taxonomy graph '));

  assert.equal(termRows.length, staleTarget ? 0 : 1, `${testCase.id} ready graph should create one term`);
  assert.equal(termTaxonomyRows.length, 1, `${testCase.id} should create one term_taxonomy row`);

  const termId = staleTarget
    ? termTaxonomyRows[0][1].term_id
    : termRows[0][1].term_id;
  assert.equal(termTaxonomyRows[0][1].term_id, termId);

  if (staleTarget) {
    const termRowId = `term_id:${termId}`;
    assert.ok(testCase.base.db.wp_terms[termRowId], `${testCase.id} stale target should exist in base`);
    assert.notDeepEqual(
      testCase.remote.db.wp_terms[termRowId],
      testCase.base.db.wp_terms[termRowId],
      `${testCase.id} stale target should drift remotely`,
    );
  }
}

function assertAtomicPluginInstallStackShape(testCase, { ready }) {
  const dependencyPlugin = 'reprint-push-atomic-dependency-fixture';
  const dependentPlugin = 'reprint-push-atomic-dependent-fixture';
  const intent = testCase.local.pushIntents?.[0];

  assert.ok(testCase.tags.has('atomic-plugin-install-stack'));
  assert.equal(intent?.kind, 'plugin-install');
  assert.equal(intent?.requireAtomic, true);
  assert.equal(intent?.dependencies?.plugins?.length, 1);

  if (ready) {
    const dependency = intent.dependencies.plugins[0];
    assert.equal(dependency.name, dependencyPlugin);
    assert.equal(dependency.version, '2.1.0');
    assert.match(dependency.hash, /^[a-f0-9]{64}$/);
    assert.equal(testCase.local.plugins[dependencyPlugin]?.active, true);
    assert.equal(testCase.local.plugins[dependentPlugin]?.active, true);
    assert.ok(intent.resources.includes(`file:${pluginMainFile(dependencyPlugin)}`));
    assert.ok(intent.resources.includes(`file:${pluginMainFile(dependentPlugin)}`));
    assert.ok(intent.resources.includes(`plugin:${dependencyPlugin}`));
    assert.ok(intent.resources.includes(`plugin:${dependentPlugin}`));
    assert.ok(intent.resources.includes('row:["wp_options","option_name:reprint_push_atomic_fixture_data"]'));
    assert.equal(remoteOnlyAtomicFiles(testCase).length, 1, `${testCase.id} should include one unplanned remote file`);
    return;
  }

  assert.equal(intent.dependencies.plugins[0], dependencyPlugin);
  assert.equal(testCase.local.plugins[dependencyPlugin], undefined);
  assert.equal(testCase.remote.plugins[dependencyPlugin], undefined);
  assert.ok(intent.resources.includes(`file:${pluginMainFile(dependentPlugin)}`));
  assert.ok(intent.resources.includes(`plugin:${dependentPlugin}`));
  assert.equal(intent.resources.includes(`plugin:${dependencyPlugin}`), false);
}

function assertAtomicPluginInstallPlan(plan, { ready }) {
  const dependencyPlugin = 'reprint-push-atomic-dependency-fixture';
  const dependentPlugin = 'reprint-push-atomic-dependent-fixture';
  const group = plan.atomicGroups[0];

  assert.equal(plan.atomicGroups.length, 1);
  assert.equal(group.kind, 'plugin-install');
  assert.equal(group.requireAtomic, true);
  assert.deepEqual(group.dependencies.plugins, [dependencyPlugin]);
  assert.equal(group.status, ready ? 'ready' : 'blocked');
  assert.equal(group.dependencyRequirements.length, 1);
  assertAtomicDependencyEvidenceIsHashOnly(group.dependencyRequirements[0]);

  if (ready) {
    const resourceKeys = plan.mutations.map((mutation) => mutation.resourceKey);
    assert.equal(group.mutationIds.length, 5);
    assert.ok(resourceKeys.includes(`file:${pluginMainFile(dependencyPlugin)}`));
    assert.ok(resourceKeys.includes(`file:${pluginMainFile(dependentPlugin)}`));
    assert.ok(resourceKeys.includes(`plugin:${dependencyPlugin}`));
    assert.ok(resourceKeys.includes(`plugin:${dependentPlugin}`));
    assert.ok(resourceKeys.includes('row:["wp_options","option_name:reprint_push_atomic_fixture_data"]'));
    assert.equal(
      plan.mutations.every((mutation) => mutation.atomicGroupId === group.id),
      true,
      'ready atomic install mutations should all belong to the same group',
    );

    const requirement = group.dependencyRequirements[0];
    assert.equal(requirement.source, 'same-atomic-group');
    assert.equal(requirement.expectedHash, requirement.plannedHash);

    const optionMutation = plan.mutations.find((mutation) =>
      mutation.resourceKey === 'row:["wp_options","option_name:reprint_push_atomic_fixture_data"]');
    assert.equal(optionMutation.pluginOwnedResource.pluginOwner, dependentPlugin);
    assert.equal(optionMutation.pluginOwnedResource.driver, 'wp-option');
    return;
  }

  assert.equal(group.mutationIds.length, 2);
  assert.equal(group.dependencyRequirements[0].source, 'missing-live-remote');
  assert.equal(group.dependencyRequirements[0].resourceKey, `plugin:${dependencyPlugin}`);
  assert.equal(plan.blockers[0].class, 'missing-plugin-dependency');
  assert.equal(group.blockers[0].class, 'missing-plugin-dependency');
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === `plugin:${dependencyPlugin}`),
    false,
    'blocked missing-dependency plan must not mutate the absent dependency',
  );
}

function assertAtomicDependencyEvidenceIsHashOnly(requirement) {
  for (const key of ['expectedHash', 'plannedHash', 'baseHash', 'remoteHash']) {
    if (requirement[key] != null) {
      assert.match(requirement[key], /^[a-f0-9]{64}$/, `${key} should be hash-only evidence`);
    }
  }

  for (const forbidden of ['raw', 'value', 'plannedValue', 'baseValue', 'localValue', 'remoteValue']) {
    assert.equal(
      Object.hasOwn(requirement, forbidden),
      false,
      `atomic dependency evidence should not expose ${forbidden}`,
    );
  }
}

function createGeneratedPlan(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: new Date('2026-05-28T00:00:00.000Z'),
  });
}

function remoteOnlyAtomicFiles(testCase) {
  return Object.keys(testCase.remote.files)
    .filter((path) => path.includes('/atomic-remote-only-'))
    .filter((path) => !testCase.base.files[path] && !testCase.local.files[path]);
}

function pluginMainFile(name) {
  return `wp-content/plugins/${name}/${name}.php`;
}

function nonReadyTargetCount(coverage) {
  return Object.entries(coverage.statuses)
    .filter(([status]) => status !== 'ready')
    .reduce((sum, [, count]) => sum + count, 0);
}
