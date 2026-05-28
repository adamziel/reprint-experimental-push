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
import { deserializeResourceValue, resourceHash, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { EVIDENCE_REDACTION_MARKER, redactEvidence } from '../src/evidence-redaction.js';

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

function claimFencedDurableJournal(events) {
  return {
    claimFenced: true,
    claimHash: 'c'.repeat(64),
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  };
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
  'wp-term-relationships-graph-ready',
  'wp-term-relationships-graph-stale',
  'wp-term-relationships-graph',
  'wp-term-relationships-create',
  'wp-term-relationships-identity-map',
  'wp-term-relationships-remote-drift',
  'wp-terms-create',
  'wp-term-taxonomy-create',
  'wp-terms-remote-drift',
  'term-taxonomy-term-graph',
  'term-relationship-object-graph',
  'term-relationship-taxonomy-graph',
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

test('RPP-0237 generated conflict plans reject apply, forged ready status, and stale mutation attempts', () => {
  const firstEvidence = generatedConflictApplyRefusalEvidence();
  const replayEvidence = generatedConflictApplyRefusalEvidence();
  const aggregate = aggregateGeneratedConflictApplyRefusalEvidence(firstEvidence);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0237 test/generated-push-harness.test.js',
    caveat: 'Generated local planner/apply proof only; release remains gated separately.',
    aggregate,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'generated conflict refusal evidence changed between runs');
  assert.ok(aggregate.totalConflictCases > 0, 'generated harness must include conflict cases');
  assert.ok(aggregate.totalPlannedMutations > 0, 'conflict generated cases should include independent planned mutations');
  assert.ok(aggregate.totalStaleAttempts > 0, 'generated proof must exercise stale mutation attempts');
  assert.equal(aggregate.totalAppliedMutations, 0, 'conflict apply refusals must not report applied mutations');
  assert.equal(aggregate.totalMutationJournalEvents, 0, 'conflict refusals must not write mutation journal events');
  assert.equal(
    aggregate.forgedIssueCodes.READY_PLAN_HAS_CONFLICTS,
    aggregate.totalConflictCases,
    'forged ready conflict evidence must fail closed for every generated conflict plan',
  );
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated remote'), false);
  assert.equal(evidenceText.includes('confidential'), false);
  assert.equal(evidenceText.includes('payload'), false);
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

test('RPP-0153 wp_term_relationships graph target rewrites object and taxonomy identities', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermRelationshipsGraph;

  assert.ok(coverage, 'missing wp_term_relationships graph target coverage');
  assert.equal(coverage.family, 'wp-term-relationships-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-term-relationships-graph']);
  assert.equal(coverage.total, 18);
  assert.deepEqual(coverage.perTier, {
    0: 2,
    1: 1,
    2: 1,
    3: 2,
    4: 2,
    5: 2,
    6: 2,
    7: 2,
    8: 2,
    9: 2,
  });
  assert.deepEqual(coverage.statuses, {
    blocked: 9,
    ready: 9,
  });
  assert.equal(report.summary.featureFamilies['wp-term-relationships-create'], coverage.total);
  assert.equal(report.summary.featureFamilies['term-relationship-object-graph'], coverage.total);
  assert.equal(report.summary.featureFamilies['term-relationship-taxonomy-graph'], coverage.total);

  const cases = generatePushHarnessCases();
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-term-relationships-graph-ready');
  const staleCases = cases.filter((testCase) => testCase.family === 'wp-term-relationships-graph-stale');

  assert.equal(readyCases.length, 9);
  assert.equal(staleCases.length, 9);

  for (const testCase of readyCases) {
    const shape = assertTermRelationshipsGraphShape(testCase, { staleTarget: false });
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const mutation = plan.mutations[0];
    const plannedValue = deserializeResourceValue(mutation.value);
    const result = validateGeneratedCase(testCase);

    assert.equal(plan.status, 'ready');
    assert.equal(plan.mutations.length, 1, `${testCase.id} should only create the rewritten relationship row`);
    assert.equal(mutation.resource.table, 'wp_term_relationships');
    assert.equal(mutation.resource.id, shape.rewrittenRelationshipRowId);
    assert.equal(plannedValue.object_id, shape.targetPostId);
    assert.equal(plannedValue.term_taxonomy_id, shape.targetTaxonomyId);
    assert.deepEqual(
      mutation.wordpressGraphIdentity.rewrites.map((rewrite) => rewrite.relationshipType).sort(),
      ['term-relationship-object', 'term-relationship-taxonomy'],
    );
    assert.equal(result.status, 'ready');
    assert.equal(result.mutations, 1);
    assert.equal(result.applied, true, 'ready wp_term_relationships graph should apply through the harness');
    assert.equal(result.unplannedRemotePreserved, true, 'ready graph should not overwrite unplanned remote data');
    assert.equal(result.staleReplayRejected, true, 'ready graph should reject stale replay');
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
    assertTermRelationshipsEvidenceIsHashOnly(testCase, shape, plan);
  }

  for (const testCase of staleCases) {
    const shape = assertTermRelationshipsGraphShape(testCase, { staleTarget: true });
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const relationshipBlocker = plan.blockers.find((blocker) => blocker.resourceKey === shape.sourceRelationshipResourceKey);
    const result = validateGeneratedCase(testCase);

    assert.equal(plan.status, 'blocked');
    assert.ok(relationshipBlocker, `${testCase.id} should block the relationship row`);
    assert.equal(relationshipBlocker.class, 'stale-wordpress-graph-identity');
    assert.deepEqual(
      relationshipBlocker.references.map((reference) => reference.relationshipType).sort(),
      ['term-relationship-object', 'term-relationship-taxonomy'],
    );
    assert.equal(result.status, 'blocked');
    assert.equal(result.mutations, 0, 'stale relationship graph should not emit mutations');
    assert.ok(result.blockers >= 1, 'stale relationship graph should record graph identity blockers');
    assert.equal(result.applied, false, 'stale graph must not apply mutations');
    assertGeneratedPlanRefusesWithoutMutation(testCase);
    assertTermRelationshipsEvidenceIsHashOnly(testCase, shape, plan);
  }
});

function assertTermRelationshipsGraphShape(testCase, { staleTarget }) {
  assert.equal(testCase.tags.has('wp-term-taxonomy-graph'), false, `${testCase.id} should not claim term_taxonomy target coverage`);
  assert.equal(testCase.tags.has('wp-term-relationships-graph'), true);
  assert.equal(testCase.tags.has('wp-term-relationships-identity-map'), true);

  const identityRows = testCase.local.meta.wordpressGraphIdentityMap.rows;
  const postMap = identityRows.find((row) => row.table === 'wp_posts');
  const termMap = identityRows.find((row) => row.table === 'wp_terms');
  const taxonomyMap = identityRows.find((row) => row.table === 'wp_term_taxonomy');
  const sourcePostId = Number(postMap.localId.slice(3));
  const targetPostId = Number(postMap.remoteId.slice(3));
  const sourceTermId = Number(termMap.localId.slice('term_id:'.length));
  const targetTermId = Number(termMap.remoteId.slice('term_id:'.length));
  const sourceTaxonomyId = Number(taxonomyMap.localId.slice('term_taxonomy_id:'.length));
  const targetTaxonomyId = Number(taxonomyMap.remoteId.slice('term_taxonomy_id:'.length));
  const sourceRelationshipRowId = `object_id:${sourcePostId}|term_taxonomy_id:${sourceTaxonomyId}`;
  const rewrittenRelationshipRowId = `object_id:${targetPostId}|term_taxonomy_id:${targetTaxonomyId}`;
  const sourceRelationshipResourceKey = `row:["wp_term_relationships","${sourceRelationshipRowId}"]`;

  assert.ok(testCase.local.db.wp_posts[`ID:${sourcePostId}`], `${testCase.id} should have local mapped post`);
  assert.ok(testCase.remote.db.wp_posts[`ID:${targetPostId}`], `${testCase.id} should have remote mapped post`);
  assert.ok(testCase.local.db.wp_terms[`term_id:${sourceTermId}`], `${testCase.id} should have local mapped term`);
  assert.ok(testCase.remote.db.wp_terms[`term_id:${targetTermId}`], `${testCase.id} should have remote mapped term`);
  assert.equal(testCase.local.db.wp_term_taxonomy[`term_taxonomy_id:${sourceTaxonomyId}`].term_id, sourceTermId);
  assert.equal(testCase.remote.db.wp_term_taxonomy[`term_taxonomy_id:${targetTaxonomyId}`].term_id, targetTermId);
  assert.deepEqual(testCase.local.db.wp_term_relationships[sourceRelationshipRowId], {
    object_id: sourcePostId,
    term_taxonomy_id: sourceTaxonomyId,
    term_order: 0,
  });
  assert.equal(testCase.remote.db.wp_term_relationships[sourceRelationshipRowId], undefined);
  assert.equal(testCase.remote.db.wp_term_relationships[rewrittenRelationshipRowId], undefined);

  if (staleTarget) {
    assert.ok(
      testCase.remote.db.wp_posts[`ID:${targetPostId}`].post_title.startsWith('Remote stale term relationship mapped post '),
      `${testCase.id} should drift the mapped remote post`,
    );
    assert.ok(
      testCase.remote.db.wp_terms[`term_id:${targetTermId}`].name.startsWith('Remote stale term relationship mapped term '),
      `${testCase.id} should drift the mapped remote term`,
    );
    assert.equal(testCase.remote.db.wp_term_taxonomy[`term_taxonomy_id:${targetTaxonomyId}`].count, 2);
  } else {
    assert.ok(
      testCase.remote.db.wp_posts[`ID:${targetPostId}`].post_title.startsWith('Generated term relationship mapped post '),
      `${testCase.id} should keep the mapped remote post equivalent`,
    );
    assert.ok(
      testCase.remote.db.wp_terms[`term_id:${targetTermId}`].name.startsWith('Generated term relationship mapped term '),
      `${testCase.id} should keep the mapped remote term equivalent`,
    );
    assert.equal(testCase.remote.db.wp_term_taxonomy[`term_taxonomy_id:${targetTaxonomyId}`].count, 1);
  }

  return {
    sourcePostId,
    targetPostId,
    sourceTermId,
    targetTermId,
    sourceTaxonomyId,
    targetTaxonomyId,
    sourceRelationshipRowId,
    rewrittenRelationshipRowId,
    sourceRelationshipResourceKey,
  };
}

function assertGeneratedPlanRefusesWithoutMutation(testCase) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const remote = cloneJson(testCase.remote);
  const before = digest(remote);
  const error = captureError(() => applyPlan(remote, plan));

  assert.notEqual(plan.status, 'ready');
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remote), before, `${testCase.id} non-ready plan mutated remote before refusal`);
}

function assertTermRelationshipsEvidenceIsHashOnly(testCase, shape, plan) {
  const mutation = plan.mutations[0];
  const evidence = redactEvidence({
    target: 'wpTermRelationshipsGraph',
    sourceRelationshipResourceKey: shape.sourceRelationshipResourceKey,
    rewrittenRelationshipResourceKey: mutation?.resourceKey || null,
    sourceRelationshipHash: resourceHash(testCase.local, rowResource('wp_term_relationships', shape.sourceRelationshipRowId)),
    plannedRelationshipHash: mutation ? digest(deserializeResourceValue(mutation.value)) : null,
    value: {
      sourcePost: testCase.local.db.wp_posts[`ID:${shape.sourcePostId}`],
      targetPost: testCase.remote.db.wp_posts[`ID:${shape.targetPostId}`],
      sourceTerm: testCase.local.db.wp_terms[`term_id:${shape.sourceTermId}`],
      targetTerm: testCase.remote.db.wp_terms[`term_id:${shape.targetTermId}`],
      relationship: testCase.local.db.wp_term_relationships[shape.sourceRelationshipRowId],
    },
    beforeValue: testCase.remote.db.wp_term_relationships[shape.rewrittenRelationshipRowId] || null,
  });
  const serialized = JSON.stringify(evidence);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER));
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/);
  assert.doesNotMatch(serialized, /Generated term relationship mapped post/);
  assert.doesNotMatch(serialized, /Remote stale term relationship mapped post/);
  assert.doesNotMatch(serialized, /Generated term relationship mapped term/);
  assert.doesNotMatch(serialized, /Remote stale term relationship mapped term/);
  assert.doesNotMatch(serialized, /generated-term-relationship-mapped/);
}

function rowResource(table, id) {
  return { type: 'row', table, id };
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

function generatedConflictApplyRefusalEvidence() {
  return generatePushHarnessCases()
    .map((testCase) => {
      const plan = createPushPlan({
        base: testCase.base,
        local: testCase.local,
        remote: testCase.remote,
        now: fixedGeneratedHarnessNow,
      });

      if (plan.status !== 'conflict') {
        return null;
      }

      const remote = cloneJson(testCase.remote);
      const beforeRemoteHash = digest(remote);
      const conflictJournalEvents = [];
      let appliedMutationCount = 0;
      const applyError = captureError(() => {
        const result = applyPlan(remote, plan, {
          durableJournal: claimFencedDurableJournal(conflictJournalEvents),
        });
        appliedMutationCount = result.appliedMutations;
      });

      assert.ok(applyError instanceof PushPlanError, `${testCase.id} conflict apply should throw PushPlanError`);
      assert.equal(applyError.code, 'PLAN_NOT_READY', `${testCase.id} conflict apply should fail as not ready`);
      assert.deepEqual(applyError.details, { status: 'conflict' }, `${testCase.id} conflict apply details changed`);
      assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} conflict apply mutated remote`);
      assert.equal(appliedMutationCount, 0, `${testCase.id} conflict apply reported applied mutations`);
      assert.deepEqual(conflictJournalEvents, [], `${testCase.id} conflict apply wrote durable journal events`);

      const forgedReadyWithConflictEvidence = cloneJson(plan);
      forgedReadyWithConflictEvidence.status = 'ready';
      const forgedRemote = cloneJson(testCase.remote);
      const forgedBeforeHash = digest(forgedRemote);
      const forgedJournalEvents = [];
      const forgedError = captureError(() => applyPlan(forgedRemote, forgedReadyWithConflictEvidence, {
        durableJournal: claimFencedDurableJournal(forgedJournalEvents),
      }));
      const forgedIssueCodes = forgedError.details.issues.map((issue) => issue.code).sort();
      assert.ok(forgedError instanceof PushPlanError, `${testCase.id} forged conflict plan should throw`);
      assert.equal(forgedError.code, 'PLAN_INVARIANT_VIOLATION', `${testCase.id} forged conflict code changed`);
      assert.ok(
        forgedIssueCodes.includes('READY_PLAN_HAS_CONFLICTS'),
        `${testCase.id} forged ready status must reject retained conflict evidence`,
      );
      assert.equal(digest(forgedRemote), forgedBeforeHash, `${testCase.id} forged conflict plan mutated remote`);
      assert.deepEqual(forgedJournalEvents, [], `${testCase.id} forged conflict plan wrote durable journal events`);

      const staleAttempt = plan.mutations.length > 0 && plan.blockers.length === 0
        ? generatedStaleConflictMutationAttempt(testCase, plan)
        : null;
      const allJournalEvents = [
        ...conflictJournalEvents,
        ...forgedJournalEvents,
        ...(staleAttempt?.journalEvents || []),
      ];
      for (const mutation of plan.mutations) {
        const mutationPayloadText = JSON.stringify(mutation.value);
        assert.equal(
          JSON.stringify({
            planId: testCase.id,
            conflicts: plan.conflicts.map((conflict) => conflict.resourceKey),
            mutationHashes: plan.mutations.map((entry) => [
              entry.resourceKey,
              entry.baseHash,
              entry.localHash,
              entry.remoteBeforeHash,
            ]),
          }).includes(mutationPayloadText),
          false,
          `${testCase.id} hash-only generated evidence leaked mutation payload for ${mutation.resourceKey}`,
        );
      }

      return {
        id: testCase.id,
        tier: testCase.tier,
        family: testCase.family,
        tags: [...testCase.tags].sort(),
        status: plan.status,
        summary: plan.summary,
        plannedMutations: plan.mutations.length,
        plannedPreconditions: plan.preconditions.length,
        conflicts: plan.conflicts.map((conflict) => ({
          id: conflict.id,
          resourceKey: conflict.resourceKey,
          class: conflict.class,
          resolutionPolicy: conflict.resolutionPolicy,
          baseHash: conflict.baseHash,
          localHash: conflict.localHash,
          remoteHash: conflict.remoteHash,
        })),
        refusal: {
          code: applyError.code,
          detailsHash: `sha256:${digest(applyError.details)}`,
        },
        forgedReadyWithConflictEvidence: {
          code: forgedError.code,
          issueCodes: forgedIssueCodes,
          detailsHash: `sha256:${digest(forgedError.details)}`,
        },
        staleMutationAttempt: staleAttempt
          ? {
              code: staleAttempt.error.code,
              detailsHash: `sha256:${digest(staleAttempt.error.details)}`,
              beforeRemoteHash: `sha256:${staleAttempt.beforeHash}`,
              afterRemoteHash: `sha256:${staleAttempt.afterHash}`,
              mutationJournalEventCount: staleAttempt.mutationJournalEventCount,
            }
          : null,
        appliedMutationCount,
        mutationJournalEventCount: allJournalEvents
          .filter((event) => event.type.includes('mutation')).length,
      };
    })
    .filter(Boolean);
}

function generatedStaleConflictMutationAttempt(testCase, plan) {
  const staleForgedReady = cloneJson(plan);
  staleForgedReady.status = 'ready';
  staleForgedReady.conflicts = [];
  staleForgedReady.summary.conflicts = 0;
  staleForgedReady.blockers = [];
  staleForgedReady.summary.blockers = 0;
  const target = staleForgedReady.mutations[0];
  const staleRemote = cloneJson(testCase.remote);
  setResource(staleRemote, target.resource, deserializeResourceValue(target.value));
  const beforeHash = digest(staleRemote);
  const journalEvents = [];
  const error = captureError(() => applyPlan(staleRemote, staleForgedReady, {
    durableJournal: claimFencedDurableJournal(journalEvents),
  }));
  const afterHash = digest(staleRemote);
  const mutationJournalEventCount = journalEvents
    .filter((event) => event.type.includes('mutation')).length;

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale forged conflict plan should throw`);
  assert.equal(error.code, 'PRECONDITION_FAILED', `${testCase.id} stale forged conflict code changed`);
  assert.equal(afterHash, beforeHash, `${testCase.id} stale forged conflict plan mutated remote`);
  assert.equal(mutationJournalEventCount, 0, `${testCase.id} stale forged conflict wrote mutation journal events`);

  return {
    error,
    beforeHash,
    afterHash,
    journalEvents,
    mutationJournalEventCount,
  };
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

function aggregateGeneratedConflictApplyRefusalEvidence(evidence) {
  const aggregate = evidence.reduce(
    (aggregate, entry) => {
      aggregate.totalConflictCases++;
      aggregate.totalPlannedMutations += entry.plannedMutations;
      aggregate.totalPlannedPreconditions += entry.plannedPreconditions;
      aggregate.totalConflicts += entry.conflicts.length;
      aggregate.totalAppliedMutations += entry.appliedMutationCount;
      aggregate.totalMutationJournalEvents += entry.mutationJournalEventCount;
      if (entry.staleMutationAttempt) {
        aggregate.totalStaleAttempts++;
      }
      incrementCount(aggregate.families, entry.family);
      for (const conflict of entry.conflicts) {
        incrementCount(aggregate.conflictClasses, conflict.class);
      }
      for (const issueCode of entry.forgedReadyWithConflictEvidence.issueCodes) {
        incrementCount(aggregate.forgedIssueCodes, issueCode);
      }
      return aggregate;
    },
    {
      totalConflictCases: 0,
      totalPlannedMutations: 0,
      totalPlannedPreconditions: 0,
      totalConflicts: 0,
      totalAppliedMutations: 0,
      totalMutationJournalEvents: 0,
      totalStaleAttempts: 0,
      families: {},
      conflictClasses: {},
      forgedIssueCodes: {},
    },
  );

  return {
    ...aggregate,
    families: sortStringObject(aggregate.families),
    conflictClasses: sortStringObject(aggregate.conflictClasses),
    forgedIssueCodes: sortStringObject(aggregate.forgedIssueCodes),
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
