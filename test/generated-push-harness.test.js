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
  'supported-plugin-usermeta',
  'unsupported-plugin-usermeta',
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
  'same-plan-user-meta-graph',
  'same-plan-graph',
  'plugin-owned-supported',
  'plugin-owned-unsupported',
  'plugin-usermeta-driver-supported',
  'plugin-usermeta-driver-unsupported',
  'file-topology',
  'directory-descendant',
  'directory-delete-with-remote-descendant',
  'type-change',
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

test('RPP-0407 generated harness covers supported and unsupported wp_usermeta driver variants', () => {
  const cases = generatePushHarnessCases();
  const supportedCase = cases.find((testCase) => testCase.family === 'supported-plugin-usermeta');
  const unsupportedCase = cases.find((testCase) => testCase.family === 'unsupported-plugin-usermeta');

  assert.ok(supportedCase, 'missing generated supported wp_usermeta driver case');
  assert.ok(unsupportedCase, 'missing generated unsupported wp_usermeta driver case');
  assert.ok(supportedCase.tags.has('plugin-usermeta-driver-supported'));
  assert.ok(unsupportedCase.tags.has('plugin-usermeta-driver-unsupported'));

  const supportedResult = validateGeneratedCase(supportedCase);
  const unsupportedResult = validateGeneratedCase(unsupportedCase);
  const supportedPlan = createPushPlan({
    base: supportedCase.base,
    local: supportedCase.local,
    remote: supportedCase.remote,
  });
  const unsupportedPlan = createPushPlan({
    base: unsupportedCase.base,
    local: unsupportedCase.local,
    remote: unsupportedCase.remote,
  });
  const supportedMutation = supportedPlan.mutations.find((mutation) =>
    mutation.resource?.table === 'wp_usermeta'
    && mutation.pluginOwnedResource?.driver === 'wp-usermeta');
  const unsupportedBlocker = unsupportedPlan.blockers.find((blocker) =>
    blocker.resource?.table === 'wp_usermeta'
    && blocker.driver === 'wp-usermeta');

  assert.equal(supportedResult.status, 'ready');
  assert.equal(supportedResult.applied, true);
  assert.ok(supportedMutation, 'supported case should plan a wp_usermeta plugin-owned mutation');
  assert.equal(supportedMutation.pluginOwnedResource.driverEvidence.supported, true);
  assert.equal(supportedMutation.pluginOwnedResource.driverEvidence.rowIdKind, 'umeta_id');
  assert.equal(supportedMutation.pluginOwnedResource.driverEvidence.userId, 1);
  assert.equal(JSON.stringify(supportedMutation.pluginOwnedResource.driverEvidence).includes('meta_value'), false);
  assert.equal(JSON.stringify(supportedMutation.pluginOwnedResource.driverEvidence).includes('ordinal'), false);

  assert.equal(unsupportedResult.status, 'blocked');
  assert.equal(unsupportedResult.applied, false);
  assert.ok(unsupportedBlocker, 'unsupported case should expose a wp_usermeta driver blocker');
  assert.equal(unsupportedBlocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(unsupportedBlocker.driverEvidence.supported, false);
  assert.match(unsupportedBlocker.reason, /umeta_id to match the resource id/);
  assert.equal(JSON.stringify(unsupportedBlocker).includes('local-invalid'), false);
  assert.equal(JSON.stringify(unsupportedBlocker).includes('meta_value'), false);
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
