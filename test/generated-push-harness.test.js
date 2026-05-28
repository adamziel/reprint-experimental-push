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
  'wp-options-scalar-ready',
  'wp-options-scalar-conflict',
  'wp-options-scalar',
  'scalar-option-update',
  'scalar-option-string',
  'scalar-option-number',
  'wp-options-serialized-ready',
  'wp-options-serialized-conflict',
  'wp-options-serialized',
  'serialized-option-update',
  'serialized-option-object',
  'serialized-option-array',
  'wp-posts-create-update-delete-ready',
  'wp-posts-create-update-delete-conflict',
  'wp-posts-create-update-delete',
  'wp-posts-create',
  'wp-posts-update',
  'wp-posts-delete',
  'wp-postmeta-create-update-delete-ready',
  'wp-postmeta-create-update-delete-conflict',
  'wp-postmeta-create-update-delete',
  'wp-postmeta-create',
  'wp-postmeta-update',
  'wp-postmeta-delete',
  'wp-comments-commentmeta-graph-ready',
  'wp-comments-commentmeta-graph-stale',
  'wp-comments-commentmeta-graph',
  'wp-commentmeta-create',
  'wp-comments-remote-drift',
  'commentmeta-comment-graph',
  'wp-users-usermeta-graph-ready',
  'wp-users-usermeta-graph-stale',
  'wp-users-usermeta-graph',
  'wp-users-create',
  'wp-usermeta-create',
  'wp-users-remote-drift',
  'wp-term-taxonomy-graph-ready',
  'wp-term-taxonomy-graph-stale',
  'wp-term-taxonomy-graph',
  'wp-terms-create',
  'wp-term-taxonomy-create',
  'wp-terms-remote-drift',
  'term-taxonomy-term-graph',
  'comment-user-graph-ready',
  'comment-user-graph-stale',
  'comment-user-graph',
  'comment-user',
  'comment-user-ready',
  'comment-user-stale-target',
  'wp-comments-create',
  'wp-users-create',
  'wp-users-remote-drift',
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

test('RPP-0240 generated atomic group blockers propagate before apply mutation', () => {
  const firstEvidence = generatedAtomicBlockerPropagationEvidence();
  const replayEvidence = generatedAtomicBlockerPropagationEvidence();
  const aggregate = aggregateGeneratedAtomicBlockerPropagationEvidence(firstEvidence);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0240 test/generated-push-harness.test.js',
    caveat: 'Generated local atomic blocker proof only; release remains gated separately.',
    aggregate,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'generated atomic blocker evidence changed between runs');
  assert.ok(aggregate.totalCases > 0, 'generated proof must include atomic blocker cases');
  assert.ok(aggregate.totalBlockedGroups > 0, 'generated proof must include blocked atomic groups');
  assert.ok(aggregate.totalDirectBlockers > 0, 'generated proof must include source blockers');
  assert.equal(
    aggregate.totalPropagatedBlockers,
    aggregate.totalGroupMutations,
    'each grouped mutation should receive an atomic propagation blocker',
  );
  assert.equal(aggregate.totalAppliedMutations, 0);
  assert.equal(aggregate.totalDurableJournalEvents, 0);
  assert.equal(aggregate.totalMutationJournalEvents, 0);
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('generated dependent'), false);
  assert.equal(evidenceText.includes('<?php'), false);
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

test('RPP-0105 generated harness emits wp_options scalar option ready and conflict cases', () => {
  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-options-scalar-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'wp-options-scalar-conflict');

  assert.ok(readyCase, 'missing ready wp_options scalar option case');
  assert.ok(conflictCase, 'missing conflicting wp_options scalar option case');
  assert.ok(readyCase.tags.has('wp-options-scalar'));
  assert.ok(conflictCase.tags.has('wp-options-scalar'));
  assert.ok(readyCase.tags.has('scalar-option-update'));
  assert.ok(conflictCase.tags.has('scalar-option-update'));
  assertWpOptionsScalarShape(readyCase, { conflict: false });
  assertWpOptionsScalarShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready scalar option should plan an option mutation');
  assert.equal(ready.applied, true, 'ready scalar option should apply through the harness');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'remote scalar option drift should be a conflict');
  assert.equal(conflict.applied, false, 'conflicting scalar option must not apply mutations');
});

function assertWpOptionsScalarShape(testCase, { conflict }) {
  const scalarRows = Object.entries(testCase.base.db.wp_options)
    .filter(([id, row]) => id.startsWith('option_name:scalar_generated_')
      && isScalar(row.option_value));

  assert.equal(scalarRows.length, 1, `${testCase.id} should seed one scalar option row`);
  const [rowId, baseRow] = scalarRows[0];
  const localRow = testCase.local.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];

  assert.ok(localRow, `${testCase.id} missing local scalar option row`);
  assert.ok(remoteRow, `${testCase.id} missing remote scalar option row`);
  assert.equal(localRow.__pluginOwner, undefined, `${testCase.id} scalar option should not be plugin-owned`);
  assert.equal(remoteRow.__pluginOwner, undefined, `${testCase.id} scalar option should not be plugin-owned`);
  assert.equal(typeof localRow.option_value, typeof baseRow.option_value);
  assert.ok(isScalar(localRow.option_value), `${testCase.id} local option_value must stay scalar`);
  assert.notEqual(localRow.option_value, baseRow.option_value);
  if (conflict) {
    assert.notEqual(remoteRow.option_value, baseRow.option_value);
    assert.notEqual(remoteRow.option_value, localRow.option_value);
  } else {
    assert.equal(remoteRow.option_value, baseRow.option_value);
  }
}

function isScalar(value) {
  return value === null || ['boolean', 'number', 'string'].includes(typeof value);
}

test('RPP-0106 generated harness emits wp_options serialized option ready and conflict cases', () => {
  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-options-serialized-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'wp-options-serialized-conflict');

  assert.ok(readyCase, 'missing ready wp_options serialized option case');
  assert.ok(conflictCase, 'missing conflicting wp_options serialized option case');
  assert.ok(readyCase.tags.has('wp-options-serialized'));
  assert.ok(conflictCase.tags.has('wp-options-serialized'));
  assert.ok(readyCase.tags.has('serialized-option-update'));
  assert.ok(conflictCase.tags.has('serialized-option-update'));
  assertWpOptionsSerializedShape(readyCase, { conflict: false });
  assertWpOptionsSerializedShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready serialized option should plan an option mutation');
  assert.equal(ready.applied, true, 'ready serialized option should apply through the harness');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'remote serialized option drift should be a conflict');
  assert.equal(conflict.applied, false, 'conflicting serialized option must not apply mutations');
});

function assertWpOptionsSerializedShape(testCase, { conflict }) {
  const serializedRows = Object.entries(testCase.base.db.wp_options)
    .filter(([id, row]) => id.startsWith('option_name:serialized_generated_')
      && isSerializedOptionValue(row.option_value));

  assert.equal(serializedRows.length, 1, `${testCase.id} should seed one serialized option row`);
  const [rowId, baseRow] = serializedRows[0];
  const localRow = testCase.local.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];

  assert.ok(localRow, `${testCase.id} missing local serialized option row`);
  assert.ok(remoteRow, `${testCase.id} missing remote serialized option row`);
  assert.equal(localRow.__pluginOwner, undefined, `${testCase.id} serialized option should not be plugin-owned`);
  assert.equal(remoteRow.__pluginOwner, undefined, `${testCase.id} serialized option should not be plugin-owned`);
  assert.ok(isSerializedOptionValue(localRow.option_value), `${testCase.id} local option_value must stay serialized`);
  assert.notDeepEqual(localRow.option_value, baseRow.option_value);
  if (conflict) {
    assert.notDeepEqual(remoteRow.option_value, baseRow.option_value);
    assert.notDeepEqual(remoteRow.option_value, localRow.option_value);
  } else {
    assert.deepEqual(remoteRow.option_value, baseRow.option_value);
  }
}

function isSerializedOptionValue(value) {
  return value !== null && typeof value === 'object';
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


test('RPP-0108 wp_postmeta create/update/delete target exposes ready, conflict, and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpPostmetaCreateUpdateDelete;

  assert.ok(coverage, 'missing wp_postmeta create/update/delete target coverage');
  assert.equal(coverage.family, 'wp-postmeta-create-update-delete-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-postmeta-create-update-delete']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready wp_postmeta cases');
  assert.ok(coverage.statuses.conflict > 0, 'target should include conflicting wp_postmeta cases');
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
  const readyCase = cases.find((testCase) => testCase.family === 'wp-postmeta-create-update-delete-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'wp-postmeta-create-update-delete-conflict');

  assert.ok(readyCase, 'missing ready wp_postmeta create/update/delete case');
  assert.ok(conflictCase, 'missing conflicting wp_postmeta create/update/delete case');
  assertWpPostmetaCreateUpdateDeleteShape(readyCase);
  assertWpPostmetaCreateUpdateDeleteShape(conflictCase);

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 3, 'ready wp_postmeta case should create, update, and delete rows');
  assert.equal(ready.applied, true, 'ready wp_postmeta case should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready wp_postmeta apply should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready wp_postmeta stale replay should be rejected');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'remote wp_postmeta drift should be a conflict');
  assert.equal(conflict.applied, false, 'conflicting wp_postmeta case must not apply mutations');
});

function assertWpPostmetaCreateUpdateDeleteShape(testCase) {
  const createRows = Object.entries(testCase.local.db.wp_postmeta)
    .filter(([id, row]) => !testCase.base.db.wp_postmeta[id]
      && row.meta_value.startsWith('generated wp_postmeta create '));
  const updateRows = Object.entries(testCase.local.db.wp_postmeta)
    .filter(([id, row]) => testCase.base.db.wp_postmeta[id]
      && row.meta_value.startsWith('generated wp_postmeta update '));
  const deleteRows = Object.entries(testCase.base.db.wp_postmeta)
    .filter(([id, row]) => row.meta_value.startsWith('base postmeta delete ')
      && !testCase.local.db.wp_postmeta[id]
      && testCase.remote.db.wp_postmeta[id]);

  assert.equal(createRows.length, 1, `${testCase.id} should create one wp_postmeta row`);
  assert.equal(updateRows.length, 1, `${testCase.id} should update one wp_postmeta row`);
  assert.equal(deleteRows.length, 1, `${testCase.id} should delete one wp_postmeta row`);
}



test('RPP-0110 wp_comments/wp_commentmeta graph target exposes ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpCommentsCommentmetaGraph;

  assert.ok(coverage, 'missing wp_comments/wp_commentmeta graph target coverage');
  assert.equal(coverage.family, 'wp-comments-commentmeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-comments-commentmeta-graph']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready comment/commentmeta graph cases');
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
  const readyCase = cases.find((testCase) => testCase.family === 'wp-comments-commentmeta-graph-ready');
  const staleCase = cases.find((testCase) => testCase.family === 'wp-comments-commentmeta-graph-stale');

  assert.ok(readyCase, 'missing ready wp_comments/wp_commentmeta graph case');
  assert.ok(staleCase, 'missing stale wp_comments/wp_commentmeta graph case');
  assertCommentCommentmetaGraphShape(readyCase, { staleTarget: false });
  assertCommentCommentmetaGraphShape(staleCase, { staleTarget: true });

  const ready = validateGeneratedCase(readyCase);
  const stale = validateGeneratedCase(staleCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 2, 'ready graph should create comment and commentmeta rows');
  assert.equal(ready.applied, true, 'ready comment/commentmeta graph should apply through the harness');
  assert.equal(ready.staleReplayRejected, true, 'ready comment/commentmeta graph should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.notEqual(stale.status, 'ready', 'stale graph should not be ready');
  assert.ok(stale.blockers >= 1, 'stale graph should record a graph identity blocker');
  assert.equal(stale.applied, false, 'stale graph must not apply mutations');
});

function assertCommentCommentmetaGraphShape(testCase, { staleTarget }) {
  const commentRows = Object.entries(testCase.local.db.wp_comments)
    .filter(([id, row]) => !testCase.base.db.wp_comments[id]
      && row.comment_content.startsWith('Generated comment graph target '));
  const commentmetaRows = Object.entries(testCase.local.db.wp_commentmeta)
    .filter(([id, row]) => !testCase.base.db.wp_commentmeta[id]
      && row.meta_key.startsWith('_generated_commentmeta_graph_'));

  assert.equal(commentRows.length, staleTarget ? 0 : 1, `${testCase.id} ready graph should create one comment`);
  assert.equal(commentmetaRows.length, 1, `${testCase.id} should create one commentmeta row`);

  const commentId = staleTarget
    ? commentmetaRows[0][1].comment_id
    : commentRows[0][1].comment_ID;
  assert.equal(commentmetaRows[0][1].comment_id, commentId);

  if (staleTarget) {
    const commentRowId = `comment_ID:${commentId}`;
    assert.ok(testCase.base.db.wp_comments[commentRowId], `${testCase.id} stale target should exist in base`);
    assert.notDeepEqual(
      testCase.remote.db.wp_comments[commentRowId],
      testCase.base.db.wp_comments[commentRowId],
      `${testCase.id} stale target should drift remotely`,
    );
  }
}

test('RPP-0109 wp_users/wp_usermeta graph target exposes ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpUsersUsermetaGraph;

  assert.ok(coverage, 'missing wp_users/wp_usermeta graph target coverage');
  assert.equal(coverage.family, 'wp-users-usermeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-users-usermeta-graph']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready user/usermeta graph cases');
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
  const readyCase = cases.find((testCase) => testCase.family === 'wp-users-usermeta-graph-ready');
  const staleCase = cases.find((testCase) => testCase.family === 'wp-users-usermeta-graph-stale');

  assert.ok(readyCase, 'missing ready wp_users/wp_usermeta graph case');
  assert.ok(staleCase, 'missing stale wp_users/wp_usermeta graph case');
  assertUserUsermetaGraphShape(readyCase, { staleTarget: false });
  assertUserUsermetaGraphShape(staleCase, { staleTarget: true });

  const ready = validateGeneratedCase(readyCase);
  const stale = validateGeneratedCase(staleCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 2, 'ready graph should create user and usermeta rows');
  assert.equal(ready.applied, true, 'ready user/usermeta graph should apply through the harness');
  assert.equal(ready.staleReplayRejected, true, 'ready user/usermeta graph should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.notEqual(stale.status, 'ready', 'stale graph should not be ready');
  assert.ok(stale.blockers >= 1, 'stale graph should record a graph identity blocker');
  assert.equal(stale.applied, false, 'stale graph must not apply mutations');
});

function assertUserUsermetaGraphShape(testCase, { staleTarget }) {
  const userRows = Object.entries(testCase.local.db.wp_users)
    .filter(([id, row]) => !testCase.base.db.wp_users[id]
      && row.display_name.startsWith('Generated graph user '));
  const usermetaRows = Object.entries(testCase.local.db.wp_usermeta)
    .filter(([id, row]) => !testCase.base.db.wp_usermeta[id]
      && row.meta_key.startsWith('_generated_usermeta_graph_'));

  assert.equal(userRows.length, staleTarget ? 0 : 1, `${testCase.id} ready graph should create one user`);
  assert.equal(usermetaRows.length, 1, `${testCase.id} should create one usermeta row`);

  const userId = staleTarget
    ? usermetaRows[0][1].user_id
    : userRows[0][1].ID;
  assert.equal(usermetaRows[0][1].user_id, userId);

  if (staleTarget) {
    const userRowId = `ID:${userId}`;
    assert.ok(testCase.base.db.wp_users[userRowId], `${testCase.id} stale target should exist in base`);
    assert.notDeepEqual(
      testCase.remote.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale target should drift remotely`,
    );
  }
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

test('RPP-0347 generated harness emits comment user ready and stale graph cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.commentUserGraph;

  assert.ok(coverage, 'missing comment user graph target coverage');
  assert.equal(coverage.family, 'comment-user-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['comment-user-graph']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready comment user graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include stale/non-ready comment user graph cases');
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
  const readyCase = cases.find((testCase) => testCase.family === 'comment-user-graph-ready');
  const staleCase = cases.find((testCase) => testCase.family === 'comment-user-graph-stale');

  assert.ok(readyCase, 'missing ready comment user graph case');
  assert.ok(staleCase, 'missing stale comment user graph case');

  const readyShape = assertCommentUserGraphShape(readyCase, { staleTarget: false });
  const staleShape = assertCommentUserGraphShape(staleCase, { staleTarget: true });
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
  const userMutation = readyPlan.mutations.find(
    (mutation) => mutation.resourceKey === readyShape.userResourceKey,
  );
  const commentMutation = readyPlan.mutations.find(
    (mutation) => mutation.resourceKey === readyShape.commentResourceKey,
  );
  const plannedComment = deserializeResourceValue(commentMutation.value);
  const staleBlocker = stalePlan.blockers.find(
    (blocker) => blocker.resourceKey === staleShape.commentResourceKey,
  );
  const staleReference = staleBlocker?.references?.find(
    (reference) => reference.relationshipType === 'comment-user',
  );
  const stalePlanJson = JSON.stringify(stalePlan);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.applied, true);
  assert.equal(ready.staleReplayRejected, true);
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.ok(userMutation, 'ready plan should create the user target');
  assert.ok(commentMutation, 'ready plan should create the comment reference');
  assert.equal(plannedComment.user_id, readyShape.userId);

  assert.equal(stale.status, 'blocked');
  assert.ok(stale.blockers >= 1, 'stale comment user graph should record a graph blocker');
  assert.equal(stale.applied, false, 'stale comment user graph must not apply mutations');
  assert.ok(staleBlocker, 'stale plan should block the comment user reference');
  assert.equal(staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.ok(staleReference, 'stale blocker should include the user_id reference');
  assert.equal(staleReference.relationshipKey, 'wp_comments.user_id');
  assert.equal(staleReference.targetResourceKey, staleShape.userResourceKey);
  assert.equal(staleReference.targetChange.remoteChange, 'update');
  assert.match(staleReference.targetRemoteHash, /^[a-f0-9]{64}$/);
  assert.match(staleReference.targetBaseHash, /^[a-f0-9]{64}$/);
  assert.match(staleReference.targetLocalHash, /^[a-f0-9]{64}$/);
  assert.equal(stalePlanJson.includes('Generated comment user target'), false);
  assert.equal(stalePlanJson.includes('Remote stale comment user'), false);
  assert.equal(stalePlanJson.includes('remote-stale-comment-user-private'), false);
  assert.equal(stalePlanJson.includes('comment-user-reference'), false);
});

function assertCommentUserGraphShape(testCase, { staleTarget }) {
  const commentRows = Object.entries(testCase.local.db.wp_comments)
    .filter(([, row]) => String(row.comment_content || '').startsWith('comment-user-reference-'));

  assert.equal(commentRows.length, 1, `${testCase.id} should create one comment user reference row`);

  const [commentRowId, commentRow] = commentRows[0];
  const userId = Number(commentRow.user_id);
  const userRowId = `ID:${userId}`;
  const user = testCase.local.db.wp_users[userRowId];

  assert.ok(Number.isSafeInteger(userId), `${testCase.id} user_id should be numeric`);
  assert.equal(commentRowId, `comment_ID:${commentRow.comment_ID}`);
  assert.ok(user, `${testCase.id} missing local user target ${userRowId}`);
  assert.equal(user.ID, userId);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_users[userRowId], `${testCase.id} stale user should exist in base`);
    assert.notDeepEqual(
      testCase.remote.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale user should drift remotely`,
    );
  } else {
    assert.equal(testCase.base.db.wp_users[userRowId], undefined);
    assert.equal(testCase.remote.db.wp_users[userRowId], undefined);
  }

  return {
    userId,
    userResourceKey: generatedRowResourceKey('wp_users', userRowId),
    commentResourceKey: generatedRowResourceKey('wp_comments', commentRowId),
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

function generatedAtomicBlockerPropagationEvidence() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'atomic-plugin-missing-dependency')
    .map((testCase) => {
      const plan = createPushPlan({
        base: testCase.base,
        local: testCase.local,
        remote: testCase.remote,
        now: fixedGeneratedHarnessNow,
      });
      const blockedGroups = plan.atomicGroups.filter((group) =>
        group.status === 'blocked'
        && group.blockers.some((blocker) => blocker.class === 'missing-plugin-dependency'));
      const remote = cloneJson(testCase.remote);
      const beforeRemoteHash = digest(remote);
      const journalEvents = [];
      let appliedMutationCount = 0;
      const error = captureError(() => {
        const result = applyPlan(remote, plan, {
          durableJournal: claimFencedDurableJournal(journalEvents),
        });
        appliedMutationCount = result.appliedMutations;
      });
      const mutationJournalEventCount = journalEvents
        .filter((event) => event.type.includes('mutation')).length;

      assert.ok(blockedGroups.length > 0, `${testCase.id} must include a blocked atomic group`);
      assert.ok(error instanceof PushPlanError, `${testCase.id} blocked atomic plan should throw`);
      assert.equal(error.code, 'PLAN_NOT_READY', `${testCase.id} apply refusal code changed`);
      assert.deepEqual(error.details, { status: plan.status }, `${testCase.id} refusal details changed`);
      assert.equal(digest(remote), beforeRemoteHash, `${testCase.id} apply mutated remote before refusal`);
      assert.equal(appliedMutationCount, 0, `${testCase.id} apply reported mutations before refusal`);
      assert.equal(journalEvents.length, 0, `${testCase.id} apply wrote durable journal events before refusal`);
      assert.equal(mutationJournalEventCount, 0, `${testCase.id} apply wrote mutation journal events before refusal`);

      const groupEvidence = blockedGroups.map((group) => {
        const groupMutations = plan.mutations
          .filter((mutation) => group.mutationIds.includes(mutation.id))
          .sort((a, b) => a.id.localeCompare(b.id));
        const directBlockers = group.blockers
          .filter((blocker) => blocker.class !== 'atomic-group-blocker-propagation')
          .sort((a, b) => a.id.localeCompare(b.id));
        const propagatedBlockers = group.blockers
          .filter((blocker) => blocker.class === 'atomic-group-blocker-propagation')
          .sort((a, b) => a.mutationId.localeCompare(b.mutationId));
        const directBlockerIds = directBlockers.map((blocker) => blocker.id);

        assert.ok(directBlockers.length > 0, `${testCase.id} ${group.id} missing source blockers`);
        assert.equal(
          propagatedBlockers.length,
          groupMutations.length,
          `${testCase.id} ${group.id} should propagate to every grouped mutation`,
        );
        assert.deepEqual(
          propagatedBlockers.map((blocker) => blocker.mutationId),
          groupMutations.map((mutation) => mutation.id),
          `${testCase.id} ${group.id} propagation mutation ids changed`,
        );
        assert.deepEqual(
          propagatedBlockers.map((blocker) => [...blocker.sourceBlockerIds].sort()),
          groupMutations.map(() => [...directBlockerIds].sort()),
          `${testCase.id} ${group.id} propagation source blockers changed`,
        );

        const entry = {
          id: group.id,
          status: group.status,
          mutationIds: [...group.mutationIds],
          directBlockers: directBlockers.map((blocker) => ({
            id: blocker.id,
            class: blocker.class,
            groupId: blocker.groupId,
            blockerHash: `sha256:${digest(blocker)}`,
          })),
          propagatedBlockers: propagatedBlockers.map((blocker) => ({
            id: blocker.id,
            class: blocker.class,
            groupId: blocker.groupId,
            mutationId: blocker.mutationId,
            resourceKey: blocker.resourceKey,
            sourceBlockerIds: [...blocker.sourceBlockerIds].sort(),
            blockerHash: `sha256:${digest(blocker)}`,
          })),
          mutations: groupMutations.map((mutation) => ({
            id: mutation.id,
            resourceKey: mutation.resourceKey,
            action: mutation.action,
            atomicGroupId: mutation.atomicGroupId,
            baseHash: mutation.baseHash,
            localHash: mutation.localHash,
            remoteBeforeHash: mutation.remoteBeforeHash,
            plannedValueHash: `sha256:${digest(deserializeResourceValue(mutation.value))}`,
          })),
        };
        const entryText = JSON.stringify(entry);
        for (const mutation of groupMutations) {
          assert.equal(
            entryText.includes(JSON.stringify(mutation.value)),
            false,
            `${testCase.id} ${group.id} hash-only evidence leaked payload for ${mutation.resourceKey}`,
          );
        }
        return entry;
      });

      return {
        id: testCase.id,
        tier: testCase.tier,
        family: testCase.family,
        tags: [...testCase.tags].sort(),
        status: plan.status,
        summary: plan.summary,
        groups: groupEvidence,
        refusal: {
          code: error.code,
          detailsHash: `sha256:${digest(error.details)}`,
          beforeRemoteHash: `sha256:${beforeRemoteHash}`,
          afterRemoteHash: `sha256:${digest(remote)}`,
          appliedMutationCount,
          durableJournalEventCount: journalEvents.length,
          mutationJournalEventCount,
        },
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

function aggregateGeneratedAtomicBlockerPropagationEvidence(evidence) {
  const aggregate = evidence.reduce(
    (aggregate, entry) => {
      aggregate.totalCases++;
      aggregate.totalBlockedGroups += entry.groups.length;
      aggregate.totalAppliedMutations += entry.refusal.appliedMutationCount;
      aggregate.totalDurableJournalEvents += entry.refusal.durableJournalEventCount;
      aggregate.totalMutationJournalEvents += entry.refusal.mutationJournalEventCount;
      incrementCount(aggregate.statuses, entry.status);
      incrementCount(aggregate.tiers, entry.tier);
      incrementCount(aggregate.families, entry.family);
      for (const group of entry.groups) {
        aggregate.totalGroupMutations += group.mutations.length;
        aggregate.totalDirectBlockers += group.directBlockers.length;
        aggregate.totalPropagatedBlockers += group.propagatedBlockers.length;
        for (const blocker of group.directBlockers) {
          incrementCount(aggregate.directBlockerClasses, blocker.class);
        }
      }
      return aggregate;
    },
    {
      totalCases: 0,
      totalBlockedGroups: 0,
      totalGroupMutations: 0,
      totalDirectBlockers: 0,
      totalPropagatedBlockers: 0,
      totalAppliedMutations: 0,
      totalDurableJournalEvents: 0,
      totalMutationJournalEvents: 0,
      statuses: {},
      tiers: {},
      families: {},
      directBlockerClasses: {},
    },
  );

  return {
    ...aggregate,
    statuses: sortStringObject(aggregate.statuses),
    tiers: sortNumericObject(aggregate.tiers),
    families: sortStringObject(aggregate.families),
    directBlockerClasses: sortStringObject(aggregate.directBlockerClasses),
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
