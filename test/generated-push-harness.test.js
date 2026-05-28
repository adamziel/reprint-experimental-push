import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  MIN_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
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
  'postmeta-post-graph-ready',
  'postmeta-post-graph-stale',
  'postmeta-post-graph',
  'postmeta-post',
  'postmeta-post-ready',
  'postmeta-post-stale-target',
  'wp-postmeta-create',
  'wp-posts-remote-drift',
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

test('RPP-0230 generated planner summary counts match emitted evidence deterministically', () => {
  const firstEvidence = generatedPlannerSummaryEvidence();
  const replayEvidence = generatedPlannerSummaryEvidence();
  const report = runGeneratedPushHarness();
  const aggregate = aggregateGeneratedPlannerEvidence(firstEvidence);
  const reportTotals = reportPlannerSummaryTotals(report.summary);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0230 test/generated-push-harness.test.js',
    caveat: 'Local deterministic Node generated-harness proof; release remains gated separately.',
    aggregate,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
  };

  assert.deepEqual(firstEvidence, replayEvidence, 'generated planner summary evidence changed between runs');
  assert.deepEqual(
    reportComparablePlannerSummaryTotals(aggregate),
    reportTotals,
    'generated report totals diverged from emitted planner evidence',
  );
  assert.equal(aggregate.totalPreconditions, aggregate.totalMutations);
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(evidenceEnvelope).includes('confidential'), false);
});

test('RPP-0233 generated ready fixtures reject forged localHash evidence', () => {
  const selectedFamilies = [
    'file-create-update-delete-mix-ready',
    'row-create-update-delete-mix-ready',
    'wp-posts-create-update-delete-ready',
    'supported-plugin-option',
  ];
  const cases = generatePushHarnessCases();

  for (const family of selectedFamilies) {
    const testCase = cases.find((entry) => entry.family === family);
    assert.ok(testCase, `missing generated ${family} case`);
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });

    assert.equal(plan.status, 'ready', `${family} should be a ready fixture`);
    assert.ok(plan.mutations.length > 0, `${family} should emit at least one mutation`);
    for (const mutation of plan.mutations) {
      assert.match(mutation.localHash, /^[a-f0-9]{64}$/);
      assert.equal(
        mutation.localHash,
        digest(deserializeResourceValue(mutation.value)),
        `${family} mutation ${mutation.resourceKey} localHash must bind to planned value`,
      );
      if (!mutation.wordpressGraphIdentity) {
        assert.equal(
          mutation.localHash,
          resourceHash(testCase.local, mutation.resource),
          `${family} mutation ${mutation.resourceKey} localHash must match local resource snapshot`,
        );
      }
    }

    const target = plan.mutations[0];
    const forged = cloneJson(plan);
    forged.mutations.find((mutation) => mutation.id === target.id).localHash = '0'.repeat(64);
    const remote = cloneJson(testCase.remote);
    const beforeRemoteHash = digest(remote);
    const error = captureError(() => applyPlan(remote, forged));

    assert.ok(error instanceof PushPlanError, `${family} forged localHash should reject`);
    assert.equal(error.code, 'PLAN_INVARIANT_VIOLATION');
    assert.ok(
      error.details.issues.some((issue) => issue.code === 'LOCAL_HASH_MISMATCH'),
      `${family} should report a localHash mismatch`,
    );
    assert.equal(digest(remote), beforeRemoteHash, `${family} forged plan mutated remote before refusal`);

    const serializedEvidence = JSON.stringify({
      family,
      refusal: {
        code: error.code,
        details: error.details,
        detailsHash: `sha256:${digest(error.details)}`,
      },
      mutations: plan.mutations.map((mutation) => ({
        id: mutation.id,
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        plannedValueHash: digest(deserializeResourceValue(mutation.value)),
      })),
    });
    for (const mutation of plan.mutations) {
      assert.equal(
        serializedEvidence.includes(JSON.stringify(mutation.value)),
        false,
        `${family} hash-only evidence leaked mutation payload for ${mutation.resourceKey}`,
      );
    }
  }
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

test('RPP-0344 generated harness emits postmeta post_id ready and stale graph cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.postmetaPostGraph;

  assert.ok(coverage, 'missing postmeta post_id graph target coverage');
  assert.equal(coverage.family, 'postmeta-post-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['postmeta-post-graph']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready postmeta post_id graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include stale/non-ready postmeta post_id cases');
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
  const readyCase = cases.find((testCase) => testCase.family === 'postmeta-post-graph-ready');
  const staleCase = cases.find((testCase) => testCase.family === 'postmeta-post-graph-stale');

  assert.ok(readyCase, 'missing ready postmeta post_id graph case');
  assert.ok(staleCase, 'missing stale postmeta post_id graph case');
  const readyShape = assertPostmetaPostGraphShape(readyCase, { staleTarget: false });
  const staleShape = assertPostmetaPostGraphShape(staleCase, { staleTarget: true });

  const ready = validateGeneratedCase(readyCase);
  const stale = validateGeneratedCase(staleCase);
  const readyPlan = createPushPlan({
    base: readyCase.base,
    local: readyCase.local,
    remote: readyCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const stalePlan = createPushPlan({
    base: staleCase.base,
    local: staleCase.local,
    remote: staleCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const postMutation = readyPlan.mutations.find((mutation) =>
    mutation.resourceKey === readyShape.postResourceKey);
  const postmetaMutation = readyPlan.mutations.find((mutation) =>
    mutation.resourceKey === readyShape.postmetaResourceKey);
  const plannedPostmeta = deserializeResourceValue(postmetaMutation.value);
  const staleBlocker = stalePlan.blockers.find((blocker) =>
    blocker.resourceKey === staleShape.postmetaResourceKey);
  const stalePlanJson = JSON.stringify(stalePlan);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.applied, true, 'ready postmeta post_id graph should apply through the harness');
  assert.equal(ready.staleReplayRejected, true, 'ready postmeta post_id graph should reject stale replay');
  assert.ok(postMutation, 'ready graph should plan the target post row');
  assert.ok(postmetaMutation, 'ready graph should plan the postmeta row');
  assert.equal(plannedPostmeta.post_id, readyShape.postId);
  assert.equal(plannedPostmeta.meta_key, readyShape.metaKey);
  assert.equal(stale.status, 'blocked');
  assert.ok(stale.blockers >= 1, 'stale graph should record a graph identity blocker');
  assert.equal(stale.applied, false, 'stale postmeta post_id graph must not apply mutations');
  assert.ok(staleBlocker, 'stale graph should block the postmeta row');
  assert.equal(staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(staleBlocker.references[0].relationshipType, 'postmeta-post');
  assert.equal(staleBlocker.references[0].targetResourceKey, staleShape.postResourceKey);
  assert.match(staleBlocker.references[0].targetRemoteHash, /^[a-f0-9]{64}$/);
  assert.match(staleBlocker.references[0].targetBaseHash, /^[a-f0-9]{64}$/);
  assert.match(staleBlocker.references[0].targetLocalHash, /^[a-f0-9]{64}$/);
  assert.equal(stalePlanJson.includes('Generated postmeta post target'), false);
  assert.equal(stalePlanJson.includes('Remote stale postmeta post target'), false);
  assert.equal(stalePlanJson.includes('remote stale postmeta post private payload'), false);
});

function assertPostmetaPostGraphShape(testCase, { staleTarget }) {
  const postmetaRows = Object.entries(testCase.local.db.wp_postmeta)
    .filter(([, row]) => String(row.meta_key || '').startsWith('_generated_postmeta_post_ref_'));

  assert.equal(postmetaRows.length, 1, `${testCase.id} should create one postmeta post_id row`);

  const [postmetaRowId, postmetaRow] = postmetaRows[0];
  const postId = Number(postmetaRow.post_id);
  const postRowId = `ID:${postId}`;
  const post = testCase.local.db.wp_posts[postRowId];

  assert.ok(Number.isSafeInteger(postId), `${testCase.id} post_id should be a numeric post ID`);
  assert.equal(postmetaRowId, `post_id:${postId}:meta_key:${postmetaRow.meta_key}`);
  assert.ok(post, `${testCase.id} missing local post target ${postRowId}`);
  assert.equal(post.ID, postId);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_posts[postRowId], `${testCase.id} stale post target should exist in base`);
    assert.notDeepEqual(
      testCase.remote.db.wp_posts[postRowId],
      testCase.base.db.wp_posts[postRowId],
      `${testCase.id} stale post target should drift remotely`,
    );
  } else {
    assert.equal(testCase.base.db.wp_posts[postRowId], undefined);
    assert.equal(testCase.remote.db.wp_posts[postRowId], undefined);
  }

  return {
    postId,
    metaKey: postmetaRow.meta_key,
    postResourceKey: generatedRowResourceKey('wp_posts', postRowId),
    postmetaResourceKey: generatedRowResourceKey('wp_postmeta', postmetaRowId),
  };
}

function generatedRowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function nonReadyTargetCount(coverage) {
  return Object.entries(coverage.statuses)
    .filter(([status]) => status !== 'ready')
    .reduce((sum, [, count]) => sum + count, 0);
}

function generatedPlannerSummaryEvidence() {
  return generatePushHarnessCases().map((testCase) => {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const emitted = emittedPlannerCounts(plan);

    assert.deepEqual(plan.summary, emitted, `${testCase.id} summary totals mismatch`);
    assert.equal(
      plan.status,
      plan.conflicts.length > 0 ? 'conflict' : plan.blockers.length > 0 ? 'blocked' : 'ready',
      `${testCase.id} status does not match emitted conflict/blocker evidence`,
    );

    return {
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      tags: [...testCase.tags].sort(),
      status: plan.status,
      summary: plan.summary,
      emitted,
      preconditions: plan.preconditions.length,
    };
  });
}

function emittedPlannerCounts(plan) {
  return {
    mutations: plan.mutations.length,
    decisions: plan.decisions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    atomicGroups: plan.atomicGroups.length,
  };
}

function aggregateGeneratedPlannerEvidence(evidence) {
  const aggregate = {
    totalCases: evidence.length,
    statuses: {},
    statusByTier: {},
    tiers: {},
    featureFamilies: {},
    totalMutations: 0,
    totalConflicts: 0,
    totalBlockers: 0,
    totalDecisions: 0,
    totalAtomicGroups: 0,
    totalPreconditions: 0,
  };

  for (const entry of evidence) {
    incrementCount(aggregate.statuses, entry.status);
    aggregate.statusByTier[entry.status] ||= {};
    incrementCount(aggregate.statusByTier[entry.status], entry.tier);
    incrementCount(aggregate.tiers, entry.tier);
    incrementCount(aggregate.featureFamilies, entry.family);
    for (const tag of entry.tags) {
      incrementCount(aggregate.featureFamilies, tag);
    }
    aggregate.totalMutations += entry.summary.mutations;
    aggregate.totalConflicts += entry.summary.conflicts;
    aggregate.totalBlockers += entry.summary.blockers;
    aggregate.totalDecisions += entry.summary.decisions;
    aggregate.totalAtomicGroups += entry.summary.atomicGroups;
    aggregate.totalPreconditions += entry.preconditions;
  }

  return {
    ...aggregate,
    statuses: sortStringObject(aggregate.statuses),
    statusByTier: sortNestedNumericObject(aggregate.statusByTier),
    tiers: sortNumericObject(aggregate.tiers),
    featureFamilies: sortStringObject(aggregate.featureFamilies),
  };
}

function reportPlannerSummaryTotals(summary) {
  return {
    totalCases: summary.totalCases,
    statuses: summary.statuses,
    statusByTier: summary.statusByTier,
    tiers: summary.tiers,
    featureFamilies: summary.featureFamilies,
    totalMutations: summary.totalMutations,
    totalConflicts: summary.totalConflicts,
    totalBlockers: summary.totalBlockers,
    totalDecisions: summary.totalDecisions,
  };
}

function reportComparablePlannerSummaryTotals(aggregate) {
  return {
    totalCases: aggregate.totalCases,
    statuses: aggregate.statuses,
    statusByTier: aggregate.statusByTier,
    tiers: aggregate.tiers,
    featureFamilies: aggregate.featureFamilies,
    totalMutations: aggregate.totalMutations,
    totalConflicts: aggregate.totalConflicts,
    totalBlockers: aggregate.totalBlockers,
    totalDecisions: aggregate.totalDecisions,
  };
}

function incrementCount(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function sortNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function sortStringObject(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sortNestedNumericObject(object) {
  return Object.fromEntries(
    Object.entries(object)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, sortNumericObject(value)]),
  );
}
