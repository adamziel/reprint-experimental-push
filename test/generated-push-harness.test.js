import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  MIN_GENERATED_PUSH_CASES,
  generateDriverDeleteSupportFlagCases,
  generateDriverDryRunValidationHookCases,
  generateDriverOwnerIdentityBindingCases,
  generateWpPostmetaDriverSemanticsVariant3Cases,
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateDriverDeleteSupportFlagCase,
  validateDriverDryRunValidationHookCase,
  validateDriverOwnerIdentityBindingCase,
  validateGeneratedCase,
  validateWpPostmetaDriverSemanticsVariant3Case,
} from '../scripts/harness/generated-push-cases.js';
import { EVIDENCE_REDACTION_MARKER, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, enumerateResources, getResource, resourceHash, setResource } from '../src/resources.js';
import { ABSENT, digest } from '../src/stable-json.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const atomicDependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const atomicDependentPlugin = 'reprint-push-atomic-dependent-fixture';
const atomicDependencyPluginFile = `wp-content/plugins/${atomicDependencyPlugin}/${atomicDependencyPlugin}.php`;
const atomicDependentPluginFile = `wp-content/plugins/${atomicDependentPlugin}/${atomicDependentPlugin}.php`;
const atomicFixtureOptionRowId = 'option_name:reprint_push_atomic_fixture_data';

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

function assertGeneratedMutationPreconditionOneToOne(testCase, plan) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${testCase.id} should emit exactly one precondition per mutation`,
  );

  const mutationById = new Map();
  for (const mutation of plan.mutations) {
    assert.equal(mutationById.has(mutation.id), false, `${testCase.id} duplicate mutation id ${mutation.id}`);
    assert.equal(mutation.resource?.key, mutation.resourceKey, `${testCase.id} mutation resource key mismatch`);
    mutationById.set(mutation.id, mutation);
  }

  const preconditionByMutationId = new Map();
  for (const precondition of plan.preconditions) {
    assert.equal(
      preconditionByMutationId.has(precondition.mutationId),
      false,
      `${testCase.id} duplicate precondition for ${precondition.mutationId}`,
    );
    preconditionByMutationId.set(precondition.mutationId, precondition);
    const mutation = mutationById.get(precondition.mutationId);
    assert.ok(mutation, `${testCase.id} orphan precondition ${precondition.mutationId}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.deepEqual(precondition.resource, mutation.resource);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.expectedHash, resourceHash(testCase.remote, mutation.resource));
    assert.equal(precondition.checkedAgainst, 'live-remote');
  }

  for (const mutation of plan.mutations) {
    assert.ok(
      preconditionByMutationId.has(mutation.id),
      `${testCase.id} missing precondition for ${mutation.id}`,
    );
  }
}

function assertRpp0211GeneratedMutationPreconditionOneToOne(testCase, plan) {
  assertGeneratedMutationPreconditionOneToOne(testCase, plan);
}

function rpp0231GeneratedMutationPreconditionEvidence() {
  const cases = generatePushHarnessCases();
  const evidence = {
    totalCases: cases.length,
    statuses: {},
    totals: {
      mutations: 0,
      preconditions: 0,
    },
    maxMutations: 0,
    readyCasesWithMutations: 0,
    nonReadyCasesWithMutations: 0,
    statusByTier: {},
    mutationResourceProofs: [],
  };

  for (const testCase of cases) {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    assertGeneratedMutationPreconditionOneToOne(testCase, plan);

    incrementCount(evidence.statuses, plan.status);
    evidence.statusByTier[plan.status] ||= {};
    incrementCount(evidence.statusByTier[plan.status], testCase.tier);
    evidence.totals.mutations += plan.mutations.length;
    evidence.totals.preconditions += plan.preconditions.length;
    evidence.maxMutations = Math.max(evidence.maxMutations, plan.mutations.length);
    if (plan.mutations.length > 0) {
      if (plan.status === 'ready') {
        evidence.readyCasesWithMutations++;
      } else {
        evidence.nonReadyCasesWithMutations++;
      }
    }
    evidence.mutationResourceProofs.push({
      id: testCase.id,
      family: testCase.family,
      tier: testCase.tier,
      status: plan.status,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      mutationResourceKeys: plan.mutations.map((mutation) => mutation.resourceKey).sort(),
      preconditionResourceKeys: plan.preconditions.map((precondition) => precondition.resourceKey).sort(),
      mutationIds: plan.mutations.map((mutation) => mutation.id).sort(),
      preconditionMutationIds: plan.preconditions.map((precondition) => precondition.mutationId).sort(),
    });
  }

  return evidence;
}

const requiredFamilies = [
  'local-file-update',
  'remote-only-post-update',
  'independent-local-and-remote',
  'independent-local-row-remote-file',
  'direct-row-conflict',
  'local-delete',
  'same-independent-content',
  'same-independent-content-target',
  'large-ready-plan-tier',
  'large-ready-plan',
  'large-ready-plan-target',
  'large-ready-plan-v3',
  'large-ready-plan-v3-ready',
  'supported-plugin-option',
  'unsupported-plugin-owned-row',
  'plugin-owner-context-drift',
  'file-topology-conflict',
  'directory-descendant-conflict',
  'directory-descendant-ready',
  'same-plan-post-parent-graph',
  'same-plan-post-author-graph',
  'stale-post-author-graph',
  'stale-graph-reference',
  'same-plan-taxonomy-graph',
  'same-plan-comment-graph',
  'wp-comments-commentmeta-graph-stale',
  'wp-comments-commentmeta-graph',
  'wp-comments-create',
  'wp-commentmeta-create',
  'wp-comments-remote-drift',
  'supported-forms-lab-table',
  'forms-lab-delete-blocked',
  'atomic-plugin-stack-ready',
  'atomic-plugin-missing-dependency',
  'atomic-plugin-install-stack-v1',
  'atomic-plugin-stack-ready-v1',
  'atomic-plugin-stack-missing-dependency-v1',
  'atomic-plugin-install-stack-v2',
  'atomic-plugin-stack-ready-v2',
  'atomic-plugin-stack-missing-dependency-v2',
  'atomic-plugin-install-stack-v3',
  'atomic-plugin-stack-ready-v3',
  'atomic-plugin-stack-missing-dependency-v3',
  'plugin-file-update',
  'plugin-context-metadata-drift',
  'remote-delete-local-unchanged',
  'local-create',
  'delete-edit-conflict',
  'file-create-update-delete-mix-ready',
  'file-create-update-delete-mix-conflict',
  'file-create-update-delete-mix',
  'file-create-update-delete-mix-v3',
  'file-create-update-delete-mix-v3-ready',
  'file-create-update-delete-mix-v3-non-ready',
  'file-create-update-delete-mix-v4',
  'file-create-update-delete-mix-v4-ready',
  'file-create-update-delete-mix-v4-non-ready',
  'file-type-swap-ready',
  'file-type-swap-conflict',
  'file-type-swap',
  'file-type-swap-conflict-v4',
  'file-type-swap-conflict-v4-ready',
  'file-type-swap-conflict-v4-non-ready',
  'type-swap-ready',
  'type-swap-conflict',
  'row-create-update-delete-mix-ready',
  'row-create-update-delete-mix-conflict',
  'row-create-update-delete-mix',
  'row-create-update-delete-mix-v3',
  'row-create-update-delete-mix-v3-ready',
  'row-create-update-delete-mix-v3-non-ready',
  'row-create-update-delete-mix-v4',
  'row-create-update-delete-mix-v4-ready',
  'row-create-update-delete-mix-v4-non-ready',
  'row-create',
  'row-update',
  'row-delete',
  'wp-options-scalar-ready',
  'wp-options-scalar-conflict',
  'wp-options-scalar',
  'scalar-option-update',
  'scalar-option-string',
  'scalar-option-number',
  'wp-options-scalar-v3',
  'wp-options-scalar-v3-ready',
  'wp-options-scalar-v3-non-ready',
  'wp-options-scalar-v4',
  'wp-options-scalar-v4-ready',
  'wp-options-scalar-v4-non-ready',
  'wp-options-serialized-ready',
  'wp-options-serialized-conflict',
  'wp-options-serialized',
  'wp-options-serialized-change',
  'wp-options-serialized-v3',
  'wp-options-serialized-v3-ready',
  'wp-options-serialized-v3-non-ready',
  'wp-options-serialized-v4',
  'wp-options-serialized-v4-ready',
  'wp-options-serialized-v4-non-ready',
  'wp-options-update',
  'serialized-option',
  'serialized-option-update',
  'serialized-option-object',
  'serialized-option-array',
  'wp-posts-create-update-delete-ready',
  'wp-posts-create-update-delete-conflict',
  'wp-posts-create-update-delete',
  'wp-posts-create',
  'wp-posts-update',
  'wp-posts-delete',
  'wp-posts-create-update-delete-v3',
  'wp-posts-create-update-delete-v3-ready',
  'wp-posts-create-update-delete-v3-non-ready',
  'wp-posts-create-update-delete-v4',
  'wp-posts-create-update-delete-v4-ready',
  'wp-posts-create-update-delete-v4-non-ready',
  'wp-postmeta-create-update-delete-ready',
  'wp-postmeta-create-update-delete-conflict',
  'wp-postmeta-create-update-delete',
  'wp-postmeta-create',
  'wp-postmeta-update',
  'wp-postmeta-delete',
  'wp-postmeta-create-update-delete-v3',
  'wp-postmeta-create-update-delete-v3-ready',
  'wp-postmeta-create-update-delete-v3-non-ready',
  'wp-postmeta-create-update-delete-v4',
  'wp-postmeta-create-update-delete-v4-ready',
  'wp-postmeta-create-update-delete-v4-non-ready',
  'wp-comments-commentmeta-graph-ready',
  'wp-comments-commentmeta-graph-stale',
  'wp-comments-commentmeta-graph',
  'wp-comments-commentmeta-graph-v4',
  'wp-comments-commentmeta-graph-v4-ready',
  'wp-comments-commentmeta-graph-v4-stale',
  'wp-comments-commentmeta-graph-v4-non-ready',
  'wp-commentmeta-create',
  'wp-comments-remote-drift',
  'commentmeta-comment-graph',
  'wp-terms-termmeta-graph-ready',
  'wp-terms-termmeta-graph-stale',
  'wp-terms-termmeta-graph',
  'wp-terms-termmeta-graph-v3',
  'wp-terms-termmeta-graph-v3-ready',
  'wp-terms-termmeta-graph-v3-stale',
  'wp-terms-termmeta-graph-v3-non-ready',
  'wp-terms-termmeta-graph-v4',
  'wp-terms-termmeta-graph-v4-ready',
  'wp-terms-termmeta-graph-v4-stale',
  'wp-terms-termmeta-graph-v4-non-ready',
  'wp-termmeta-create',
  'termmeta-term-graph',
  'wp-users-usermeta-graph-ready',
  'wp-users-usermeta-graph-stale',
  'wp-users-usermeta-graph',
  'wp-users-usermeta-graph-v3',
  'wp-users-usermeta-graph-v3-ready',
  'wp-users-usermeta-graph-v3-stale',
  'wp-users-usermeta-graph-v3-non-ready',
  'wp-users-create',
  'wp-usermeta-create',
  'wp-users-remote-drift',
  'usermeta-user-graph',
  'wp-term-taxonomy-graph-ready',
  'wp-term-taxonomy-graph-stale',
  'wp-term-taxonomy-graph',
  'wp-term-taxonomy-graph-v3',
  'wp-term-taxonomy-graph-v3-ready',
  'wp-term-taxonomy-graph-v3-stale',
  'wp-term-taxonomy-graph-v3-non-ready',
  'wp-term-taxonomy-graph-v4',
  'wp-term-taxonomy-graph-v4-ready',
  'wp-term-taxonomy-graph-v4-stale',
  'wp-term-taxonomy-graph-v4-non-ready',
  'wp-terms-create',
  'wp-term-taxonomy-create',
  'wp-terms-remote-drift',
  'term-taxonomy-term-graph',
  'wp-term-relationships-graph',
  'wp-term-relationships-graph-target',
  'wp-term-relationships-graph-v3',
  'wp-term-relationships-graph-v3-ready',
  'wp-term-relationships-graph-v3-stale',
  'wp-term-relationships-graph-v3-non-ready',
  'wp-term-relationships-graph-v4',
  'wp-term-relationships-graph-v4-ready',
  'wp-term-relationships-graph-v4-stale',
  'wp-term-relationships-graph-v4-non-ready',
  'wp-term-relationships-graph-ready',
  'wp-term-relationships-graph-stale',
  'wp-term-relationships-remote-drift',
  'wp-term-relationships-create',
  'term-relationship-object-graph',
  'term-relationship-taxonomy-graph',
  'plugin-owned-option-change-ready',
  'plugin-owned-option-change-conflict',
  'plugin-owned-option-change',
  'plugin-owned-option-update',
  'plugin-owned-option-change-v3',
  'plugin-owned-option-change-v3-ready',
  'plugin-owned-option-change-v3-non-ready',
  'plugin-owned-option-change-v4',
  'plugin-owned-option-change-v4-ready',
  'plugin-owned-option-change-v4-non-ready',
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
  'independent-file-remote-row',
  'independent-row-remote-file',
  'featured-image-attachment-ready',
  'featured-image-attachment-stale',
  'featured-image-attachment',
  'featured-image-graph',
  'featured-image-ready',
  'featured-image-stale-target',
  'attachment-post-create',
  'same-plan-graph',
  'post-author-graph',
  'post-author-ready',
  'post-author-stale',
  'post-author-stale-target',
  'plugin-owned-supported',
  'plugin-owned-unsupported',
  'plugin-usermeta-driver-supported',
  'plugin-usermeta-driver-unsupported',
  'plugin-owned-custom-table-change',
  'plugin-owned-custom-table-variant1',
  'plugin-owned-custom-table-variant3',
  'plugin-owned-custom-table-variant3-ready',
  'plugin-owned-custom-table-variant3-stale',
  'plugin-owned-custom-table-variant3-non-ready',
  'plugin-owned-custom-table-variant4',
  'plugin-owned-custom-table-variant4-ready',
  'plugin-owned-custom-table-variant4-stale',
  'plugin-owned-custom-table-variant4-non-ready',
  'plugin-owned-custom-table-update',
  'plugin-owned-resource-refusal-v3',
  'plugin-owned-resource-refusal-v3-ready',
  'plugin-owned-resource-refusal-v3-changed',
  'plugin-owned-resource-refusal-v3-stale',
  'file-topology',
  'directory-descendant',
  'directory-descendant-v3',
  'directory-descendant-v3-ready',
  'directory-descendant-v3-non-ready',
  'directory-descendant-v4',
  'directory-descendant-v4-ready',
  'directory-descendant-v4-non-ready',
  'directory-delete-with-remote-descendant',
  'directory-delete-no-remote-descendant',
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
  assert.ok(
    summary.statusByFeatureFamily['same-plan-post-author-graph'].ready > 0,
    'post_author same-plan user mapping needs ready generated cases',
  );
  assert.ok(
    summary.statusByFeatureFamily['stale-post-author-graph'].blocked > 0,
    'post_author stale user mapping needs blocked generated cases',
  );
  assert.ok(
    summary.statusByFeatureFamily['post-author-graph'].ready > 0,
    'post_author mapping tag needs ready coverage',
  );
  assert.ok(
    summary.statusByFeatureFamily['post-author-graph'].blocked > 0,
    'post_author mapping tag needs stale/blocked coverage',
  );
  assert.ok(summary.totalDecisions > 0);
});

test('RPP-0211 generated cases keep mutation preconditions one-to-one', () => {
  const cases = generatePushHarnessCases();
  const summary = {
    ready: 0,
    nonReady: 0,
    mutations: 0,
    preconditions: 0,
    maxMutations: 0,
  };

  for (const testCase of cases) {
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });

    assertRpp0211GeneratedMutationPreconditionOneToOne(testCase, plan);
    summary.ready += plan.status === 'ready' ? 1 : 0;
    summary.nonReady += plan.status === 'ready' ? 0 : 1;
    summary.mutations += plan.mutations.length;
    summary.preconditions += plan.preconditions.length;
    summary.maxMutations = Math.max(summary.maxMutations, plan.mutations.length);
  }

  assert.equal(cases.length, DEFAULT_GENERATED_PUSH_CASES);
  assert.ok(summary.ready > 0, 'generated RPP-0211 proof needs ready fixtures');
  assert.ok(summary.nonReady > 0, 'generated RPP-0211 proof needs non-ready fixtures');
  assert.ok(summary.mutations > cases.length, 'generated RPP-0211 proof needs broad mutation coverage');
  assert.equal(summary.preconditions, summary.mutations);
  assert.ok(summary.maxMutations >= 15, 'generated RPP-0211 proof needs high-mutation fixtures');
});

test('RPP-0231 generated harness proves mutation preconditions one-to-one variant 2', () => {
  const firstEvidence = rpp0231GeneratedMutationPreconditionEvidence();
  const replayEvidence = rpp0231GeneratedMutationPreconditionEvidence();
  const report = runGeneratedPushHarness();
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0231 test/generated-push-harness.test.js',
    caveat: 'Local deterministic Node generated-harness proof; release remains gated separately.',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    totals: firstEvidence.totals,
  };

  assert.deepEqual(
    firstEvidence,
    replayEvidence,
    'RPP-0231 generated mutation/precondition evidence changed between runs',
  );
  assert.equal(firstEvidence.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.equal(firstEvidence.totalCases, report.summary.totalCases);
  assert.equal(firstEvidence.totals.preconditions, firstEvidence.totals.mutations);
  assert.equal(firstEvidence.totals.preconditions, report.summary.totalPreconditions);
  assert.equal(firstEvidence.totals.mutations, report.summary.totalMutations);
  assert.ok(firstEvidence.statuses.ready > 0, 'RPP-0231 generated proof needs ready cases');
  assert.ok(firstEvidence.statuses.conflict > 0, 'RPP-0231 generated proof needs conflict cases');
  assert.ok(firstEvidence.statuses.blocked > 0, 'RPP-0231 generated proof needs blocked cases');
  assert.ok(
    firstEvidence.nonReadyCasesWithMutations > 0,
    'RPP-0231 generated proof needs non-ready cases that still emit safe planned mutations',
  );
  assert.ok(firstEvidence.maxMutations >= 15, 'RPP-0231 generated proof needs high-mutation cases');
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
});

test('RPP-0407 generated harness covers supported and unsupported wp_usermeta driver variants', () => {
  const report = runGeneratedPushHarness();
  const supportedCoverage = report.summary.targetCoverage.usermetaDriverSupported;
  const unsupportedCoverage = report.summary.targetCoverage.usermetaDriverUnsupported;

  assert.ok(supportedCoverage, 'missing supported wp_usermeta driver coverage');
  assert.ok(unsupportedCoverage, 'missing unsupported wp_usermeta driver coverage');
  assert.equal(supportedCoverage.family, 'supported-plugin-usermeta');
  assert.equal(unsupportedCoverage.family, 'unsupported-plugin-usermeta');
  assert.ok(supportedCoverage.statuses.ready > 0, 'supported usermeta driver cases should be ready');
  assert.ok(unsupportedCoverage.statuses.blocked > 0, 'unsupported usermeta driver cases should fail closed');
  assert.equal(unsupportedCoverage.statuses.ready || 0, 0, 'unsupported usermeta driver cases must not be ready');
  assert.deepEqual(
    Object.keys(supportedCoverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    Object.keys(unsupportedCoverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  const cases = generatePushHarnessCases();
  const supportedCase = cases.find((testCase) => testCase.family === 'supported-plugin-usermeta');
  const unsupportedCase = cases.find((testCase) => testCase.family === 'unsupported-plugin-usermeta');
  assert.ok(supportedCase, 'missing generated supported wp_usermeta case');
  assert.ok(unsupportedCase, 'missing generated unsupported wp_usermeta case');

  const supportedShape = generatedPluginUsermetaShape(supportedCase);
  const unsupportedShape = generatedPluginUsermetaShape(unsupportedCase);
  const supportedPlan = createPushPlan({
    base: supportedCase.base,
    local: supportedCase.local,
    remote: supportedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const unsupportedPlan = createPushPlan({
    base: unsupportedCase.base,
    local: unsupportedCase.local,
    remote: unsupportedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const supportedResult = validateGeneratedCase(supportedCase);
  const unsupportedResult = validateGeneratedCase(unsupportedCase);
  const supportedMutation = supportedPlan.mutations.find((mutation) =>
    mutation.resourceKey === supportedShape.resourceKey);
  const unsupportedBlocker = unsupportedPlan.blockers.find((blocker) =>
    blocker.resourceKey === unsupportedShape.resourceKey);
  const supportedEvidence = supportedMutation.pluginOwnedResource.driverEvidence;
  const supportedEvidenceJson = JSON.stringify(supportedEvidence);
  const unsupportedBlockerJson = JSON.stringify(unsupportedBlocker);

  assert.equal(supportedResult.status, 'ready');
  assert.equal(supportedMutation.pluginOwnedResource.driver, 'wp-usermeta');
  assert.equal(supportedEvidence.supported, true);
  assert.equal(supportedEvidence.table, 'wp_usermeta');
  assert.equal(supportedEvidence.rowId, supportedShape.rowId);
  assert.equal(supportedEvidence.rowIdKind, 'umeta_id');
  assert.equal(supportedEvidence.userId, supportedShape.row.user_id);
  assert.equal(supportedEvidence.metaKey, supportedShape.row.meta_key);
  assert.equal(Object.hasOwn(supportedEvidence, 'meta_value'), false);
  assert.equal(Object.hasOwn(supportedEvidence, 'metaValue'), false);
  assert.equal(supportedEvidenceJson.includes('"mode":"local"'), false);
  assert.equal(supportedEvidenceJson.includes('"ordinal"'), false);

  assert.equal(unsupportedResult.status, 'blocked');
  assert.equal(unsupportedPlan.status, 'blocked');
  assert.equal(unsupportedPlan.mutations.some((mutation) =>
    mutation.resourceKey === unsupportedShape.resourceKey), false);
  assert.equal(unsupportedBlocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(unsupportedBlocker.driver, 'wp-usermeta');
  assert.equal(unsupportedBlocker.driverEvidence.supported, false);
  assert.equal(unsupportedBlocker.driverEvidence.rowId, unsupportedShape.rowId);
  assert.equal(unsupportedBlocker.driverEvidence.rowIdKind, 'umeta_id');
  assert.match(unsupportedBlocker.reason, /umeta_id to match the resource id/);
  assert.equal(unsupportedBlockerJson.includes('local-invalid'), false);
  assert.equal(unsupportedBlockerJson.includes('meta_value'), false);
});

test('RPP-0221 generated harness preserves independent local files and remote rows', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.independentLocalFileRemoteRow;

  assert.ok(coverage, 'missing independent local file plus remote row target coverage');
  assert.equal(coverage.family, 'independent-local-and-remote');
  assert.equal(coverage.total, report.summary.featureFamilies['independent-local-and-remote']);
  assert.deepEqual(coverage.statuses, { ready: coverage.total });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  const generatedCase = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'independent-local-and-remote')
    .at(-1);
  assert.ok(generatedCase, 'missing generated independent local/remote case');
  assert.ok(generatedCase.tags.has('independent-merge'));

  const { filePath, fileValue, rowId, rowTitle } = generatedIndependentLocalRemoteTargets(generatedCase);
  const fileKey = `file:${filePath}`;
  const rowKey = `row:["wp_posts","${rowId}"]`;
  const plan = createPushPlan({
    base: generatedCase.base,
    local: generatedCase.local,
    remote: generatedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const validation = validateGeneratedCase(generatedCase);
  const fileMutation = plan.mutations.find((mutation) => mutation.resourceKey === fileKey);
  const rowDecision = plan.decisions.find((decision) => decision.resourceKey === rowKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === fileKey);
  const evidence = JSON.stringify(hashOnlyGeneratedPlanEvidence(plan));

  assert.equal(plan.status, 'ready');
  assert.equal(validation.status, 'ready');
  assert.equal(validation.applied, true);
  assert.equal(validation.unplannedRemotePreserved, true);
  assert.ok(fileMutation, `${generatedCase.id} missing local file mutation`);
  assert.equal(fileMutation.action, 'put');
  assert.equal(rowDecision?.decision, 'keep-remote');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === rowKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === rowKey), false);
  assert.equal(precondition?.expectedHash, fileMutation.remoteBeforeHash);
  assert.equal(evidence.includes(fileValue), false, 'hash-only generated evidence leaked local file value');
  assert.equal(evidence.includes(rowTitle), false, 'hash-only generated evidence leaked remote row value');

  const result = applyPlan(cloneJson(generatedCase.remote), plan);
  assert.equal(result.site.files[filePath], fileValue);
  assert.equal(result.site.db.wp_posts[rowId].post_title, rowTitle);
});

test('RPP-0222 generated harness preserves independent local rows and remote files', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.independentLocalRowRemoteFile;

  assert.ok(coverage, 'missing independent local row plus remote file target coverage');
  assert.equal(coverage.family, 'independent-local-row-remote-file');
  assert.equal(coverage.total, report.summary.featureFamilies['independent-local-row-remote-file']);
  assert.deepEqual(coverage.statuses, { ready: coverage.total });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  const generatedCase = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'independent-local-row-remote-file')
    .at(-1);
  assert.ok(generatedCase, 'missing generated independent row/file case');
  assert.ok(generatedCase.tags.has('independent-merge'));
  assert.ok(generatedCase.tags.has('independent-row-remote-file'));

  const { rowId, rowTitle, filePath, fileValue } = generatedIndependentRowRemoteFileTargets(generatedCase);
  const rowKey = `row:["wp_posts","${rowId}"]`;
  const fileKey = `file:${filePath}`;
  const plan = createPushPlan({
    base: generatedCase.base,
    local: generatedCase.local,
    remote: generatedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const validation = validateGeneratedCase(generatedCase);
  const rowMutation = plan.mutations.find((mutation) => mutation.resourceKey === rowKey);
  const fileDecision = plan.decisions.find((decision) => decision.resourceKey === fileKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === rowKey);
  const evidence = JSON.stringify(hashOnlyGeneratedPlanEvidence(plan));

  assert.equal(plan.status, 'ready');
  assert.equal(validation.status, 'ready');
  assert.equal(validation.applied, true);
  assert.equal(validation.unplannedRemotePreserved, true);
  assert.ok(rowMutation, `${generatedCase.id} missing local row mutation`);
  assert.equal(rowMutation.action, 'put');
  assert.equal(fileDecision?.decision, 'keep-remote');
  assert.equal(fileDecision.change.remoteChange, 'update');
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === fileKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === fileKey), false);
  assert.equal(precondition?.expectedHash, rowMutation.remoteBeforeHash);
  assert.equal(evidence.includes(rowTitle), false, 'hash-only generated evidence leaked local row value');
  assert.equal(evidence.includes(fileValue), false, 'hash-only generated evidence leaked remote file value');

  const result = applyPlan(cloneJson(generatedCase.remote), plan);
  assert.equal(result.site.db.wp_posts[rowId].post_title, rowTitle);
  assert.equal(result.site.files[filePath], fileValue);
});

test('RPP-0223 generated harness refuses local delete versus remote edit cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.localDeleteRemoteEdit;

  assert.ok(coverage, 'missing local delete versus remote edit target coverage');
  assert.equal(coverage.family, 'delete-edit-conflict');
  assert.equal(coverage.total, report.summary.featureFamilies['delete-edit-conflict']);
  assert.deepEqual(coverage.statuses, { conflict: coverage.total });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  const generatedCase = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'delete-edit-conflict')
    .at(-1);
  assert.ok(generatedCase, 'missing generated delete/edit case');
  assert.ok(generatedCase.tags.has('delete-edit'));
  assert.ok(generatedCase.tags.has('expected-conflict'));

  const { rowId, remoteTitle } = generatedDeleteEditTargets(generatedCase);
  const rowKey = `row:["wp_posts","${rowId}"]`;
  const plan = createPushPlan({
    base: generatedCase.base,
    local: generatedCase.local,
    remote: generatedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const validation = validateGeneratedCase(generatedCase);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === rowKey);
  const evidence = JSON.stringify(hashOnlyGeneratedPlanEvidence(plan));
  const remoteReplay = cloneJson(generatedCase.remote);
  const beforeReplay = JSON.stringify(remoteReplay);
  const error = captureError(() => applyPlan(remoteReplay, plan));

  assert.equal(plan.status, 'conflict');
  assert.equal(validation.status, 'conflict');
  assert.equal(validation.applied, false);
  assert.ok(conflict, `${generatedCase.id} missing row delete/edit conflict`);
  assert.equal(conflict.class, 'row-conflict');
  assert.equal(conflict.change.localChange, 'delete');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === rowKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === rowKey), false);
  assert.equal(JSON.stringify(conflict).includes(remoteTitle), false);
  assert.equal(evidence.includes(remoteTitle), false, 'hash-only generated evidence leaked remote row value');
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(JSON.stringify(remoteReplay), beforeReplay, 'conflict apply mutated generated remote');
});

test('RPP-0118 same independent content target applies without unplanned remote overwrite', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.sameIndependentContent;

  assert.ok(coverage, 'missing same independent content target coverage');
  assert.equal(coverage.family, 'same-independent-content');
  assert.equal(coverage.total, report.summary.featureFamilies['same-independent-content']);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'target should include ready same independent content cases');
  assert.deepEqual(coverage.perTier, {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
  });

  const sameCase = generatePushHarnessCases()
    .find((testCase) => testCase.family === 'same-independent-content');

  assert.ok(sameCase, 'missing generated same independent content case');
  assert.ok(sameCase.tags.has('same-independent-content-target'));
  const sameShape = assertSameIndependentContentShape(sameCase);

  const result = validateGeneratedCase(sameCase);
  const plan = createPushPlan({
    base: sameCase.base,
    local: sameCase.local,
    remote: sameCase.remote,
    now: fixedGeneratedHarnessNow,
  });

  assert.equal(result.status, 'ready');
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === sameShape.resourceKey),
    false,
    'identical independent edits should not need a mutation for the synchronized row',
  );
  assert.ok(result.decisions >= 1, 'same independent content should record an already-in-sync decision');
  assert.equal(result.applied, true, 'same independent content should apply through the harness');
  assert.equal(result.unplannedRemotePreserved, true, 'same independent content must preserve unplanned remote data');
});

test('RPP-0138 same independent content variant 2 proves ready preservation without unplanned overwrite', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.sameIndependentContent;

  assert.ok(coverage, 'missing same independent content target coverage');

  const firstEvidence = generatedSameIndependentContentVariant2Evidence(coverage);
  const replayEvidence = generatedSameIndependentContentVariant2Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0138 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'same-independent-content');
  assert.equal(coverage.total, report.summary.featureFamilies['same-independent-content']);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 2 same independent evidence changed between runs');
  assert.equal(firstEvidence.target, 'sameIndependentContent');
  assert.equal(firstEvidence.family, 'same-independent-content');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of firstEvidence.cases) {
    assert.equal(entry.status, 'ready', `${entry.id} should remain ready`);
    assert.equal(entry.applied, true, `${entry.id} should apply through the harness`);
    assert.equal(entry.unplannedRemotePreserved, true, `${entry.id} should preserve unplanned remote data`);
    assert.equal(entry.sameResource.decision, 'already-in-sync');
    assert.equal(entry.sameResource.localHash, entry.sameResource.remoteHash);
    assert.equal(entry.sameResource.appliedHash, entry.sameResource.remoteHash);
    assert.notEqual(entry.sameResource.baseHash, entry.sameResource.localHash);
    assert.equal(entry.sameResource.plannedMutation, false);
    assert.equal(entry.sameResource.plannedPrecondition, false);
    assert.match(entry.sameResource.decisionHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.modelProofHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Shared independent'), false, 'variant 2 evidence leaked shared row title');
});

test('RPP-0158 same independent content variant 3 applies ready cases without unplanned remote overwrite', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.sameIndependentContentVariant3;
  const legacyCoverage = report.summary.targetCoverage.sameIndependentContent;

  assert.ok(coverage, 'missing same independent content variant 3 target coverage');
  assert.ok(legacyCoverage, 'missing same independent content legacy target coverage');

  const firstEvidence = generatedSameIndependentContentVariant3Evidence(coverage);
  const replayEvidence = generatedSameIndependentContentVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0158 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'same-independent-content-variant3');
  assert.equal(coverage.total, legacyCoverage.total);
  assert.deepEqual(coverage.perTier, legacyCoverage.perTier);
  assert.deepEqual(coverage.statuses, legacyCoverage.statuses);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 same independent evidence changed between runs');
  assert.equal(firstEvidence.target, 'sameIndependentContentVariant3');
  assert.equal(firstEvidence.family, 'same-independent-content-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of firstEvidence.cases) {
    assert.equal(entry.status, 'ready', `${entry.id} should remain ready`);
    assert.equal(entry.applied, true, `${entry.id} should apply through the harness`);
    assert.equal(entry.unplannedRemotePreserved, true, `${entry.id} should preserve unplanned remote data`);
    assert.equal(entry.sameResource.decision, 'already-in-sync');
    assert.equal(entry.sameResource.localHash, entry.sameResource.remoteHash);
    assert.equal(entry.sameResource.appliedHash, entry.sameResource.remoteHash);
    assert.notEqual(entry.sameResource.baseHash, entry.sameResource.localHash);
    assert.equal(entry.sameResource.plannedMutation, false);
    assert.equal(entry.sameResource.plannedPrecondition, false);
    assert.equal(entry.unplannedRemote.preserved, true);
    assert.equal(entry.unplannedRemote.plannedMutationCount, entry.planSummary.mutations);
    assert.ok(entry.unplannedRemote.unplannedResourceCount >= 1, `${entry.id} should verify unplanned resources`);
    assert.match(entry.sameResource.decisionHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.unplannedRemote.proofHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.modelProofHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Shared independent'), false, 'variant 3 evidence leaked shared row title');
  assert.equal(evidenceText.includes('Ready same content'), false, 'variant 3 evidence leaked ready same-content payload');
  assert.equal(evidenceText.includes('Remote ready preserve'), false, 'variant 3 evidence leaked remote-only row title');
});

test('RPP-0178 same independent content variant 4 applies ready cases without unplanned remote overwrite', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.sameIndependentContentVariant4;
  const variant3Coverage = report.summary.targetCoverage.sameIndependentContentVariant3;
  const legacyCoverage = report.summary.targetCoverage.sameIndependentContent;

  assert.ok(coverage, 'missing same independent content variant 4 target coverage');
  assert.ok(variant3Coverage, 'missing same independent content variant 3 target coverage');
  assert.ok(legacyCoverage, 'missing same independent content legacy target coverage');

  const firstEvidence = generatedSameIndependentContentVariant4Evidence(coverage);
  const replayEvidence = generatedSameIndependentContentVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0178 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'same-independent-content-variant4');
  assert.equal(coverage.total, legacyCoverage.total);
  assert.equal(coverage.total, variant3Coverage.total);
  assert.deepEqual(coverage.perTier, legacyCoverage.perTier);
  assert.deepEqual(coverage.perTier, variant3Coverage.perTier);
  assert.deepEqual(coverage.statuses, legacyCoverage.statuses);
  assert.deepEqual(coverage.statuses, variant3Coverage.statuses);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 same independent evidence changed between runs');
  assert.equal(firstEvidence.target, 'sameIndependentContentVariant4');
  assert.equal(firstEvidence.family, 'same-independent-content-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of firstEvidence.cases) {
    assert.equal(entry.status, 'ready', `${entry.id} should remain ready`);
    assert.equal(entry.applied, true, `${entry.id} should apply through the harness`);
    assert.equal(entry.unplannedRemotePreserved, true, `${entry.id} should preserve unplanned remote data`);
    assert.equal(entry.sameResource.decision, 'already-in-sync');
    assert.equal(entry.sameResource.localHash, entry.sameResource.remoteHash);
    assert.equal(entry.sameResource.appliedHash, entry.sameResource.remoteHash);
    assert.notEqual(entry.sameResource.baseHash, entry.sameResource.localHash);
    assert.equal(entry.sameResource.plannedMutation, false);
    assert.equal(entry.sameResource.plannedPrecondition, false);
    assert.equal(entry.apply.appliedMutations, entry.planSummary.mutations);
    assert.equal(entry.apply.sameResourceSkipped, true);
    assert.equal(entry.unplannedRemote.preserved, true);
    assert.equal(entry.unplannedRemote.plannedMutationCount, entry.planSummary.mutations);
    assert.equal(entry.unplannedRemote.changedResourceCount, 0);
    assert.ok(entry.unplannedRemote.unplannedResourceCount >= 1, `${entry.id} should verify unplanned resources`);
    assert.match(entry.sameResource.decisionHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.apply.applyProofHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.unplannedRemote.proofHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.modelProofHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Shared independent'), false, 'variant 4 evidence leaked shared row title');
  assert.equal(evidenceText.includes('Ready same content'), false, 'variant 4 evidence leaked ready same-content payload');
  assert.equal(evidenceText.includes('Remote ready preserve'), false, 'variant 4 evidence leaked remote-only row title');
});

function generatedPluginUsermetaShape(testCase) {
  const entry = Object.entries(testCase.local.db.wp_usermeta)
    .find(([, row]) => row.__pluginOwner === 'forms'
      && typeof row.meta_key === 'string'
      && row.meta_key.startsWith('_forms_generated_user_flag_'));
  assert.ok(entry, `${testCase.id} missing generated plugin-owned usermeta row`);
  const [rowId, row] = entry;
  assert.match(rowId, /^umeta_id:[1-9]\d*$/);
  assert.equal(testCase.base.db.wp_usermeta[rowId]?.__pluginOwner, 'forms');
  assert.equal(testCase.remote.db.wp_usermeta[rowId]?.__pluginOwner, 'forms');
  return {
    rowId,
    row,
    resourceKey: `row:${JSON.stringify(['wp_usermeta', rowId])}`,
  };
}

test('RPP-0119 remote-only preservation rejects stale replay before mutation with hash-only evidence', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.remoteOnlyPreservation;

  assert.ok(coverage, 'missing remote-only preservation target coverage');
  assert.equal(coverage.family, 'remote-only-post-update');
  assert.equal(coverage.total, 9);
  assert.deepEqual(coverage.statuses, { ready: 9 });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    report.summary.statusByFeatureFamily['remote-only-post-update'].ready,
    10,
    'remote-only generated family should still include the zero-mutation tier-0 preservation case',
  );

  const generatedCase = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'remote-only-post-update')
    .at(-1);
  assert.ok(generatedCase, 'missing generated remote-only preservation case');
  assert.ok(generatedCase.tags.has('remote-preserve'));

  const { rowId, remoteTitle } = generatedRemoteOnlyPostUpdateTargets(generatedCase);
  const rowKey = generatedRowResourceKey('wp_posts', rowId);
  const plan = createPushPlan({
    base: generatedCase.base,
    local: generatedCase.local,
    remote: generatedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const validation = validateGeneratedCase(generatedCase);
  const rowDecision = plan.decisions.find((decision) => decision.resourceKey === rowKey);
  const staleMutationIndex = plan.mutations.findIndex((mutation, index) =>
    index > 0 && mutation.action === 'put' && mutation.resource.type === 'file');

  assert.ok(staleMutationIndex > 0, `${generatedCase.id} should have a later file mutation for preflight proof`);
  const staleMutation = plan.mutations[staleMutationIndex];
  const stalePrecondition = plan.preconditions.find((entry) => entry.mutationId === staleMutation.id);
  const plannedFileValue = deserializeResourceValue(staleMutation.value);
  const plannedFilePayload = plannedFileValue.content;
  const stalePrivatePayload = 'stale-private-rpp0119-late-precondition';
  const staleRemote = cloneJson(generatedCase.remote);

  assert.ok(rowDecision, `${generatedCase.id} should record the remote-only row decision`);
  assert.ok(stalePrecondition, `${generatedCase.id} should record the stale mutation precondition`);
  assert.equal(typeof plannedFilePayload, 'string');

  setResource(staleRemote, staleMutation.resource, { type: 'file', content: stalePrivatePayload });
  const staleBeforeHash = digest(staleRemote);
  const staleError = captureError(() => applyPlan(staleRemote, plan));
  const staleAfterHash = digest(staleRemote);
  const hashOnlyEvidence = {
    target: 'RPP-0119',
    caseId: generatedCase.id,
    family: generatedCase.family,
    status: plan.status,
    summary: plan.summary,
    remoteOnlyDecision: {
      resourceKey: rowDecision.resourceKey,
      decision: rowDecision.decision,
      remoteHash: rowDecision.remoteHash,
      change: rowDecision.change,
    },
    staleReplay: {
      code: staleError.code,
      resourceKey: staleError.details.resourceKey,
      expectedHash: staleError.details.expectedHash,
      actualHash: staleError.details.actualHash,
      detailsHash: `sha256:${digest(staleError.details)}`,
      remoteBeforeHash: staleBeforeHash,
      remoteAfterHash: staleAfterHash,
    },
    plan: hashOnlyGeneratedPlanEvidence(plan),
  };
  const evidenceJson = JSON.stringify(hashOnlyEvidence);
  const applied = applyPlan(cloneJson(generatedCase.remote), plan);

  assert.equal(plan.status, 'ready');
  assert.equal(validation.status, 'ready');
  assert.equal(validation.applied, true);
  assert.equal(validation.unplannedRemotePreserved, true);
  assert.equal(validation.staleReplayRejected, true);
  assert.equal(validation.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(validation.staleReplayRemoteUnchanged, true);
  assert.ok(plan.mutations.length > 1, `${generatedCase.id} should carry planned local mutations`);
  assert.equal(rowDecision?.decision, 'keep-remote');
  assert.equal(rowDecision.change.localChange, 'unchanged');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === rowKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === rowKey), false);
  assert.equal(stalePrecondition?.resourceKey, staleMutation.resourceKey);
  assert.equal(stalePrecondition.expectedHash, staleMutation.remoteBeforeHash);
  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(staleError.details.resourceKey, staleMutation.resourceKey);
  assert.equal(staleError.details.expectedHash, stalePrecondition.expectedHash);
  assert.match(staleError.details.actualHash, /^[a-f0-9]{64}$/);
  assert.equal(staleAfterHash, staleBeforeHash, 'stale replay mutated remote before refusal');
  assert.match(hashOnlyEvidence.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceJson.includes(remoteTitle), false, 'hash-only evidence leaked remote-only row title');
  assert.equal(evidenceJson.includes(plannedFilePayload), false, 'hash-only evidence leaked local file payload');
  assert.equal(evidenceJson.includes(stalePrivatePayload), false, 'hash-only evidence leaked stale replay payload');
  assert.equal(JSON.stringify(rowDecision).includes(remoteTitle), false, 'decision evidence leaked remote-only row title');
  assert.equal(applied.site.db.wp_posts[rowId].post_title, remoteTitle);
});

test('RPP-0139 remote-only preservation variant 2 proves stale replay refusal before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.remoteOnlyPreservation;

  assert.ok(coverage, 'missing remote-only preservation target coverage');

  const firstEvidence = generatedRemoteOnlyPreservationVariant2Evidence(coverage);
  const replayEvidence = generatedRemoteOnlyPreservationVariant2Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0139 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'remote-only-post-update');
  assert.equal(coverage.total, 9);
  assert.deepEqual(coverage.statuses, { ready: 9 });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    report.summary.statusByFeatureFamily['remote-only-post-update'].ready,
    10,
    'tier-0 remote-only case remains a zero-mutation preservation case',
  );
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 2 remote-only evidence changed between runs');
  assert.equal(firstEvidence.target, 'remoteOnlyPreservation');
  assert.equal(firstEvidence.family, 'remote-only-post-update');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(firstEvidence.cases.length, 9, 'variant 2 should recount every mutation-bearing remote-only case');

  for (const entry of firstEvidence.cases) {
    assert.equal(entry.status, 'ready', `${entry.id} should remain ready`);
    assert.equal(entry.applied, true, `${entry.id} should apply through the harness`);
    assert.equal(entry.unplannedRemotePreserved, true, `${entry.id} should preserve unplanned remote data`);
    assert.equal(entry.remoteOnly.decision, 'keep-remote');
    assert.equal(entry.remoteOnly.change.localChange, 'unchanged');
    assert.equal(entry.remoteOnly.change.remoteChange, 'update');
    assert.equal(entry.remoteOnly.localHash, entry.remoteOnly.baseHash);
    assert.equal(entry.remoteOnly.appliedHash, entry.remoteOnly.remoteHash);
    assert.notEqual(entry.remoteOnly.remoteHash, entry.remoteOnly.baseHash);
    assert.equal(entry.remoteOnly.plannedMutation, false);
    assert.equal(entry.remoteOnly.plannedPrecondition, false);
    assert.match(entry.remoteOnly.decisionHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.ok(entry.staleReplay.mutationIndex > 0, `${entry.id} should drift a later mutation`);
    assert.equal(entry.staleReplay.remoteBeforeHash, entry.staleReplay.remoteAfterHash);
    assert.equal(entry.staleReplay.expectedHash, entry.staleReplay.mutationRemoteBeforeHash);
    assert.notEqual(entry.staleReplay.actualHash, entry.staleReplay.expectedHash);
    assert.match(entry.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.plannedValueHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.preconditionHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.modelProofHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Remote editorial'), false, 'variant 2 evidence leaked remote-only row title');
  assert.equal(evidenceText.includes('stale-private-rpp0139'), false, 'variant 2 evidence leaked stale replay payload');
  assert.equal(evidenceText.includes('ready-bulk'), false, 'variant 2 evidence leaked generated file payload');
});

test('RPP-0159 remote-only preservation variant 3 rejects stale replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.remoteOnlyPreservationVariant3;
  const legacyCoverage = report.summary.targetCoverage.remoteOnlyPreservation;

  assert.ok(coverage, 'missing remote-only preservation variant 3 target coverage');
  assert.ok(legacyCoverage, 'missing remote-only preservation legacy target coverage');

  const firstEvidence = generatedRemoteOnlyPreservationVariant3Evidence(coverage);
  const replayEvidence = generatedRemoteOnlyPreservationVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0159 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'remote-only-preservation-variant3');
  assert.equal(coverage.total, legacyCoverage.total);
  assert.deepEqual(coverage.perTier, legacyCoverage.perTier);
  assert.deepEqual(coverage.statuses, legacyCoverage.statuses);
  assert.equal(coverage.total, 9);
  assert.deepEqual(coverage.statuses, { ready: 9 });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 remote-only preservation evidence changed between runs');
  assert.equal(firstEvidence.target, 'remoteOnlyPreservationVariant3');
  assert.equal(firstEvidence.family, 'remote-only-preservation-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of firstEvidence.cases) {
    assert.equal(entry.status, 'ready', `${entry.id} should remain ready`);
    assert.equal(entry.applied, true, `${entry.id} should apply through the harness`);
    assert.equal(entry.unplannedRemotePreserved, true, `${entry.id} should preserve unplanned remote data`);
    assert.equal(entry.remoteOnly.decision, 'keep-remote');
    assert.equal(entry.remoteOnly.change.localChange, 'unchanged');
    assert.equal(entry.remoteOnly.change.remoteChange, 'update');
    assert.equal(entry.remoteOnly.localHash, entry.remoteOnly.baseHash);
    assert.equal(entry.remoteOnly.appliedHash, entry.remoteOnly.remoteHash);
    assert.notEqual(entry.remoteOnly.remoteHash, entry.remoteOnly.baseHash);
    assert.equal(entry.remoteOnly.plannedMutation, false);
    assert.equal(entry.remoteOnly.plannedPrecondition, false);
    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.ok(entry.staleReplay.mutationIndex > 0, `${entry.id} should drift a non-leading mutation`);
    assert.equal(entry.staleReplay.mutationIndex, entry.staleReplay.mutationCount - 1);
    assert.equal(entry.staleReplay.preconditionCount, entry.staleReplay.mutationCount);
    assert.equal(entry.staleReplay.remoteBeforeHash, entry.staleReplay.remoteAfterHash);
    assert.equal(entry.staleReplay.expectedHash, entry.staleReplay.mutationRemoteBeforeHash);
    assert.notEqual(entry.staleReplay.actualHash, entry.staleReplay.expectedHash);
    assert.match(entry.remoteOnly.decisionHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.plannedValueHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.preconditionHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.modelProofHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Remote editorial'), false, 'variant 3 evidence leaked remote-only row title');
  assert.equal(evidenceText.includes('stale-private-rpp0159'), false, 'variant 3 evidence leaked stale replay payload');
  assert.equal(evidenceText.includes('ready-bulk'), false, 'variant 3 evidence leaked generated ready payload');
});

function assertSameIndependentContentShape(testCase) {
  const sharedRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, localRow]) => testCase.base.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]
      && localRow.post_title.startsWith('Shared independent ')
      && testCase.remote.db.wp_posts[id].post_title === localRow.post_title
      && testCase.base.db.wp_posts[id].post_title !== localRow.post_title);

  assert.equal(sharedRows.length, 1, `${testCase.id} should include one same independent post update`);
  return {
    rowId: sharedRows[0][0],
    resourceKey: generatedRowResourceKey('wp_posts', sharedRows[0][0]),
  };
}

function generatedSameIndependentContentVariant2Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    if (testCase.family !== 'same-independent-content'
      || !testCase.tags.has('same-independent-content-target')) {
      continue;
    }

    const evidence = generatedSameIndependentContentCaseEvidence(testCase);
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, evidence.status);
    cases.push(evidence);
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = cases.length;

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 2 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 2 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 2 target recount should match summary total');

  return {
    target: 'sameIndependentContent',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

function generatedSameIndependentContentVariant3Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    const result = validateGeneratedCase(testCase);
    if (testCase.family !== 'same-independent-content'
      || !testCase.tags.has('same-independent-content-target')
      || result.status !== 'ready'
      || result.applied !== true
      || result.unplannedRemotePreserved !== true) {
      continue;
    }

    const evidence = generatedSameIndependentContentVariant3CaseEvidence(testCase, result);
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, evidence.status);
    cases.push(evidence);
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = cases.length;

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 3 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 3 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 3 target recount should match summary total');

  return {
    target: 'sameIndependentContentVariant3',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

function generatedSameIndependentContentVariant4Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    const result = validateGeneratedCase(testCase);
    if (testCase.family !== 'same-independent-content'
      || !testCase.tags.has('same-independent-content-target')
      || result.status !== 'ready'
      || result.applied !== true
      || result.unplannedRemotePreserved !== true) {
      continue;
    }

    const evidence = generatedSameIndependentContentVariant4CaseEvidence(testCase, result);
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, evidence.status);
    cases.push(evidence);
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = cases.length;

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 4 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 4 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 4 target recount should match summary total');

  return {
    target: 'sameIndependentContentVariant4',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

function generatedSameIndependentContentVariant3CaseEvidence(testCase, result) {
  const shape = assertSameIndependentContentShape(testCase);
  const resource = {
    type: 'row',
    table: 'wp_posts',
    id: shape.rowId,
    key: shape.resourceKey,
  };
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const decision = plan.decisions.find((entry) => entry.resourceKey === shape.resourceKey);
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const plannedMutationKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const unplannedRemote = sameIndependentContentVariant3UnplannedRemoteEvidence({
    testCase,
    appliedSite: applied.site,
    plannedMutationKeys,
  });
  const baseHash = resourceHash(testCase.base, resource);
  const localHash = resourceHash(testCase.local, resource);
  const remoteHash = resourceHash(testCase.remote, resource);
  const appliedHash = resourceHash(applied.site, resource);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.resourceKey);
  const plannedPrecondition = plan.preconditions.some((precondition) => precondition.resourceKey === shape.resourceKey);

  assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
  assert.equal(result.status, 'ready', `${testCase.id} should validate as ready`);
  assert.equal(result.applied, true, `${testCase.id} should apply`);
  assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
  assert.equal(applied.appliedMutations, plan.mutations.length, `${testCase.id} should apply every planned mutation`);
  assert.ok(decision, `${testCase.id} should record an already-in-sync decision for ${shape.resourceKey}`);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'update');
  assert.equal(decision.change.remoteChange, 'update');
  assert.equal(localHash, remoteHash, `${testCase.id} local and remote same-content hashes should match`);
  assert.notEqual(baseHash, localHash, `${testCase.id} same-content row should differ from base`);
  assert.equal(appliedHash, remoteHash, `${testCase.id} apply should not overwrite the same-content remote row`);
  assert.equal(plannedMutation, false, `${testCase.id} should not mutate the already-synchronized row`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition the already-synchronized row`);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    applied: result.applied,
    unplannedRemotePreserved: result.unplannedRemotePreserved,
    planSummary: {
      mutations: plan.summary.mutations,
      decisions: plan.summary.decisions,
      conflicts: plan.summary.conflicts,
      blockers: plan.summary.blockers,
    },
    sameResource: {
      resourceKey: shape.resourceKey,
      baseHash,
      localHash,
      remoteHash,
      appliedHash,
      decision: decision.decision,
      decisionHash: `sha256:${digest(decision)}`,
      plannedMutation,
      plannedPrecondition,
    },
    unplannedRemote,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      resourceKey: shape.resourceKey,
      baseHash,
      localHash,
      remoteHash,
      appliedHash,
      decision: decision.decision,
      plannedMutation,
      plannedPrecondition,
      unplannedRemote,
      planSummary: plan.summary,
    })}`,
  };
}

function generatedSameIndependentContentVariant4CaseEvidence(testCase, result) {
  const shape = assertSameIndependentContentShape(testCase);
  const resource = {
    type: 'row',
    table: 'wp_posts',
    id: shape.rowId,
    key: shape.resourceKey,
  };
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const decision = plan.decisions.find((entry) => entry.resourceKey === shape.resourceKey);
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const plannedMutationKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const unplannedRemote = sameIndependentContentVariant4UnplannedRemoteEvidence({
    testCase,
    appliedSite: applied.site,
    plannedMutationKeys,
  });
  const baseHash = resourceHash(testCase.base, resource);
  const localHash = resourceHash(testCase.local, resource);
  const remoteHash = resourceHash(testCase.remote, resource);
  const appliedHash = resourceHash(applied.site, resource);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.resourceKey);
  const plannedPrecondition = plan.preconditions.some((precondition) => precondition.resourceKey === shape.resourceKey);
  const applyProofHash = `sha256:${digest({
    id: testCase.id,
    appliedMutations: applied.appliedMutations,
    resourceKey: shape.resourceKey,
    remoteHash,
    appliedHash,
    unplannedRemoteProofHash: unplannedRemote.proofHash,
  })}`;

  assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
  assert.equal(result.status, 'ready', `${testCase.id} should validate as ready`);
  assert.equal(result.applied, true, `${testCase.id} should apply`);
  assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
  assert.equal(applied.appliedMutations, plan.mutations.length, `${testCase.id} should apply every planned mutation`);
  assert.ok(decision, `${testCase.id} should record an already-in-sync decision for ${shape.resourceKey}`);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'update');
  assert.equal(decision.change.remoteChange, 'update');
  assert.equal(localHash, remoteHash, `${testCase.id} local and remote same-content hashes should match`);
  assert.notEqual(baseHash, localHash, `${testCase.id} same-content row should differ from base`);
  assert.equal(appliedHash, remoteHash, `${testCase.id} apply should not overwrite the same-content remote row`);
  assert.equal(plannedMutation, false, `${testCase.id} should not mutate the already-synchronized row`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition the already-synchronized row`);
  assert.equal(unplannedRemote.changedResourceCount, 0, `${testCase.id} should not change unplanned remote resources`);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    applied: result.applied,
    unplannedRemotePreserved: result.unplannedRemotePreserved,
    planSummary: {
      mutations: plan.summary.mutations,
      decisions: plan.summary.decisions,
      conflicts: plan.summary.conflicts,
      blockers: plan.summary.blockers,
    },
    sameResource: {
      resourceKey: shape.resourceKey,
      baseHash,
      localHash,
      remoteHash,
      appliedHash,
      decision: decision.decision,
      decisionHash: `sha256:${digest(decision)}`,
      plannedMutation,
      plannedPrecondition,
    },
    apply: {
      appliedMutations: applied.appliedMutations,
      sameResourceSkipped: !plannedMutation && !plannedPrecondition,
      applyProofHash,
    },
    unplannedRemote,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      resourceKey: shape.resourceKey,
      baseHash,
      localHash,
      remoteHash,
      appliedHash,
      decision: decision.decision,
      plannedMutation,
      plannedPrecondition,
      appliedMutations: applied.appliedMutations,
      unplannedRemote,
      planSummary: plan.summary,
    })}`,
  };
}

function sameIndependentContentVariant3UnplannedRemoteEvidence({
  testCase,
  appliedSite,
  plannedMutationKeys,
}) {
  const unplannedProofs = [];

  for (const resource of enumerateResources(testCase.base, testCase.local, testCase.remote, appliedSite)) {
    if (plannedMutationKeys.has(resource.key)) {
      continue;
    }

    const remoteHash = resourceHash(testCase.remote, resource);
    const appliedHash = resourceHash(appliedSite, resource);
    assert.equal(
      appliedHash,
      remoteHash,
      `${testCase.id} changed unplanned remote resource ${resource.key}`,
    );
    unplannedProofs.push({
      resourceKey: resource.key,
      remoteHash,
      appliedHash,
    });
  }

  unplannedProofs.sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));

  return {
    preserved: true,
    plannedMutationCount: plannedMutationKeys.size,
    unplannedResourceCount: unplannedProofs.length,
    proofHash: `sha256:${digest(unplannedProofs)}`,
  };
}

function sameIndependentContentVariant4UnplannedRemoteEvidence({
  testCase,
  appliedSite,
  plannedMutationKeys,
}) {
  return {
    ...sameIndependentContentVariant3UnplannedRemoteEvidence({
      testCase,
      appliedSite,
      plannedMutationKeys,
    }),
    changedResourceCount: 0,
  };
}

function generatedSameIndependentContentCaseEvidence(testCase) {
  const shape = assertSameIndependentContentShape(testCase);
  const resource = {
    type: 'row',
    table: 'wp_posts',
    id: shape.rowId,
    key: shape.resourceKey,
  };
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const result = validateGeneratedCase(testCase);
  const decision = plan.decisions.find((entry) => entry.resourceKey === shape.resourceKey);
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const baseHash = resourceHash(testCase.base, resource);
  const localHash = resourceHash(testCase.local, resource);
  const remoteHash = resourceHash(testCase.remote, resource);
  const appliedHash = resourceHash(applied.site, resource);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.resourceKey);
  const plannedPrecondition = plan.preconditions.some((precondition) => precondition.resourceKey === shape.resourceKey);

  assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
  assert.equal(result.status, 'ready', `${testCase.id} should validate as ready`);
  assert.equal(result.applied, true, `${testCase.id} should apply`);
  assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
  assert.ok(decision, `${testCase.id} should record an already-in-sync decision for ${shape.resourceKey}`);
  assert.equal(decision.decision, 'already-in-sync');
  assert.equal(decision.change.localChange, 'update');
  assert.equal(decision.change.remoteChange, 'update');
  assert.equal(localHash, remoteHash, `${testCase.id} local and remote same-content hashes should match`);
  assert.notEqual(baseHash, localHash, `${testCase.id} same-content row should differ from base`);
  assert.equal(appliedHash, remoteHash, `${testCase.id} apply should not overwrite the same-content remote row`);
  assert.equal(plannedMutation, false, `${testCase.id} should not mutate the already-synchronized row`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition the already-synchronized row`);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    applied: result.applied,
    unplannedRemotePreserved: result.unplannedRemotePreserved,
    tags: [...testCase.tags].sort(),
    planSummary: {
      mutations: plan.summary.mutations,
      decisions: plan.summary.decisions,
      conflicts: plan.summary.conflicts,
      blockers: plan.summary.blockers,
    },
    sameResource: {
      resourceKey: shape.resourceKey,
      baseHash,
      localHash,
      remoteHash,
      appliedHash,
      decision: decision.decision,
      decisionHash: `sha256:${digest(decision)}`,
      plannedMutation,
      plannedPrecondition,
    },
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      resourceKey: shape.resourceKey,
      baseHash,
      localHash,
      remoteHash,
      appliedHash,
      decision: decision.decision,
      plannedMutation,
      plannedPrecondition,
      planSummary: plan.summary,
    })}`,
  };
}

test('RPP-0120 large ready plan tier target exposes deterministic ready coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.largeReadyPlanTier;

  assert.ok(coverage, 'missing large ready plan tier target coverage');
  assert.equal(coverage.family, 'large-ready-plan-tier');
  assert.equal(coverage.total, report.summary.featureFamilies['large-ready-plan-tier']);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.deepEqual(coverage.perTier, {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
  });
  assert.equal(report.summary.featureFamilies['large-ready-plan-target'], 10);

  const cases = generatePushHarnessCases()
    .filter((testCase) => testCase.family === 'large-ready-plan-tier');
  assert.equal(cases.length, 10);

  for (const testCase of cases) {
    assert.ok(testCase.tags.has('large-ready-plan-target'));
    assertLargeReadyPlanShape(testCase);

    const result = validateGeneratedCase(testCase);
    assert.equal(result.status, 'ready');
    assert.ok(result.mutations >= 24 + testCase.tier, `${testCase.id} should have a large ready mutation plan`);
    assert.equal(result.decisions, 2, `${testCase.id} should record remote-preservation decisions`);
    assert.equal(result.applied, true, `${testCase.id} should apply through the harness`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} must preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay must fail before mutation`);
  }
});

test('RPP-0140 large ready plan tier variant 2 proves ready surface and invariant', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.largeReadyPlanTier;

  assert.ok(coverage, 'missing large ready plan tier target coverage');

  const firstEvidence = generatedLargeReadyPlanTierVariant2Evidence(coverage);
  const replayEvidence = generatedLargeReadyPlanTierVariant2Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0140 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'large-ready-plan-tier');
  assert.equal(coverage.total, report.summary.featureFamilies['large-ready-plan-tier']);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 2 large ready evidence changed between runs');
  assert.equal(firstEvidence.target, 'largeReadyPlanTier');
  assert.equal(firstEvidence.family, 'large-ready-plan-tier');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of firstEvidence.cases) {
    const expectedSurface = expectedLargeReadyPlanTierSurfaceCounts(entry.tier);
    const expectedChangeKinds = largeReadyPlanExpectedChangeKinds(expectedSurface);

    assert.equal(entry.status, 'ready', `${entry.id} should remain ready`);
    assert.equal(entry.applied, true, `${entry.id} should apply through the harness`);
    assert.equal(entry.unplannedRemotePreserved, true, `${entry.id} should preserve unplanned remote data`);
    assert.equal(entry.staleReplayRejected, true, `${entry.id} should reject stale replay`);
    assert.equal(entry.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(entry.staleReplayRemoteUnchanged, true, `${entry.id} stale replay should not mutate remote`);
    assert.deepEqual(entry.surfaceCounts, expectedSurface, `${entry.id} surface counts drifted`);
    assert.deepEqual(entry.plannedMutations.changeKinds, expectedChangeKinds, `${entry.id} mutation kinds drifted`);
    assert.equal(entry.plannedMutations.total, entry.planSummary.mutations);
    assert.equal(entry.plannedMutations.preconditions, entry.plannedMutations.total);
    assert.equal(
      entry.plannedMutations.total,
      Object.values(entry.plannedMutations.changeKinds).reduce((sum, count) => sum + count, 0),
    );
    assert.equal(entry.planSummary.decisions, 2, `${entry.id} should record row and file keep-remote decisions`);
    assert.match(entry.plannedMutations.resourceKeySetHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.plannedMutations.preconditionResourceKeySetHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      entry.plannedMutations.resourceKeySetHash,
      entry.plannedMutations.preconditionResourceKeySetHash,
      `${entry.id} precondition surface should match planned mutations`,
    );
    assert.equal(entry.remotePreservation.length, 2, `${entry.id} should preserve one row and one file`);

    for (const remoteEntry of entry.remotePreservation) {
      assert.equal(remoteEntry.decision, 'keep-remote');
      assert.equal(remoteEntry.change.localChange, 'unchanged');
      assert.equal(remoteEntry.change.remoteChange, 'update');
      assert.equal(remoteEntry.localHash, remoteEntry.baseHash);
      assert.equal(remoteEntry.appliedHash, remoteEntry.remoteHash);
      assert.notEqual(remoteEntry.remoteHash, remoteEntry.baseHash);
      assert.equal(remoteEntry.plannedMutation, false);
      assert.equal(remoteEntry.plannedPrecondition, false);
      assert.match(remoteEntry.decisionHash, /^sha256:[a-f0-9]{64}$/);
    }

    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.ok(entry.staleReplay.mutationIndex > 0, `${entry.id} should drift a non-initial mutation`);
    assert.equal(entry.staleReplay.remoteBeforeHash, entry.staleReplay.remoteAfterHash);
    assert.equal(entry.staleReplay.expectedHash, entry.staleReplay.mutationRemoteBeforeHash);
    assert.notEqual(entry.staleReplay.actualHash, entry.staleReplay.expectedHash);
    assert.match(entry.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.plannedValueHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.preconditionHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.modelProofHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated large ready create'), false, 'variant 2 evidence leaked row create title');
  assert.equal(evidenceText.includes('Generated large ready update'), false, 'variant 2 evidence leaked row update title');
  assert.equal(evidenceText.includes('Base large ready delete'), false, 'variant 2 evidence leaked row delete title');
  assert.equal(evidenceText.includes('Remote large ready preserved'), false, 'variant 2 evidence leaked remote row title');
  assert.equal(evidenceText.includes('generated large ready file'), false, 'variant 2 evidence leaked file payload');
  assert.equal(evidenceText.includes('remote large ready preserved file'), false, 'variant 2 evidence leaked remote file payload');
  assert.equal(evidenceText.includes('stale-private-rpp0140'), false, 'variant 2 evidence leaked stale replay payload');
});

test('RPP-0160 large ready plan tier variant 3 records generated coverage surface', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.largeReadyPlanTierVariant3;
  const legacyCoverage = report.summary.targetCoverage.largeReadyPlanTier;

  assert.ok(coverage, 'missing large ready plan tier variant 3 target coverage');
  assert.ok(legacyCoverage, 'missing legacy large ready plan tier target coverage');

  const firstEvidence = generatedLargeReadyPlanTierVariant3Evidence(coverage, legacyCoverage);
  const replayEvidence = generatedLargeReadyPlanTierVariant3Evidence(coverage, legacyCoverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0160 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'large-ready-plan-tier-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['large-ready-plan-v3']);
  assert.equal(coverage.total, 10);
  assert.deepEqual(coverage.statuses, { ready: 10 });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(coverage.perTier, legacyCoverage.perTier);
  assert.deepEqual(coverage.statuses, legacyCoverage.statuses);
  assert.equal(coverage.total, legacyCoverage.total);
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 large ready evidence changed between runs');
  assert.equal(firstEvidence.target, 'largeReadyPlanTierVariant3');
  assert.equal(firstEvidence.family, 'large-ready-plan-tier-variant3');
  assert.equal(firstEvidence.legacyTarget, 'largeReadyPlanTier');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.cases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  for (const entry of firstEvidence.cases) {
    const expectedSurface = expectedLargeReadyPlanTierSurfaceCounts(entry.tier);
    const expectedChangeKinds = largeReadyPlanExpectedChangeKinds(expectedSurface);

    assert.equal(entry.status, 'ready', `${entry.id} should remain ready`);
    assert.equal(entry.applied, true, `${entry.id} should apply through the harness`);
    assert.equal(entry.unplannedRemotePreserved, true, `${entry.id} should preserve unplanned remote data`);
    assert.equal(entry.staleReplayRejected, true, `${entry.id} should reject stale replay`);
    assert.equal(entry.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(entry.staleReplayRemoteUnchanged, true, `${entry.id} stale replay should not mutate remote`);
    assert.ok(entry.tags.includes('large-ready-plan-v3'), `${entry.id} should carry the variant-3 target tag`);
    assert.ok(entry.tags.includes('large-ready-plan-v3-ready'), `${entry.id} should carry the variant-3 ready tag`);
    assert.deepEqual(entry.surfaceCounts, expectedSurface, `${entry.id} surface counts drifted`);
    assert.deepEqual(entry.plannedMutations.changeKinds, expectedChangeKinds, `${entry.id} mutation kinds drifted`);
    assert.equal(entry.plannedMutations.total, entry.planSummary.mutations);
    assert.equal(entry.plannedMutations.preconditions, entry.plannedMutations.total);
    assert.equal(
      entry.plannedMutations.total,
      Object.values(entry.plannedMutations.changeKinds).reduce((sum, count) => sum + count, 0),
    );
    assert.equal(entry.planSummary.decisions, 2, `${entry.id} should record row and file keep-remote decisions`);
    assert.match(entry.plannedMutations.resourceKeySetHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.plannedMutations.preconditionResourceKeySetHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      entry.plannedMutations.resourceKeySetHash,
      entry.plannedMutations.preconditionResourceKeySetHash,
      `${entry.id} precondition surface should match planned mutations`,
    );
    assert.equal(entry.remotePreservation.length, 2, `${entry.id} should preserve one row and one file`);

    for (const remoteEntry of entry.remotePreservation) {
      assert.equal(remoteEntry.decision, 'keep-remote');
      assert.equal(remoteEntry.change.localChange, 'unchanged');
      assert.equal(remoteEntry.change.remoteChange, 'update');
      assert.equal(remoteEntry.localHash, remoteEntry.baseHash);
      assert.equal(remoteEntry.appliedHash, remoteEntry.remoteHash);
      assert.notEqual(remoteEntry.remoteHash, remoteEntry.baseHash);
      assert.equal(remoteEntry.plannedMutation, false);
      assert.equal(remoteEntry.plannedPrecondition, false);
      assert.match(remoteEntry.decisionHash, /^sha256:[a-f0-9]{64}$/);
    }

    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.ok(entry.staleReplay.mutationIndex > 0, `${entry.id} should drift a non-initial mutation`);
    assert.equal(entry.staleReplay.remoteBeforeHash, entry.staleReplay.remoteAfterHash);
    assert.equal(entry.staleReplay.expectedHash, entry.staleReplay.mutationRemoteBeforeHash);
    assert.notEqual(entry.staleReplay.actualHash, entry.staleReplay.expectedHash);
    assert.match(entry.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.plannedValueHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.preconditionHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.modelProofHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated large ready create'), false, 'variant 3 evidence leaked row create title');
  assert.equal(evidenceText.includes('Generated large ready update'), false, 'variant 3 evidence leaked row update title');
  assert.equal(evidenceText.includes('Base large ready delete'), false, 'variant 3 evidence leaked row delete title');
  assert.equal(evidenceText.includes('Remote large ready preserved'), false, 'variant 3 evidence leaked remote row title');
  assert.equal(evidenceText.includes('generated large ready file'), false, 'variant 3 evidence leaked file payload');
  assert.equal(evidenceText.includes('remote large ready preserved file'), false, 'variant 3 evidence leaked remote file payload');
  assert.equal(evidenceText.includes('stale-private-rpp0140'), false, 'variant 3 evidence leaked stale replay payload');
});

function assertLargeReadyPlanShape(testCase) {
  const createRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => !testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated large ready create '));
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated large ready update '));
  const deleteRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([id, row]) => row.post_title.startsWith('Base large ready delete ')
      && !testCase.local.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]);
  const remotePreserveRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([, row]) => row.post_title.startsWith('Base large ready remote preserve '));
  const fileCreates = Object.keys(testCase.local.files)
    .filter((path) => path.includes('/large-ready-create-') && !testCase.base.files[path]);
  const fileUpdates = Object.entries(testCase.local.files)
    .filter(([path, value]) => path.includes('/large-ready-update-')
      && testCase.base.files[path]
      && String(value).startsWith('generated large ready file update '));
  const fileDeletes = Object.keys(testCase.base.files)
    .filter((path) => path.includes('/large-ready-delete-')
      && !testCase.local.files[path]
      && testCase.remote.files[path]);
  const remotePreserveFiles = Object.keys(testCase.base.files)
    .filter((path) => path.includes('/large-ready-remote-preserve-'));
  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([id, row]) => !testCase.base.db.wp_terms[id]
      && row.name.startsWith('Generated term '));
  const taxonomyRows = Object.keys(testCase.local.db.wp_term_taxonomy)
    .filter((id) => !testCase.base.db.wp_term_taxonomy[id]);
  const relationshipRows = Object.keys(testCase.local.db.wp_term_relationships)
    .filter((id) => !testCase.base.db.wp_term_relationships[id]);
  const commentRows = Object.keys(testCase.local.db.wp_comments)
    .filter((id) => !testCase.base.db.wp_comments[id]);

  assert.ok(createRows.length >= 4, `${testCase.id} should create multiple post rows`);
  assert.ok(updateRows.length >= 4, `${testCase.id} should update multiple post rows`);
  assert.ok(deleteRows.length >= 3, `${testCase.id} should delete multiple post rows`);
  assert.ok(fileCreates.length >= 3, `${testCase.id} should create multiple files`);
  assert.ok(fileUpdates.length >= 3, `${testCase.id} should update multiple files`);
  assert.ok(fileDeletes.length >= 2, `${testCase.id} should delete multiple files`);
  assert.equal(remotePreserveRows.length, 1, `${testCase.id} should include one remote-only row`);
  assert.equal(remotePreserveFiles.length, 1, `${testCase.id} should include one remote-only file`);
  assert.deepEqual(
    testCase.local.db.wp_posts[remotePreserveRows[0][0]],
    testCase.base.db.wp_posts[remotePreserveRows[0][0]],
    `${testCase.id} remote-only row should be unchanged locally`,
  );
  assert.notDeepEqual(
    testCase.remote.db.wp_posts[remotePreserveRows[0][0]],
    testCase.base.db.wp_posts[remotePreserveRows[0][0]],
    `${testCase.id} remote-only row should drift remotely`,
  );
  assert.equal(
    testCase.local.files[remotePreserveFiles[0]],
    testCase.base.files[remotePreserveFiles[0]],
    `${testCase.id} remote-only file should be unchanged locally`,
  );
  assert.notEqual(
    testCase.remote.files[remotePreserveFiles[0]],
    testCase.base.files[remotePreserveFiles[0]],
    `${testCase.id} remote-only file should drift remotely`,
  );
  assert.equal(termRows.length, 1, `${testCase.id} should include one same-plan taxonomy term row`);
  assert.ok(taxonomyRows.length >= 1, `${testCase.id} should include same-plan taxonomy graph rows`);
  assert.equal(relationshipRows.length, 1, `${testCase.id} should include one same-plan taxonomy relationship row`);
  assert.ok(commentRows.length >= 2, `${testCase.id} should include same-plan comment graph rows`);

  return {
    postCreateRows: createRows.map(([id]) => id).sort(),
    postUpdateRows: updateRows.map(([id]) => id).sort(),
    postDeleteRows: deleteRows.map(([id]) => id).sort(),
    fileCreates: fileCreates.sort(),
    fileUpdates: fileUpdates.map(([path]) => path).sort(),
    fileDeletes: fileDeletes.sort(),
    remotePreserveRows: remotePreserveRows.map(([id]) => id).sort(),
    remotePreserveFiles: remotePreserveFiles.sort(),
    termRows: termRows.map(([id]) => id).sort(),
    taxonomyRows: taxonomyRows.sort(),
    relationshipRows: relationshipRows.sort(),
    commentRows: commentRows.sort(),
  };
}

function generatedLargeReadyPlanTierVariant2Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    if (testCase.family !== 'large-ready-plan-tier'
      || !testCase.tags.has('large-ready-plan-target')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    cases.push(generatedLargeReadyPlanTierCaseEvidence(testCase, result));
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = cases.length;

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 2 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 2 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 2 target recount should match summary total');

  return {
    target: 'largeReadyPlanTier',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

function generatedLargeReadyPlanTierVariant3Evidence(targetCoverage, legacyCoverage) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    if (testCase.family !== 'large-ready-plan-tier'
      || !testCase.tags.has('large-ready-plan-v3')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    cases.push(generatedLargeReadyPlanTierCaseEvidence(testCase, result));
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = cases.length;

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 3 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 3 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 3 target recount should match summary total');
  assert.deepEqual(sortedPerTier, legacyCoverage.perTier, 'variant 3 target tiers should match legacy large-ready target');
  assert.deepEqual(sortedStatuses, legacyCoverage.statuses, 'variant 3 target statuses should match legacy large-ready target');
  assert.equal(totalCases, legacyCoverage.total, 'variant 3 target total should match legacy large-ready target');

  return {
    target: 'largeReadyPlanTierVariant3',
    legacyTarget: 'largeReadyPlanTier',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

function generatedLargeReadyPlanTierCaseEvidence(testCase, result) {
  const shape = assertLargeReadyPlanShape(testCase);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const surfaceCounts = largeReadyPlanSurfaceCounts(shape);
  const plannedResourceKeys = largeReadyPlanPlannedResourceKeys(shape);
  const mutationResourceKeys = plan.mutations.map((mutation) => mutation.resourceKey).sort();
  const preconditionResourceKeys = plan.preconditions.map((precondition) => precondition.resourceKey).sort();
  const changeKinds = sortStringObject(plan.mutations.reduce((counts, mutation) => {
    incrementCount(counts, mutation.changeKind);
    return counts;
  }, {}));

  assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
  assert.equal(result.status, 'ready', `${testCase.id} should validate as ready`);
  assert.equal(result.applied, true, `${testCase.id} should apply`);
  assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
  assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);
  assert.deepEqual(
    surfaceCounts,
    expectedLargeReadyPlanTierSurfaceCounts(testCase.tier),
    `${testCase.id} large ready surface counts changed`,
  );
  assert.deepEqual(
    mutationResourceKeys,
    plannedResourceKeys,
    `${testCase.id} mutations should match the generated large-ready surface exactly`,
  );
  assert.deepEqual(
    preconditionResourceKeys,
    plannedResourceKeys,
    `${testCase.id} preconditions should match the generated large-ready surface exactly`,
  );
  assert.deepEqual(
    changeKinds,
    largeReadyPlanExpectedChangeKinds(surfaceCounts),
    `${testCase.id} mutation change-kind counts changed`,
  );
  assert.equal(plan.summary.mutations, plannedResourceKeys.length);
  assert.equal(plan.summary.decisions, 2);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.summary.blockers, 0);

  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(applied.site, mutation.resource),
      resourceHash(testCase.local, mutation.resource),
      `${testCase.id} did not apply the planned local value for ${mutation.resourceKey}`,
    );
  }

  const remotePreservation = largeReadyPlanRemotePreservationEvidence({
    shape,
    plan,
    testCase,
    applied,
  });
  const staleReplay = largeReadyPlanStaleReplayEvidence(testCase, plan);
  const plannedMutations = {
    total: plan.mutations.length,
    preconditions: plan.preconditions.length,
    changeKinds,
    resourceKeySetHash: `sha256:${digest(mutationResourceKeys)}`,
    preconditionResourceKeySetHash: `sha256:${digest(preconditionResourceKeys)}`,
  };

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    applied: result.applied,
    unplannedRemotePreserved: result.unplannedRemotePreserved,
    staleReplayRejected: result.staleReplayRejected,
    staleReplayRejectionCode: result.staleReplayRejectionCode,
    staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
    surfaceCounts,
    plannedMutations,
    remotePreservation,
    staleReplay,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      tier: testCase.tier,
      surfaceCounts,
      plannedMutations,
      remotePreservation,
      staleReplay,
      planSummary: plan.summary,
    })}`,
  };
}

function largeReadyPlanSurfaceCounts(shape) {
  return {
    postCreates: shape.postCreateRows.length,
    postUpdates: shape.postUpdateRows.length,
    postDeletes: shape.postDeleteRows.length,
    fileCreates: shape.fileCreates.length,
    fileUpdates: shape.fileUpdates.length,
    fileDeletes: shape.fileDeletes.length,
    taxonomyTermCreates: shape.termRows.length,
    taxonomyTermTaxonomyCreates: shape.taxonomyRows.length,
    taxonomyRelationshipCreates: shape.relationshipRows.length,
    commentCreates: shape.commentRows.length,
    remoteOnlyRows: shape.remotePreserveRows.length,
    remoteOnlyFiles: shape.remotePreserveFiles.length,
  };
}

function expectedLargeReadyPlanTierSurfaceCounts(tier) {
  return {
    postCreates: 4 + Math.floor(tier / 2),
    postUpdates: 4 + tier,
    postDeletes: 3 + Math.floor(tier / 3),
    fileCreates: 3 + Math.floor(tier / 4),
    fileUpdates: 3 + Math.floor(tier / 3),
    fileDeletes: 2 + Math.floor(tier / 5),
    taxonomyTermCreates: 1,
    taxonomyTermTaxonomyCreates: 1,
    taxonomyRelationshipCreates: 1,
    commentCreates: 2,
    remoteOnlyRows: 1,
    remoteOnlyFiles: 1,
  };
}

function largeReadyPlanExpectedChangeKinds(surfaceCounts) {
  return sortStringObject({
    create: surfaceCounts.postCreates
      + surfaceCounts.fileCreates
      + surfaceCounts.taxonomyTermCreates
      + surfaceCounts.taxonomyTermTaxonomyCreates
      + surfaceCounts.taxonomyRelationshipCreates
      + surfaceCounts.commentCreates,
    delete: surfaceCounts.postDeletes + surfaceCounts.fileDeletes,
    update: surfaceCounts.postUpdates + surfaceCounts.fileUpdates,
  });
}

function largeReadyPlanPlannedResourceKeys(shape) {
  return [
    ...shape.postCreateRows.map((id) => generatedRowResourceKey('wp_posts', id)),
    ...shape.postUpdateRows.map((id) => generatedRowResourceKey('wp_posts', id)),
    ...shape.postDeleteRows.map((id) => generatedRowResourceKey('wp_posts', id)),
    ...shape.termRows.map((id) => generatedRowResourceKey('wp_terms', id)),
    ...shape.taxonomyRows.map((id) => generatedRowResourceKey('wp_term_taxonomy', id)),
    ...shape.relationshipRows.map((id) => generatedRowResourceKey('wp_term_relationships', id)),
    ...shape.commentRows.map((id) => generatedRowResourceKey('wp_comments', id)),
    ...shape.fileCreates.map((path) => `file:${path}`),
    ...shape.fileUpdates.map((path) => `file:${path}`),
    ...shape.fileDeletes.map((path) => `file:${path}`),
  ].sort();
}

function largeReadyPlanRemotePreservationEvidence({ shape, plan, testCase, applied }) {
  const mutationResourceKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const preconditionResourceKeys = new Set(plan.preconditions.map((precondition) => precondition.resourceKey));
  const resources = [
    ...shape.remotePreserveRows.map((id) => ({
      resource: { type: 'row', table: 'wp_posts', id },
      resourceKey: generatedRowResourceKey('wp_posts', id),
    })),
    ...shape.remotePreserveFiles.map((path) => ({
      resource: { type: 'file', path },
      resourceKey: `file:${path}`,
    })),
  ].sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));

  return resources.map(({ resource, resourceKey }) => {
    const decision = plan.decisions.find((entry) => entry.resourceKey === resourceKey);
    assert.ok(decision, `${testCase.id} should record a keep-remote decision for ${resourceKey}`);
    assert.equal(decision.decision, 'keep-remote');
    assert.equal(decision.change.localChange, 'unchanged');
    assert.equal(decision.change.remoteChange, 'update');
    assert.equal(mutationResourceKeys.has(resourceKey), false, `${testCase.id} should not mutate ${resourceKey}`);
    assert.equal(preconditionResourceKeys.has(resourceKey), false, `${testCase.id} should not precondition ${resourceKey}`);

    const baseHash = resourceHash(testCase.base, resource);
    const localHash = resourceHash(testCase.local, resource);
    const remoteHash = resourceHash(testCase.remote, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.equal(localHash, baseHash, `${testCase.id} local should leave ${resourceKey} unchanged`);
    assert.notEqual(remoteHash, baseHash, `${testCase.id} remote should drift ${resourceKey}`);
    assert.equal(appliedHash, remoteHash, `${testCase.id} apply should preserve remote drift for ${resourceKey}`);

    return {
      resourceKey,
      resourceType: resource.type,
      decision: decision.decision,
      change: decision.change,
      baseHash,
      localHash,
      remoteHash,
      appliedHash,
      plannedMutation: false,
      plannedPrecondition: false,
      decisionHash: `sha256:${digest(decision)}`,
    };
  });
}

function largeReadyPlanStaleReplayEvidence(testCase, plan) {
  const mutationIndex = Math.floor(plan.mutations.length / 2);
  const mutation = plan.mutations[mutationIndex];
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
  const staleRemote = cloneJson(testCase.remote);
  const stalePayload = `stale-private-rpp0140-${testCase.tier}-${mutation?.id}`;
  const plannedValue = deserializeResourceValue(mutation?.value);

  assert.ok(mutation, `${testCase.id} should have a mutation to drift for stale replay`);
  assert.ok(mutationIndex > 0, `${testCase.id} should drift a non-initial mutation`);
  assert.ok(precondition, `${testCase.id} should have a live-remote precondition for ${mutation.resourceKey}`);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(resourceHash(staleRemote, mutation.resource), precondition.expectedHash);

  setResource(
    staleRemote,
    mutation.resource,
    rpp0140LargeReadyPlanStaleValue(mutation.resource, getResource(staleRemote, mutation.resource), stalePayload),
  );
  const staleResourceHash = resourceHash(staleRemote, mutation.resource);
  const remoteBeforeHash = digest(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, plan));
  const remoteAfterHash = digest(staleRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, mutation.resourceKey);
  assert.equal(error.details.expectedHash, precondition.expectedHash);
  assert.equal(error.details.actualHash, staleResourceHash);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale replay mutated remote before refusal`);

  return {
    mutationId: mutation.id,
    mutationIndex,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    code: error.code,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    mutationRemoteBeforeHash: mutation.remoteBeforeHash,
    plannedValueHash: `sha256:${digest(plannedValue)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function rpp0140LargeReadyPlanStaleValue(resource, currentValue, stalePayload) {
  if (resource.type === 'file') {
    return { type: 'file', content: stalePayload };
  }

  if (currentValue && currentValue !== ABSENT && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    return {
      ...currentValue,
      __rpp0140LargeReadyPlanStaleReplay: stalePayload,
    };
  }

  return {
    value: currentValue === ABSENT ? 'absent-before-large-ready-replay' : currentValue,
    __rpp0140LargeReadyPlanStaleReplay: stalePayload,
  };
}


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

test('RPP-0417 generated driver dry-run validation hook covers supported and unsupported variants', () => {
  const cases = generateDriverDryRunValidationHookCases();

  assert.deepEqual(cases.map((testCase) => testCase.variant), [
    'supported-dry-run-hook-applies',
    'unsupported-dry-run-hook-blocked',
  ]);
  assert.equal(cases.every((testCase) => testCase.tags.has('driver-dry-run-validation-hook')), true);
  assert.equal(cases.every((testCase) => testCase.dataResourceKey.startsWith('row:["wp_options"')), true);

  const results = cases.map(validateDriverDryRunValidationHookCase);
  const outcomes = Object.fromEntries(results.map((result) => [result.variant, result.outcome]));
  assert.deepEqual(outcomes, {
    'supported-dry-run-hook-applies': 'applied-supported-hook',
    'unsupported-dry-run-hook-blocked': 'blocked-unsupported-hook',
  });

  const byVariant = Object.fromEntries(results.map((result) => [result.variant, result]));
  assert.equal(byVariant['supported-dry-run-hook-applies'].status, 'ready');
  assert.equal(byVariant['supported-dry-run-hook-applies'].appliedMutations, 1);
  assert.equal(byVariant['unsupported-dry-run-hook-blocked'].status, 'blocked');
  assert.equal(byVariant['unsupported-dry-run-hook-blocked'].mutations, 0);
  assert.equal(byVariant['unsupported-dry-run-hook-blocked'].remotePreserved, true);
  for (const result of results) {
    assert.equal(result.evidenceScope, 'local-generated');
    assert.equal(result.productionBacked, false);
    assert.equal(result.releaseGate, 'NO-GO');
    assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  }
});

test('RPP-0442 generated driver owner identity binding variant 3 covers supported and unsupported variants', () => {
  const cases = generateDriverOwnerIdentityBindingCases();

  assert.deepEqual(cases.map((testCase) => testCase.variant), [
    'supported-exact-owner-policy',
    'unsupported-wrong-policy-owner',
    'unsupported-missing-owner-policy',
    'unsupported-local-owner-drift',
    'unsupported-stale-owner-context',
  ]);
  assert.equal(cases.every((testCase) => testCase.family === 'driver-owner-identity-binding'), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('driver-owner-identity-binding')), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('plugin-owned-generated')), true);
  assert.equal(cases.filter((testCase) => testCase.tags.has('driver-owner-identity-supported')).length, 1);
  assert.equal(cases.filter((testCase) => testCase.tags.has('driver-owner-identity-unsupported')).length, 4);
  assert.equal(cases.every((testCase) => testCase.resourceKey.startsWith('row:[\"wp_options\"')), true);

  const results = cases.map(validateDriverOwnerIdentityBindingCase);
  const outcomes = Object.fromEntries(results.map((result) => [result.variant, result.outcome]));
  assert.deepEqual(outcomes, {
    'supported-exact-owner-policy': 'ready',
    'unsupported-wrong-policy-owner': 'planner-blocked',
    'unsupported-missing-owner-policy': 'planner-blocked',
    'unsupported-local-owner-drift': 'apply-refused',
    'unsupported-stale-owner-context': 'planner-blocked',
  });

  const byVariant = Object.fromEntries(results.map((result) => [result.variant, result]));
  assert.equal(byVariant['supported-exact-owner-policy'].status, 'ready');
  assert.equal(byVariant['supported-exact-owner-policy'].mutations, 1);
  assert.equal(byVariant['supported-exact-owner-policy'].blockers, 0);
  assert.equal(byVariant['supported-exact-owner-policy'].applied, true);
  assert.equal(byVariant['unsupported-wrong-policy-owner'].status, 'blocked');
  assert.equal(byVariant['unsupported-wrong-policy-owner'].mutations, 0);
  assert.equal(byVariant['unsupported-wrong-policy-owner'].remotePreserved, true);
  assert.equal(byVariant['unsupported-missing-owner-policy'].status, 'blocked');
  assert.equal(byVariant['unsupported-missing-owner-policy'].mutations, 0);
  assert.equal(byVariant['unsupported-missing-owner-policy'].remotePreserved, true);
  assert.equal(byVariant['unsupported-local-owner-drift'].status, 'ready');
  assert.equal(byVariant['unsupported-local-owner-drift'].mutations, 1);
  assert.equal(byVariant['unsupported-local-owner-drift'].remotePreserved, true);
  assert.equal(byVariant['unsupported-stale-owner-context'].status, 'blocked');
  assert.equal(byVariant['unsupported-stale-owner-context'].mutations, 0);
  assert.equal(byVariant['unsupported-stale-owner-context'].remotePreserved, true);

  for (const result of results) {
    assert.equal(result.evidenceScope, 'local-generated');
    assert.equal(result.productionBacked, false);
    assert.equal(result.releaseGate, 'NO-GO');
    assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  }

  const evidenceEnvelope = {
    rpp: 'RPP-0442',
    evidenceScope: 'local-generated',
    productionBacked: false,
    releaseGate: 'NO-GO',
    supportedVariants: results.filter((result) => result.outcome === 'ready').length,
    unsupportedVariants: results.filter((result) => result.outcome !== 'ready').length,
    outcomes,
    resultHash: `sha256:${digest(results)}`,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(evidenceEnvelope.supportedVariants, 1);
  assert.equal(evidenceEnvelope.unsupportedVariants, 4);
  assert.match(evidenceEnvelope.resultHash, /^sha256:[a-f0-9]{64}$/);
  for (const testCase of cases) {
    for (const token of testCase.secretTokens) {
      assert.equal(evidenceText.includes(token), false, `${testCase.variant} leaked generated private marker ${token}`);
    }
  }
});

function assertNoRawRpp0445WpPostmetaEvidence(cases, proof) {
  const proofJson = JSON.stringify(proof);
  const privateMarkers = cases.flatMap((testCase) => testCase.secretTokens || []);
  assert.ok(privateMarkers.length > 0, 'RPP-0445 generated cases must carry private markers');
  for (const marker of privateMarkers) {
    assert.equal(proofJson.includes(marker), false, `RPP-0445 proof leaked raw marker ${marker}`);
  }
  assert.equal(proofJson.includes('meta_value'), false, 'RPP-0445 proof exposed raw meta_value fields');
  assert.equal(proofJson.includes('metaValue'), false, 'RPP-0445 proof exposed raw metaValue fields');
}

test('RPP-0445 generated wp_postmeta driver semantics variant 3 labels release-gate evidence scope', () => {
  const cases = generateWpPostmetaDriverSemanticsVariant3Cases();

  assert.deepEqual(cases.map((testCase) => testCase.variant), [
    'local-post-id-meta-key-applies',
    'production-scoped-meta-id-applies',
    'mismatched-post-id-meta-key-blocked',
  ]);
  assert.equal(cases.every((testCase) => testCase.family === 'wp-postmeta-driver-semantics-v3'), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('wp-postmeta-driver-semantics-v3')), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('plugin-owned-generated')), true);
  assert.equal(cases.every((testCase) => testCase.dataResourceKey.startsWith('row:["wp_postmeta"')), true);

  const results = cases.map(validateWpPostmetaDriverSemanticsVariant3Case);
  const outcomes = Object.fromEntries(results.map((result) => [result.variant, result.outcome]));
  const byVariant = Object.fromEntries(results.map((result) => [result.variant, result]));
  const proof = {
    rpp: 'RPP-0445',
    evidenceSource: 'generated-push-harness-wp-postmeta-driver-semantics-v3',
    evidenceScope: 'local-generated-focused',
    productionBacked: false,
    finalReleaseGate: {
      status: 'NO-GO',
      note: 'Final release remains NO-GO; generated wp_postmeta evidence records local/support-only and production-backed scope labels separately.',
    },
    variants: results.map((result) => ({
      variant: result.variant,
      status: result.status,
      outcome: result.outcome,
      driver: result.driver,
      policySource: result.policySource,
      rowIdKind: result.rowIdKind,
      releaseGateEvidenceScope: result.releaseGateEvidenceScope,
      releaseGate: result.releaseGate,
      applied: result.applied,
      appliedMutations: result.appliedMutations || 0,
      remotePreserved: result.remotePreserved === true,
      driverEvidenceHash: result.driverEvidenceHash,
      auditEvidenceHash: result.auditEvidenceHash || null,
      blockerHash: result.blockerHash || null,
      proofHash: result.proofHash,
    })),
    resultHash: `sha256:${digest(results)}`,
  };

  assert.deepEqual(outcomes, {
    'local-post-id-meta-key-applies': 'applied-supported-driver',
    'production-scoped-meta-id-applies': 'applied-supported-driver',
    'mismatched-post-id-meta-key-blocked': 'blocked-mismatched-row',
  });

  assert.equal(byVariant['local-post-id-meta-key-applies'].status, 'ready');
  assert.equal(byVariant['local-post-id-meta-key-applies'].rowIdKind, 'post_id_meta_key');
  assert.equal(byVariant['local-post-id-meta-key-applies'].releaseGateEvidenceScope, 'local-candidate');
  assert.match(byVariant['local-post-id-meta-key-applies'].releaseGate.note, /local\/support-only/);
  assert.match(
    byVariant['local-post-id-meta-key-applies'].releaseGate.note,
    /production-backed release gate evidence is still required/,
  );

  assert.equal(byVariant['production-scoped-meta-id-applies'].status, 'ready');
  assert.equal(byVariant['production-scoped-meta-id-applies'].rowIdKind, 'meta_id');
  assert.equal(byVariant['production-scoped-meta-id-applies'].policySource, 'remote-snapshot');
  assert.equal(byVariant['production-scoped-meta-id-applies'].releaseGateEvidenceScope, 'production-backed');
  assert.match(byVariant['production-scoped-meta-id-applies'].releaseGate.note, /production-backed scope/);
  assert.match(byVariant['production-scoped-meta-id-applies'].releaseGate.note, /final release remains NO-GO/);

  assert.equal(byVariant['mismatched-post-id-meta-key-blocked'].status, 'blocked');
  assert.equal(byVariant['mismatched-post-id-meta-key-blocked'].applied, false);
  assert.equal(byVariant['mismatched-post-id-meta-key-blocked'].remotePreserved, true);
  assert.equal(byVariant['mismatched-post-id-meta-key-blocked'].releaseGateEvidenceScope, 'local-candidate');

  for (const result of results) {
    assert.equal(result.productionBacked, false);
    assert.equal(result.releaseGate.status, 'NO-GO');
    assert.equal(result.releaseGate.acceptedForReleaseGate, false);
    assert.equal(result.rawValuesIncluded, false);
    assert.match(result.driverEvidenceHash, /^[a-f0-9]{64}$/);
    assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  }
  assert.match(proof.resultHash, /^sha256:[a-f0-9]{64}$/);
  assertNoRawRpp0445WpPostmetaEvidence(cases, proof);
});

test('RPP-0456 generated driver delete support flag coverage is redacted', () => {
  const cases = generateDriverDeleteSupportFlagCases();

  assert.deepEqual(cases.map((testCase) => testCase.variant), [
    'delete-supported-applies',
    'delete-unsupported-blocked',
    'forged-delete-support-flag-rejected',
  ]);
  assert.equal(cases.every((testCase) => testCase.tags.has('driver-delete-support-flag')), true);
  assert.equal(cases.every((testCase) => testCase.dataResourceKey.startsWith('row:["wp_options"')), true);

  const results = cases.map(validateDriverDeleteSupportFlagCase);
  const outcomes = Object.fromEntries(results.map((result) => [result.variant, result.outcome]));
  assert.deepEqual(outcomes, {
    'delete-supported-applies': 'applied-delete',
    'delete-unsupported-blocked': 'blocked-unsupported-delete',
    'forged-delete-support-flag-rejected': 'rejected-forged-unsupported-delete',
  });

  const byVariant = Object.fromEntries(results.map((result) => [result.variant, result]));
  assert.equal(byVariant['delete-supported-applies'].status, 'ready');
  assert.equal(byVariant['delete-supported-applies'].appliedMutations, 1);
  assert.equal(byVariant['delete-unsupported-blocked'].status, 'blocked');
  assert.equal(byVariant['delete-unsupported-blocked'].mutations, 0);
  assert.equal(byVariant['delete-unsupported-blocked'].remotePreserved, true);
  assert.equal(
    byVariant['forged-delete-support-flag-rejected'].rejectionCode,
    'UNSUPPORTED_PLUGIN_OWNED_RESOURCE',
  );
  for (const result of results) {
    assert.equal(result.evidenceScope, 'local-generated');
    assert.equal(result.productionBacked, false);
    assert.equal(result.releaseGate, 'NO-GO');
    assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  }
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

test('RPP-0116 atomic plugin install stack variant 1 emits ready and non-ready generated model evidence', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.atomicPluginInstallStackV1;
  const firstEvidence = generatedAtomicPluginInstallStackV1Evidence();
  const replayEvidence = generatedAtomicPluginInstallStackV1Evidence();
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0116 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.ok(coverage, 'missing atomic plugin install stack variant 1 target coverage');
  assert.equal(coverage.family, 'atomic-plugin-stack-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['atomic-plugin-install-stack-v1']);
  assert.ok(coverage.statuses.ready > 0, 'variant 1 target should include ready atomic plugin stack cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 1 target should include non-ready atomic plugin stack cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 1 generated model evidence changed between runs');
  assert.equal(firstEvidence.target, 'atomicPluginInstallStackV1');
  assert.equal(firstEvidence.totalCases, 2);
  assert.equal(firstEvidence.readyCases, 1);
  assert.equal(firstEvidence.nonReadyCases, 1);

  const readyCase = firstEvidence.cases.find((entry) => entry.status === 'ready');
  const nonReadyCase = firstEvidence.cases.find((entry) => entry.status !== 'ready');

  assert.ok(readyCase, 'variant 1 evidence must include a ready case');
  assert.ok(nonReadyCase, 'variant 1 evidence must include a non-ready case');
  assert.equal(readyCase.atomicGroup.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.atomicGroup.dependencySources[0], 'same-atomic-group');
  assert.ok(
    readyCase.atomicGroup.mutationResourceKeys.includes(pluginResourceKey(atomicDependencyPlugin)),
    'ready variant 1 case should install dependency plugin metadata inside the same atomic group',
  );
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.atomicGroup.status, 'blocked');
  assert.ok(
    nonReadyCase.atomicGroup.blockers.some((blocker) =>
      blocker.class === 'missing-plugin-dependency'
        && blocker.plugin === atomicDependencyPlugin),
    'non-ready variant 1 case should expose missing dependency evidence',
  );
  assert.ok(
    nonReadyCase.atomicGroup.blockers.some((blocker) =>
      blocker.class === 'atomic-group-blocker-propagation'
        && blocker.resourceKey === pluginResourceKey(atomicDependentPlugin)),
    'non-ready variant 1 case should propagate the atomic blocker to grouped plugin metadata',
  );
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('private-atomic-plugin-install-stack-v3'), false);
  assert.equal(evidenceText.includes('<?php'), false);
  assert.equal(evidenceText.includes('generated dependency'), false);
  assert.equal(evidenceText.includes('generated dependent'), false);
});

test('RPP-0136 atomic plugin install stack variant 2 emits ready and non-ready generated model evidence', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.atomicPluginInstallStackV2;
  const firstEvidence = generatedAtomicPluginInstallStackV2Evidence();
  const replayEvidence = generatedAtomicPluginInstallStackV2Evidence();
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0136 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.ok(coverage, 'missing atomic plugin install stack variant 2 target coverage');
  assert.equal(coverage.family, 'atomic-plugin-stack-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['atomic-plugin-install-stack-v2']);
  assert.ok(coverage.statuses.ready > 0, 'variant 2 target should include ready atomic plugin stack cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 2 target should include non-ready atomic plugin stack cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 2 generated model evidence changed between runs');
  assert.equal(firstEvidence.target, 'atomicPluginInstallStackV2');
  assert.equal(firstEvidence.totalCases, 2);
  assert.equal(firstEvidence.readyCases, 1);
  assert.equal(firstEvidence.nonReadyCases, 1);

  const variantCases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('atomic-plugin-install-stack-v2'));
  assert.equal(variantCases.length, coverage.total);
  assert.ok(
    variantCases.some((testCase) =>
      testCase.family === 'atomic-plugin-stack-ready'
        && testCase.tags.has('atomic-plugin-stack-ready-v2')),
    'variant 2 tag set should include a ready generated case',
  );
  assert.ok(
    variantCases.some((testCase) =>
      testCase.family === 'atomic-plugin-missing-dependency'
        && testCase.tags.has('atomic-plugin-stack-missing-dependency-v2')),
    'variant 2 tag set should include a non-ready generated case',
  );

  const readyCase = firstEvidence.cases.find((entry) => entry.status === 'ready');
  const nonReadyCase = firstEvidence.cases.find((entry) => entry.status !== 'ready');

  assert.ok(readyCase, 'variant 2 evidence must include a ready case');
  assert.ok(nonReadyCase, 'variant 2 evidence must include a non-ready case');
  assert.equal(readyCase.atomicGroup.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.atomicGroup.dependencySources[0], 'same-atomic-group');
  assert.ok(
    readyCase.atomicGroup.mutationResourceKeys.includes(fileResourceKey(atomicDependencyPluginFile)),
    'ready variant 2 case should install the dependency plugin file inside the atomic group',
  );
  assert.ok(
    readyCase.atomicGroup.mutationResourceKeys.includes(pluginResourceKey(atomicDependencyPlugin)),
    'ready variant 2 case should install dependency plugin metadata inside the atomic group',
  );
  assert.ok(
    readyCase.atomicGroup.resources.includes(rowResourceKey('wp_options', atomicFixtureOptionRowId)),
    'ready variant 2 case should keep plugin-owned option data inside the atomic group',
  );
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.atomicGroup.status, 'blocked');
  assert.equal(
    nonReadyCase.atomicGroup.mutationResourceKeys.includes(pluginResourceKey(atomicDependencyPlugin)),
    false,
    'non-ready variant 2 case must not synthesize dependency plugin metadata outside the local intent',
  );
  assert.ok(
    nonReadyCase.atomicGroup.blockers.some((blocker) =>
      blocker.class === 'missing-plugin-dependency'
        && blocker.plugin === atomicDependencyPlugin),
    'non-ready variant 2 case should expose missing dependency evidence',
  );
  assert.ok(
    nonReadyCase.atomicGroup.blockers.some((blocker) =>
      blocker.class === 'atomic-group-blocker-propagation'
        && blocker.resourceKey === pluginResourceKey(atomicDependentPlugin)),
    'non-ready variant 2 case should propagate the atomic blocker to grouped plugin metadata',
  );
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('private-atomic-plugin-install-stack-v3'), false);
  assert.equal(evidenceText.includes('<?php'), false);
  assert.equal(evidenceText.includes('generated dependency'), false);
  assert.equal(evidenceText.includes('generated dependent'), false);
});

test('RPP-0156 atomic plugin install stack target emits ready and non-ready redacted coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.atomicPluginInstallStack;

  assert.ok(coverage, 'missing atomic plugin install stack target coverage');
  assert.equal(coverage.family, 'atomic-plugin-stack-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['atomic-plugin-install-stack-v3']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready atomic plugin stack cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready atomic plugin stack cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.match(`sha256:${digest(coverage)}`, /^sha256:[a-f0-9]{64}$/);

  const cases = generatePushHarnessCases();
  const targetCases = cases.filter((testCase) => testCase.tags.has('atomic-plugin-install-stack-v3'));
  const readyCases = targetCases.filter((testCase) => testCase.family === 'atomic-plugin-stack-ready');
  const missingDependencyCases = targetCases.filter((testCase) => testCase.family === 'atomic-plugin-missing-dependency');

  assert.equal(readyCases.length, 10, 'expected one ready atomic plugin stack case per tier');
  assert.equal(missingDependencyCases.length, 10, 'expected one missing-dependency atomic plugin case per tier');

  for (const testCase of readyCases) {
    const shape = assertAtomicPluginStackShape(testCase, { missingDependency: false });
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(testCase);
    const group = plan.atomicGroups.find((candidate) => candidate.id === shape.intent.id);
    const groupResourceKeys = new Set(group.resources);
    const groupMutations = plan.mutations.filter((mutation) => mutation.atomicGroupId === group.id);
    const dependencyPluginMutation = groupMutations.find((mutation) =>
      mutation.resourceKey === pluginResourceKey(atomicDependencyPlugin));

    assert.equal(plan.status, 'ready', `${testCase.id} atomic plugin stack should be ready`);
    assert.equal(result.status, 'ready', `${testCase.id} should validate as ready`);
    assert.equal(result.applied, true, `${testCase.id} ready atomic stack should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} stale replay should reject`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay must fail before mutation`);
    assert.equal(group.status, 'ready');
    assert.equal(group.requireAtomic, true);
    assert.equal(group.blockers.length, 0);
    assert.equal(group.conflicts.length, 0);
    assert.equal(group.dependencyRequirements[0].source, 'same-atomic-group');
    assert.equal(group.dependencyRequirements[0].resourceKey, pluginResourceKey(atomicDependencyPlugin));
    assert.match(group.dependencyRequirements[0].expectedHash, /^[a-f0-9]{64}$/);
    assert.ok(dependencyPluginMutation, `${testCase.id} should plan dependency plugin install in same group`);
    assert.equal(group.dependencyRequirements[0].mutationId, dependencyPluginMutation.id);

    for (const resourceKey of shape.expectedResourceKeys) {
      assert.ok(groupResourceKeys.has(resourceKey), `${testCase.id} missing atomic resource ${resourceKey}`);
      assert.ok(
        groupMutations.some((mutation) => mutation.resourceKey === resourceKey),
        `${testCase.id} missing atomic mutation for ${resourceKey}`,
      );
    }

    const staleRemote = cloneJson(testCase.remote);
    setResource(staleRemote, dependencyPluginMutation.resource, { version: '9.9.9', active: false });
    const beforeHash = digest(staleRemote);
    const error = captureError(() => applyPlan(staleRemote, plan));

    assert.ok(error instanceof PushPlanError, `${testCase.id} stale dependency replay should throw`);
    assert.equal(error.code, 'PRECONDITION_FAILED');
    assert.equal(digest(staleRemote), beforeHash, `${testCase.id} stale replay changed remote before refusal`);

    const applied = applyPlan(cloneJson(testCase.remote), plan);
    assert.deepEqual(applied.site.plugins[atomicDependencyPlugin], testCase.local.plugins[atomicDependencyPlugin]);
    assert.deepEqual(applied.site.plugins[atomicDependentPlugin], testCase.local.plugins[atomicDependentPlugin]);
    assert.deepEqual(applied.site.files[atomicDependencyPluginFile], testCase.local.files[atomicDependencyPluginFile]);
    assert.deepEqual(applied.site.files[atomicDependentPluginFile], testCase.local.files[atomicDependentPluginFile]);
    assert.deepEqual(applied.site.db.wp_options[atomicFixtureOptionRowId], shape.optionRow);
    assertAtomicPluginStackEvidenceRedacted(testCase, plan, shape);
  }

  for (const testCase of missingDependencyCases) {
    const shape = assertAtomicPluginStackShape(testCase, { missingDependency: true });
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(testCase);
    const group = plan.atomicGroups.find((candidate) => candidate.id === shape.intent.id);
    const remoteBefore = cloneJson(testCase.remote);
    const beforeHash = digest(remoteBefore);
    const error = captureError(() => applyPlan(remoteBefore, plan));

    assert.notEqual(plan.status, 'ready', `${testCase.id} missing dependency stack should be non-ready`);
    assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
    assert.equal(result.applied, false, `${testCase.id} non-ready stack must not apply`);
    assert.equal(group.status, 'blocked');
    assert.equal(group.requireAtomic, true);
    assert.ok(
      group.blockers.some((blocker) =>
        blocker.class === 'missing-plugin-dependency'
          && blocker.plugin === atomicDependencyPlugin),
      `${testCase.id} should block on missing dependency plugin`,
    );
    for (const resourceKey of shape.expectedResourceKeys) {
      assert.ok(
        group.blockers.some((blocker) =>
          blocker.class === 'atomic-group-blocker-propagation'
            && blocker.resourceKey === resourceKey),
        `${testCase.id} should propagate atomic blocker to ${resourceKey}`,
      );
    }
    assert.equal(
      plan.mutations.some((mutation) => mutation.resourceKey === pluginResourceKey(atomicDependencyPlugin)),
      false,
      `${testCase.id} must not plan dependency plugin mutation outside the atomic group`,
    );
    assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready atomic stack should refuse apply`);
    assert.equal(error.code, 'PLAN_NOT_READY');
    assert.equal(digest(remoteBefore), beforeHash, `${testCase.id} non-ready apply changed remote`);
    assertAtomicPluginStackEvidenceRedacted(testCase, plan, shape);
  }
});

test('RPP-0176 atomic plugin install stack variant 4 retains focused ready and non-ready regression coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.atomicPluginInstallStackV4;
  const firstEvidence = generatedAtomicPluginInstallStackV4Evidence();
  const replayEvidence = generatedAtomicPluginInstallStackV4Evidence();
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0176 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.ok(coverage, 'missing atomic plugin install stack variant 4 target coverage');
  assert.equal(coverage.family, 'atomic-plugin-install-stack-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['atomic-plugin-install-stack-v4']);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.statuses.ready, 10);
  assert.equal(nonReadyTargetCount(coverage), 10);
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready atomic plugin stack cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready atomic plugin stack cases');
  assert.equal(report.summary.featureFamilies['atomic-plugin-stack-ready-v4'], 10);
  assert.equal(report.summary.featureFamilies['atomic-plugin-stack-missing-dependency-v4'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 generated model evidence changed between runs');
  assert.equal(firstEvidence.target, 'atomicPluginInstallStackV4');
  assert.equal(firstEvidence.totalCases, 2);
  assert.equal(firstEvidence.readyCases, 1);
  assert.equal(firstEvidence.nonReadyCases, 1);

  const variantCases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('atomic-plugin-install-stack-v4'));
  const readyGeneratedCases = variantCases.filter((testCase) =>
    testCase.family === 'atomic-plugin-stack-ready'
      && testCase.tags.has('atomic-plugin-stack-ready-v4'));
  const missingDependencyCases = variantCases.filter((testCase) =>
    testCase.family === 'atomic-plugin-missing-dependency'
      && testCase.tags.has('atomic-plugin-stack-missing-dependency-v4'));

  assert.equal(variantCases.length, coverage.total);
  assert.equal(readyGeneratedCases.length, 10, 'variant 4 should include one ready atomic stack case per tier');
  assert.equal(
    missingDependencyCases.length,
    10,
    'variant 4 should include one missing-dependency atomic stack case per tier',
  );

  const readyCase = firstEvidence.cases.find((entry) => entry.status === 'ready');
  const nonReadyCase = firstEvidence.cases.find((entry) => entry.status !== 'ready');

  assert.ok(readyCase, 'variant 4 evidence must include a ready case');
  assert.ok(nonReadyCase, 'variant 4 evidence must include a non-ready case');
  assert.equal(readyCase.atomicGroup.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.atomicGroup.dependencySources[0], 'same-atomic-group');
  assert.ok(
    readyCase.atomicGroup.mutationResourceKeys.includes(fileResourceKey(atomicDependencyPluginFile)),
    'ready variant 4 case should install the dependency plugin file inside the atomic group',
  );
  assert.ok(
    readyCase.atomicGroup.mutationResourceKeys.includes(pluginResourceKey(atomicDependencyPlugin)),
    'ready variant 4 case should install dependency plugin metadata inside the atomic group',
  );
  assert.ok(
    readyCase.atomicGroup.resources.includes(rowResourceKey('wp_options', atomicFixtureOptionRowId)),
    'ready variant 4 case should keep plugin-owned option data inside the atomic group',
  );
  assert.match(readyCase.modelProofHash, /^[a-f0-9]{64}$/);
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.atomicGroup.status, 'blocked');
  assert.equal(
    nonReadyCase.atomicGroup.mutationResourceKeys.includes(pluginResourceKey(atomicDependencyPlugin)),
    false,
    'non-ready variant 4 case must not synthesize dependency plugin metadata outside the local intent',
  );
  assert.ok(
    nonReadyCase.atomicGroup.blockers.some((blocker) =>
      blocker.class === 'missing-plugin-dependency'
        && blocker.plugin === atomicDependencyPlugin),
    'non-ready variant 4 case should expose missing dependency evidence',
  );
  assert.ok(
    nonReadyCase.atomicGroup.blockers.some((blocker) =>
      blocker.class === 'atomic-group-blocker-propagation'
        && blocker.resourceKey === pluginResourceKey(atomicDependentPlugin)),
    'non-ready variant 4 case should propagate the atomic blocker to grouped plugin metadata',
  );
  assert.match(nonReadyCase.modelProofHash, /^[a-f0-9]{64}$/);
  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('private-atomic-plugin-install-stack-v3'), false);
  assert.equal(evidenceText.includes('<?php'), false);
  assert.equal(evidenceText.includes('generated dependency'), false);
  assert.equal(evidenceText.includes('generated dependent'), false);
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

test('RPP-0121 file create/update/delete mix target emits ready and non-ready variant coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.fileCreateUpdateDeleteMix;

  assert.ok(coverage, 'missing file create/update/delete mix target coverage');
  assert.equal(coverage.family, 'file-create-update-delete-mix-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['file-create-update-delete-mix']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready file mix cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready file mix cases');
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
  const readyCase = cases.find((testCase) => testCase.family === 'file-create-update-delete-mix-ready');
  const nonReadyCase = cases.find((testCase) => testCase.family === 'file-create-update-delete-mix-conflict');

  assert.ok(readyCase, 'missing ready file create/update/delete mix case');
  assert.ok(nonReadyCase, 'missing non-ready file create/update/delete mix case');
  assertFileCreateUpdateDeleteMixShape(readyCase);
  assertFileCreateUpdateDeleteMixShape(nonReadyCase);

  const ready = validateGeneratedCase(readyCase);
  const nonReady = validateGeneratedCase(nonReadyCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 3, 'ready file mix should create, update, and delete files');
  assert.equal(ready.applied, true, 'ready file mix should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready file mix should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready file mix should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(nonReady.status, 'conflict');
  assert.ok(nonReady.conflicts >= 1, 'non-ready file mix should expose a file conflict');
  assert.equal(nonReady.applied, false, 'non-ready file mix must not apply mutations');
});

test('RPP-0141 file create/update/delete mix variant 3 emits ready and non-ready generated coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.fileCreateUpdateDeleteMixVariant3;

  assert.ok(coverage, 'missing file create/update/delete mix variant 3 target coverage');
  assert.equal(coverage.family, 'file-create-update-delete-mix-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['file-create-update-delete-mix-v3']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 3 target should include ready file mix cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 3 target should include non-ready file mix cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedFileCreateUpdateDeleteMixVariant3Evidence(coverage);
  const replayEvidence = generatedFileCreateUpdateDeleteMixVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0141 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 file mix evidence changed between runs');
  assert.equal(firstEvidence.target, 'fileCreateUpdateDeleteMixVariant3');
  assert.equal(firstEvidence.family, 'file-create-update-delete-mix-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 1, delete: 1, update: 1 });
  assert.equal(readyCase.remoteOnly.decision, 'keep-remote');
  assert.equal(readyCase.remoteOnly.plannedMutation, false);
  assert.equal(readyCase.remoteOnly.appliedHash, readyCase.remoteOnly.remoteHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.update.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('generated file mix create '), false, 'variant 3 evidence leaked created file payload');
  assert.equal(evidenceText.includes('generated file mix update '), false, 'variant 3 evidence leaked updated file payload');
  assert.equal(evidenceText.includes('remote-only file mix preserve '), false, 'variant 3 evidence leaked remote-only file payload');
  assert.equal(evidenceText.includes('remote concurrent file mix update '), false, 'variant 3 evidence leaked conflict payload');
});

test('RPP-0161 file create/update/delete mix variant 4 retains focused ready and non-ready regression coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.fileCreateUpdateDeleteMixVariant4;

  assert.ok(coverage, 'missing file create/update/delete mix variant 4 target coverage');
  assert.equal(coverage.family, 'file-create-update-delete-mix-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['file-create-update-delete-mix-v4']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready file mix cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready file mix cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedFileCreateUpdateDeleteMixVariant4Evidence(coverage);
  const replayEvidence = generatedFileCreateUpdateDeleteMixVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0161 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 file mix evidence changed between runs');
  assert.equal(firstEvidence.target, 'fileCreateUpdateDeleteMixVariant4');
  assert.equal(firstEvidence.family, 'file-create-update-delete-mix-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes('file-create-update-delete-mix-v4-ready'));
  assert.ok(nonReadyCase.tags.includes('file-create-update-delete-mix-v4-non-ready'));
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 1, delete: 1, update: 1 });
  assert.equal(readyCase.remoteOnly.decision, 'keep-remote');
  assert.equal(readyCase.remoteOnly.plannedMutation, false);
  assert.equal(readyCase.remoteOnly.appliedHash, readyCase.remoteOnly.remoteHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.update.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('generated file mix create '), false, 'variant 4 evidence leaked created file payload');
  assert.equal(evidenceText.includes('generated file mix update '), false, 'variant 4 evidence leaked updated file payload');
  assert.equal(evidenceText.includes('remote-only file mix preserve '), false, 'variant 4 evidence leaked remote-only file payload');
  assert.equal(evidenceText.includes('remote concurrent file mix update '), false, 'variant 4 evidence leaked conflict payload');
});

test('RPP-0102/RPP-0122 directory descendant target exposes per-tier ready and conflict counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.directoryDescendantConflict;

  assert.ok(coverage, 'missing directory descendant conflict target coverage');
  assert.equal(coverage.family, 'directory-descendant-conflict');
  assert.equal(coverage.total, report.summary.featureFamilies['directory-descendant']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready directory descendant cases');
  assert.ok(coverage.statuses.conflict > 0, 'target should include conflicting directory descendant cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(Object.values(coverage.perTier), Array(10).fill(2));
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.tags.has('directory-delete-no-remote-descendant'));
  const conflictCase = cases.find((testCase) => testCase.family === 'directory-descendant-conflict');

  assert.ok(readyCase, 'missing generated ready directory descendant target case');
  assert.ok(conflictCase, 'missing generated directory descendant conflict case');
  assert.ok(readyCase.tags.has('directory-descendant'));
  assert.ok(readyCase.tags.has('directory-descendant-ready'));
  assert.ok(readyCase.tags.has('directory-delete-no-remote-descendant'));
  assert.ok(conflictCase.tags.has('directory-descendant'));
  assert.ok(conflictCase.tags.has('directory-delete-with-remote-descendant'));
  assertDirectoryDescendantShape(readyCase, { conflict: false });
  assertDirectoryDescendantShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready directory descendant case should plan the directory delete');
  assert.equal(ready.applied, true, 'ready directory descendant case should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready directory descendant apply should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready directory descendant case should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts > 0, 'directory descendant case must conflict');
  assert.equal(conflict.applied, false, 'directory descendant conflict must not apply mutations');
});

test('RPP-0142 directory descendant conflict variant 3 exposes per-tier generated coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.directoryDescendantConflictVariant3;

  assert.ok(coverage, 'missing directory descendant conflict variant 3 target coverage');
  assert.equal(coverage.family, 'directory-descendant-conflict-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['directory-descendant-v3']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 3 target should include ready directory deletes');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 3 target should include descendant conflicts');
  assert.equal(report.summary.featureFamilies['directory-descendant-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['directory-descendant-v3-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedDirectoryDescendantConflictVariant3Evidence(coverage);
  const replayEvidence = generatedDirectoryDescendantConflictVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0142 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 directory descendant evidence changed between runs');
  assert.equal(firstEvidence.target, 'directoryDescendantConflictVariant3');
  assert.equal(firstEvidence.family, 'directory-descendant-conflict-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.surface.remoteDescendant, null);
  assert.equal(readyCase.directoryDelete.action, 'delete');
  assert.equal(readyCase.directoryDelete.changeKind, 'delete');
  assert.equal(readyCase.directoryDelete.appliedHash, readyCase.directoryDelete.localHash);
  assert.equal(readyCase.directoryDelete.resourceKey, readyCase.surface.directory.resourceKey);
  assert.match(readyCase.directoryDelete.mutationHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.surface.remoteDescendant.resourceKey, nonReadyCase.conflict.relatedResourceKey);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.directory.resourceKey);
  assert.equal(nonReadyCase.conflict.class, 'file-topology-conflict');
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.equal(nonReadyCase.remoteDescendant.decision, 'keep-remote');
  assert.equal(nonReadyCase.remoteDescendant.plannedMutation, false);
  assert.equal(nonReadyCase.remoteDescendant.plannedPrecondition, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('remote descendant '), false, 'variant 3 evidence leaked remote descendant payload');
});

test('RPP-0162 directory descendant conflict variant 4 exposes per-tier generated coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.directoryDescendantConflictVariant4;

  assert.ok(coverage, 'missing directory descendant conflict variant 4 target coverage');
  assert.equal(coverage.family, 'directory-descendant-conflict-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['directory-descendant-v4']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready directory deletes');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include descendant conflicts');
  assert.equal(report.summary.featureFamilies['directory-descendant-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['directory-descendant-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedDirectoryDescendantConflictVariant4Evidence(coverage);
  const replayEvidence = generatedDirectoryDescendantConflictVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0162 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 directory descendant evidence changed between runs');
  assert.equal(firstEvidence.target, 'directoryDescendantConflictVariant4');
  assert.equal(firstEvidence.family, 'directory-descendant-conflict-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.ok(readyCase.tags.includes('directory-descendant-v4'));
  assert.ok(readyCase.tags.includes('directory-descendant-v4-ready'));
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.surface.remoteDescendant, null);
  assert.equal(readyCase.directoryDelete.action, 'delete');
  assert.equal(readyCase.directoryDelete.changeKind, 'delete');
  assert.equal(readyCase.directoryDelete.appliedHash, readyCase.directoryDelete.localHash);
  assert.equal(readyCase.directoryDelete.resourceKey, readyCase.surface.directory.resourceKey);
  assert.match(readyCase.directoryDelete.mutationHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.ok(nonReadyCase.tags.includes('directory-descendant-v4'));
  assert.ok(nonReadyCase.tags.includes('directory-descendant-v4-non-ready'));
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.surface.remoteDescendant.resourceKey, nonReadyCase.conflict.relatedResourceKey);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.directory.resourceKey);
  assert.equal(nonReadyCase.conflict.class, 'file-topology-conflict');
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.equal(nonReadyCase.remoteDescendant.decision, 'keep-remote');
  assert.equal(nonReadyCase.remoteDescendant.plannedMutation, false);
  assert.equal(nonReadyCase.remoteDescendant.plannedPrecondition, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('remote descendant '), false, 'variant 4 evidence leaked remote descendant payload');
});

test('RPP-0143 plugin-owned resource refusal variant 3 exposes ready changed and stale generated coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedResourceRefusalVariant3;

  assert.ok(coverage, 'missing plugin-owned resource refusal variant 3 target coverage');
  assert.equal(coverage.family, 'plugin-owned-resource-refusal-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-resource-refusal-v3']);
  assert.equal(coverage.total, 30);
  assert.deepEqual(coverage.statuses, { blocked: 10, conflict: 10, ready: 10 });
  assert.equal(report.summary.featureFamilies['plugin-owned-resource-refusal-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['plugin-owned-resource-refusal-v3-changed'], 10);
  assert.equal(report.summary.featureFamilies['plugin-owned-resource-refusal-v3-stale'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 3])),
  );

  const firstEvidence = generatedPluginOwnedResourceRefusalVariant3Evidence(coverage);
  const replayEvidence = generatedPluginOwnedResourceRefusalVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0143 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 plugin-owned refusal evidence changed between runs');
  assert.equal(firstEvidence.target, 'pluginOwnedResourceRefusalVariant3');
  assert.equal(firstEvidence.family, 'plugin-owned-resource-refusal-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.changedCases, report.summary.featureFamilies['plugin-owned-resource-refusal-v3-changed']);
  assert.equal(firstEvidence.staleCases, report.summary.featureFamilies['plugin-owned-resource-refusal-v3-stale']);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'changed', 'stale'],
  );

  const [readyCase, changedCase, staleCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.readyMutation.pluginOwner, 'forms');
  assert.equal(readyCase.readyMutation.driver, 'wp-option');
  assert.equal(readyCase.readyMutation.action, 'put');
  assert.equal(readyCase.readyMutation.changeKind, 'update');
  assert.equal(readyCase.readyMutation.appliedHash, readyCase.surface.localHash);
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.remoteBeforeHash, readyCase.staleReplay.remoteAfterHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(changedCase.status, 'blocked');
  assert.equal(changedCase.applied, false);
  assert.equal(changedCase.changedBlocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(changedCase.changedBlocker.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(changedCase.changedBlocker.pluginOwner, 'forms');
  assert.equal(changedCase.changedBlocker.plannedMutation, false);
  assert.equal(changedCase.changedBlocker.plannedPrecondition, false);
  assert.equal(changedCase.changedBlocker.refusalEvidence.format, 'hash-only');
  assert.equal(changedCase.changedBlocker.refusalEvidence.rawValuesIncluded, false);
  assert.equal(changedCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(changedCase.refusal.remoteBeforeHash, changedCase.refusal.remoteAfterHash);
  assert.match(changedCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(staleCase.status, 'conflict');
  assert.equal(staleCase.applied, false);
  assert.equal(staleCase.staleConflict.class, 'plugin-data-conflict');
  assert.equal(staleCase.staleConflict.pluginOwner, 'forms');
  assert.equal(staleCase.staleConflict.plannedMutation, false);
  assert.equal(staleCase.staleConflict.plannedPrecondition, false);
  assert.equal(staleCase.staleConflict.change.localChange, 'update');
  assert.equal(staleCase.staleConflict.change.remoteChange, 'update');
  assert.equal(staleCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(staleCase.refusal.remoteBeforeHash, staleCase.refusal.remoteAfterHash);
  assert.match(staleCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('rpp0143-ready-base-private-token'), false, 'variant 3 evidence leaked ready base token');
  assert.equal(evidenceText.includes('rpp0143-ready-local-private-token'), false, 'variant 3 evidence leaked ready local token');
  assert.equal(evidenceText.includes('rpp0143-changed-base-private-token'), false, 'variant 3 evidence leaked changed base token');
  assert.equal(evidenceText.includes('rpp0143-changed-local-private-token'), false, 'variant 3 evidence leaked changed local token');
  assert.equal(evidenceText.includes('rpp0143-stale-base-private-token'), false, 'variant 3 evidence leaked stale base token');
  assert.equal(evidenceText.includes('rpp0143-stale-local-private-token'), false, 'variant 3 evidence leaked stale local token');
  assert.equal(evidenceText.includes('rpp0143-stale-remote-private-token'), false, 'variant 3 evidence leaked stale remote token');
});

function assertDirectoryDescendantShape(testCase, { conflict }) {
  const marker = conflict ? '/descendant-' : '/descendant-ready-';
  const directories = Object.entries(testCase.base.files)
    .filter(([path, value]) => path.includes(marker) && value?.type === 'directory')
    .map(([path]) => path);

  assert.equal(directories.length, 1, `${testCase.id} should seed one directory descendant target`);

  const [directory] = directories;
  assert.equal(Object.hasOwn(testCase.local.files, directory), false, `${testCase.id} should delete the directory locally`);
  assert.equal(testCase.remote.files[directory]?.type, 'directory', `${testCase.id} should keep the remote directory`);

  const remoteDescendants = Object.keys(testCase.remote.files)
    .filter((path) => path.startsWith(`${directory}/`));
  assert.equal(
    remoteDescendants.length > 0,
    conflict,
    `${testCase.id} remote descendant shape should match expected conflict readiness`,
  );

  for (const path of remoteDescendants) {
    assert.equal(Object.hasOwn(testCase.base.files, path), false, `${testCase.id} remote descendant should not exist in base`);
    assert.equal(Object.hasOwn(testCase.local.files, path), false, `${testCase.id} remote descendant should be remote-only`);
  }

  const remoteDescendantResource = remoteDescendants.length > 0
    ? { type: 'file', path: remoteDescendants[0] }
    : null;

  return {
    directory,
    directoryResource: { type: 'file', path: directory },
    directoryResourceKey: `file:${directory}`,
    remoteDescendants,
    remoteDescendantResource,
    remoteDescendantResourceKey: remoteDescendantResource ? `file:${remoteDescendantResource.path}` : null,
  };
}

function generatedDirectoryDescendantConflictVariant3Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('directory-descendant-v3')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedDirectoryDescendantConflictVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 3 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 3 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 3 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 3 target should select one ready directory delete case');
  assert.ok(selectedCases.has('non-ready'), 'variant 3 target should select one descendant conflict case');

  return {
    target: 'directoryDescendantConflictVariant3',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

function generatedDirectoryDescendantConflictVariant4Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('directory-descendant-v4')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedDirectoryDescendantConflictVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 4 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 4 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 4 target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 4 target should select one ready directory delete case');
  assert.ok(selectedCases.has('non-ready'), 'variant 4 target should select one descendant conflict case');

  return {
    target: 'directoryDescendantConflictVariant4',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

function generatedDirectoryDescendantConflictVariant3CaseEvidence(testCase, result) {
  const conflict = testCase.family === 'directory-descendant-conflict';
  const shape = assertDirectoryDescendantShape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = directoryDescendantVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const directoryDelete = directoryDescendantVariant3ReadyDeleteEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(conflict, false, `${testCase.id} ready evidence should come from ready directory target`);
    assert.equal(testCase.tags.has('directory-descendant-v3-ready'), true);
    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      directoryDelete,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        directoryDelete,
      })}`,
    };
  }

  assert.equal(conflict, true, `${testCase.id} non-ready evidence should come from descendant conflict family`);
  assert.equal(testCase.tags.has('directory-descendant-v3-non-ready'), true);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const conflictEvidence = directoryDescendantVariant3ConflictEvidence({ testCase, plan, shape });
  const remoteDescendant = directoryDescendantVariant3RemoteDescendantEvidence({ testCase, plan, shape });
  const refusal = directoryDescendantVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictEvidence,
    remoteDescendant,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictEvidence,
      remoteDescendant,
      refusal,
    })}`,
  };
}

function directoryDescendantVariant3SurfaceEvidence(testCase, shape) {
  const directory = {
    resourceKey: shape.directoryResourceKey,
    baseHash: resourceHash(testCase.base, shape.directoryResource),
    localHash: resourceHash(testCase.local, shape.directoryResource),
    remoteHash: resourceHash(testCase.remote, shape.directoryResource),
  };
  const remoteDescendant = shape.remoteDescendantResource
    ? {
        resourceKey: shape.remoteDescendantResourceKey,
        baseHash: resourceHash(testCase.base, shape.remoteDescendantResource),
        localHash: resourceHash(testCase.local, shape.remoteDescendantResource),
        remoteHash: resourceHash(testCase.remote, shape.remoteDescendantResource),
      }
    : null;

  return {
    directory,
    remoteDescendant,
  };
}

function directoryDescendantVariant3ReadyDeleteEvidence({ testCase, plan, applied, shape }) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.directoryResourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === shape.directoryResourceKey);

  assert.ok(mutation, `${testCase.id} should plan the directory delete mutation`);
  assert.ok(precondition, `${testCase.id} should precondition the directory delete`);
  assert.equal(mutation.action, 'delete');
  assert.equal(mutation.changeKind, 'delete');
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(Object.hasOwn(applied.site.files, shape.directory), false, `${testCase.id} apply should delete the directory`);

  const baseHash = resourceHash(testCase.base, shape.directoryResource);
  const localHash = resourceHash(testCase.local, shape.directoryResource);
  const remoteHash = resourceHash(testCase.remote, shape.directoryResource);
  const appliedHash = resourceHash(applied.site, shape.directoryResource);

  assert.equal(appliedHash, localHash, `${testCase.id} applied directory hash should match local deletion`);
  assert.equal(remoteHash, mutation.remoteBeforeHash, `${testCase.id} remote hash should match mutation preimage`);

  return {
    resourceKey: shape.directoryResourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    baseHash,
    localHash,
    remoteHash,
    appliedHash,
    mutationRemoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    mutationHash: `sha256:${digest(mutation)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
  };
}

function directoryDescendantVariant3ConflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.directoryResourceKey);
  const plannedMutation = plan.mutations.some((entry) => entry.resourceKey === shape.directoryResourceKey);

  assert.ok(conflict, `${testCase.id} should report a conflict for ${shape.directoryResourceKey}`);
  assert.equal(conflict.class, 'file-topology-conflict');
  assert.equal(conflict.relatedResourceKey, shape.remoteDescendantResourceKey);
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted directory delete`);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    relatedResourceKey: conflict.relatedResourceKey,
    plannedMutation,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function directoryDescendantVariant3RemoteDescendantEvidence({ testCase, plan, shape }) {
  assert.ok(shape.remoteDescendantResource, `${testCase.id} should include one remote descendant`);

  const decision = plan.decisions.find((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);
  const plannedMutation = plan.mutations.some((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);
  const plannedPrecondition = plan.preconditions.some((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);

  assert.ok(decision, `${testCase.id} should record a keep-remote decision for the descendant`);
  assert.equal(decision.decision, 'keep-remote');
  assert.equal(plannedMutation, false);
  assert.equal(plannedPrecondition, false);

  return {
    resourceKey: shape.remoteDescendantResourceKey,
    decision: decision.decision,
    baseHash: resourceHash(testCase.base, shape.remoteDescendantResource),
    localHash: resourceHash(testCase.local, shape.remoteDescendantResource),
    remoteHash: resourceHash(testCase.remote, shape.remoteDescendantResource),
    plannedMutation,
    plannedPrecondition,
    decisionHash: `sha256:${digest(decision)}`,
  };
}

function directoryDescendantVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

const pluginOwnedResourceRefusalVariant3Prefix = 'rpp0143_plugin_owned_refusal_v3_';

function generatedPluginOwnedResourceRefusalVariant3Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const variants = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('plugin-owned-resource-refusal-v3')) {
      continue;
    }

    const variant = pluginOwnedResourceRefusalVariant3Variant(testCase);
    const result = validateGeneratedCase(testCase);
    const evidence = generatedPluginOwnedResourceRefusalVariant3CaseEvidence(testCase, result, variant);

    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    incrementCount(variants, variant);
    if (!selectedCases.has(variant)) {
      selectedCases.set(variant, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const sortedVariants = sortStringObject(variants);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 3 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 3 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 3 target recount should match summary total');
  assert.deepEqual(sortedVariants, { changed: 10, ready: 10, stale: 10 });
  assert.ok(selectedCases.has('ready'), 'variant 3 target should select one ready plugin-owned case');
  assert.ok(selectedCases.has('changed'), 'variant 3 target should select one changed plugin-owned refusal');
  assert.ok(selectedCases.has('stale'), 'variant 3 target should select one stale plugin-owned refusal');

  return {
    target: 'pluginOwnedResourceRefusalVariant3',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedVariants.ready || 0,
    changedCases: sortedVariants.changed || 0,
    staleCases: sortedVariants.stale || 0,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    variants: sortedVariants,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('changed'),
      selectedCases.get('stale'),
    ],
  };
}

function pluginOwnedResourceRefusalVariant3Variant(testCase) {
  const variants = ['ready', 'changed', 'stale']
    .filter((variant) => testCase.tags.has(`plugin-owned-resource-refusal-v3-${variant}`));

  assert.equal(variants.length, 1, `${testCase.id} should expose exactly one RPP-0143 variant tag`);
  return variants[0];
}

function generatedPluginOwnedResourceRefusalVariant3CaseEvidence(testCase, result, variant) {
  const shape = assertPluginOwnedResourceRefusalVariant3Shape(testCase, variant);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = pluginOwnedResourceRefusalVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant,
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  if (variant === 'ready') {
    assert.equal(plan.status, 'ready', `${testCase.id} ready target should plan as ready`);
    assert.equal(result.status, 'ready', `${testCase.id} ready target should validate as ready`);
    assert.equal(result.applied, true, `${testCase.id} ready target should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} ready target should preserve remote data`);

    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const readyMutation = pluginOwnedResourceRefusalVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });
    const staleReplay = pluginOwnedResourceRefusalVariant3ReadyStaleReplayEvidence({
      testCase,
      plan,
      shape,
    });

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      readyMutation,
      staleReplay,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        readyMutation,
        staleReplay,
      })}`,
    };
  }

  if (variant === 'changed') {
    assert.equal(plan.status, 'blocked', `${testCase.id} changed target should plan as blocked`);
    assert.equal(result.status, 'blocked', `${testCase.id} changed target should validate as blocked`);
    assert.equal(result.applied, false, `${testCase.id} changed target must not apply`);

    const changedBlocker = pluginOwnedResourceRefusalVariant3ChangedBlockerEvidence({ testCase, plan, shape });
    const refusal = pluginOwnedResourceRefusalVariant3ApplyRefusalEvidence(testCase, plan);

    return {
      ...commonEvidence,
      applied: result.applied,
      changedBlocker,
      refusal,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        changedBlocker,
        refusal,
      })}`,
    };
  }

  assert.equal(variant, 'stale');
  assert.equal(plan.status, 'conflict', `${testCase.id} stale target should plan as conflict`);
  assert.equal(result.status, 'conflict', `${testCase.id} stale target should validate as conflict`);
  assert.equal(result.applied, false, `${testCase.id} stale target must not apply`);

  const staleConflict = pluginOwnedResourceRefusalVariant3StaleConflictEvidence({ testCase, plan, shape });
  const refusal = pluginOwnedResourceRefusalVariant3ApplyRefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    staleConflict,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      staleConflict,
      refusal,
    })}`,
  };
}

function assertPluginOwnedResourceRefusalVariant3Shape(testCase, variant) {
  const optionPrefix = `${pluginOwnedResourceRefusalVariant3Prefix}${variant}_`;
  const matches = Object.entries(testCase.local.db.wp_options)
    .filter(([, row]) => row?.option_name?.startsWith(optionPrefix));

  assert.equal(matches.length, 1, `${testCase.id} should carry one ${variant} RPP-0143 option target`);

  const [rowId, localRow] = matches[0];
  const baseRow = testCase.base.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];
  const resource = { type: 'row', table: 'wp_options', id: rowId };
  const resourceKey = generatedRowResourceKey('wp_options', rowId);
  const policyEntries = [
    ...(testCase.base.meta?.pluginOwnedResources?.allowedResources || []),
    ...(testCase.local.meta?.pluginOwnedResources?.allowedResources || []),
    ...(testCase.remote.meta?.pluginOwnedResources?.allowedResources || []),
  ].filter((entry) =>
    entry.resourceKey === resourceKey && entry.pluginOwner === 'forms' && entry.driver === 'wp-option');

  assert.ok(baseRow, `${testCase.id} should seed a base row for ${resourceKey}`);
  assert.ok(remoteRow, `${testCase.id} should seed a remote row for ${resourceKey}`);
  assert.equal(baseRow.__pluginOwner, 'forms');
  assert.equal(localRow.__pluginOwner, 'forms');
  assert.equal(remoteRow.__pluginOwner, 'forms');
  assert.notDeepEqual(localRow, baseRow, `${testCase.id} local row should change the RPP-0143 target`);

  if (variant === 'ready') {
    assert.deepEqual(remoteRow, baseRow, `${testCase.id} ready target should have unchanged remote`);
    assert.ok(policyEntries.length > 0, `${testCase.id} ready target should include an explicit driver policy`);
  } else {
    assert.equal(policyEntries.length, 0, `${testCase.id} ${variant} target should not include a driver policy`);
  }

  if (variant === 'changed') {
    assert.deepEqual(remoteRow, baseRow, `${testCase.id} changed target should keep remote at base`);
  }

  if (variant === 'stale') {
    assert.notDeepEqual(remoteRow, baseRow, `${testCase.id} stale target should drift remote from base`);
    assert.notDeepEqual(remoteRow, localRow, `${testCase.id} stale target should keep local and remote different`);
  }

  return {
    variant,
    rowId,
    resource,
    resourceKey,
    baseRow,
    localRow,
    remoteRow,
  };
}

function pluginOwnedResourceRefusalVariant3SurfaceEvidence(testCase, shape) {
  const baseHash = resourceHash(testCase.base, shape.resource);
  const localHash = resourceHash(testCase.local, shape.resource);
  const remoteHash = resourceHash(testCase.remote, shape.resource);

  return {
    resourceKey: shape.resourceKey,
    pluginOwner: 'forms',
    baseHash,
    localHash,
    remoteHash,
    localChanged: localHash !== baseHash,
    remoteChanged: remoteHash !== baseHash,
  };
}

function pluginOwnedResourceRefusalVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === shape.resourceKey);

  assert.ok(mutation, `${testCase.id} should plan the supported plugin-owned target mutation`);
  assert.ok(precondition, `${testCase.id} should precondition the supported plugin-owned target`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource?.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);

  const appliedHash = resourceHash(applied.site, shape.resource);
  assert.equal(appliedHash, resourceHash(testCase.local, shape.resource), `${testCase.id} should apply local target value`);

  return {
    resourceKey: shape.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    pluginOwner: mutation.pluginOwnedResource.pluginOwner,
    driver: mutation.pluginOwnedResource.driver,
    ownerContextRequired: mutation.pluginOwnedResource.ownerContextRequired,
    baseHash: mutation.baseHash,
    localHash: mutation.localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    appliedHash,
    auditEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.auditEvidence)}`,
    mutationHash: `sha256:${digest(mutation)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
  };
}

function pluginOwnedResourceRefusalVariant3ReadyStaleReplayEvidence({ testCase, plan, shape }) {
  const driftedRemote = cloneJson(testCase.remote);
  setResource(driftedRemote, shape.resource, {
    ...shape.remoteRow,
    option_value: {
      mode: 'remote-ready-stale-replay',
      privateToken: `rpp0143-ready-replay-private-token-${testCase.tier}`,
    },
  });
  const remoteBeforeHash = digest(driftedRemote);
  const error = captureError(() => applyPlan(driftedRemote, plan));
  const remoteAfterHash = digest(driftedRemote);

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale ready replay should refuse`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale ready replay mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function pluginOwnedResourceRefusalVariant3ChangedBlockerEvidence({ testCase, plan, shape }) {
  const blocker = plan.blockers.find((entry) => entry.resourceKey === shape.resourceKey);
  const plannedMutation = plan.mutations.some((entry) => entry.resourceKey === shape.resourceKey);
  const plannedPrecondition = plan.preconditions.some((entry) => entry.resourceKey === shape.resourceKey);

  assert.ok(blocker, `${testCase.id} should block the unknown plugin-owned target`);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.driver, null);
  assert.equal(plannedMutation, false);
  assert.equal(plannedPrecondition, false);
  assert.equal(blocker.unknownPluginOwnedResourceRefusalEvidence?.format, 'hash-only');
  assert.equal(blocker.unknownPluginOwnedResourceRefusalEvidence?.rawValuesIncluded, false);
  assert.deepEqual(blocker.unknownPluginOwnedResourceRefusalEvidence?.hashes, {
    baseHash: blocker.baseHash,
    localHash: blocker.localHash,
    remoteHash: blocker.remoteHash,
  });

  return {
    resourceKey: shape.resourceKey,
    class: blocker.class,
    reasonCode: blocker.reasonCode,
    pluginOwner: blocker.pluginOwner,
    driver: blocker.driver,
    change: blocker.change,
    baseHash: blocker.baseHash,
    localHash: blocker.localHash,
    remoteHash: blocker.remoteHash,
    plannedMutation,
    plannedPrecondition,
    refusalEvidence: {
      reasonCode: blocker.unknownPluginOwnedResourceRefusalEvidence.reasonCode,
      operation: blocker.unknownPluginOwnedResourceRefusalEvidence.operation,
      outcome: blocker.unknownPluginOwnedResourceRefusalEvidence.outcome,
      format: blocker.unknownPluginOwnedResourceRefusalEvidence.format,
      rawValuesIncluded: blocker.unknownPluginOwnedResourceRefusalEvidence.rawValuesIncluded,
      hashes: blocker.unknownPluginOwnedResourceRefusalEvidence.hashes,
      evidenceHash: `sha256:${digest(blocker.unknownPluginOwnedResourceRefusalEvidence)}`,
    },
    blockerHash: `sha256:${digest(blocker)}`,
  };
}

function pluginOwnedResourceRefusalVariant3StaleConflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.resourceKey);
  const plannedMutation = plan.mutations.some((entry) => entry.resourceKey === shape.resourceKey);
  const plannedPrecondition = plan.preconditions.some((entry) => entry.resourceKey === shape.resourceKey);

  assert.ok(conflict, `${testCase.id} should conflict the stale plugin-owned target`);
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.pluginOwner, 'forms');
  assert.equal(conflict.change.localChange, 'update');
  assert.equal(conflict.change.remoteChange, 'update');
  assert.equal(plannedMutation, false);
  assert.equal(plannedPrecondition, false);

  return {
    resourceKey: shape.resourceKey,
    class: conflict.class,
    pluginOwner: conflict.pluginOwner,
    change: conflict.change,
    baseHash: conflict.baseHash,
    localHash: conflict.localHash,
    remoteHash: conflict.remoteHash,
    plannedMutation,
    plannedPrecondition,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function pluginOwnedResourceRefusalVariant3ApplyRefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plugin-owned target should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready plugin-owned refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

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

test('RPP-0123 file type-swap target exposes ready preservation and explicit conflicts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.fileTypeSwap;

  assert.ok(coverage, 'missing file type-swap target coverage');
  assert.equal(coverage.family, 'file-type-swap-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['file-type-swap']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready file type-swap cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready file type-swap cases');
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
  const readyCase = cases.find((testCase) => testCase.family === 'file-type-swap-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'file-type-swap-conflict');

  assert.ok(readyCase, 'missing ready file type-swap case');
  assert.ok(conflictCase, 'missing conflict file type-swap case');
  assertFileTypeSwapShape(readyCase, { conflict: false });
  assertFileTypeSwapShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready file type-swap should plan at least one mutation');
  assert.equal(ready.applied, true, 'ready file type-swap should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready file type-swap must preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready file type-swap should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'conflict file type-swap should expose topology conflict');
  assert.equal(conflict.applied, false, 'conflict file type-swap must not apply mutations');
});

test('RPP-0163 file type-swap conflict variant 4 proves ready preservation and refused conflicts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.fileTypeSwapConflictVariant4;

  assert.ok(coverage, 'missing file type-swap conflict variant 4 target coverage');
  assert.equal(coverage.family, 'file-type-swap-conflict-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['file-type-swap-conflict-v4']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.equal(report.summary.featureFamilies['file-type-swap-conflict-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['file-type-swap-conflict-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedFileTypeSwapConflictVariant4Evidence(coverage);
  const replayEvidence = generatedFileTypeSwapConflictVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0163 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 type-swap evidence changed between runs');
  assert.equal(firstEvidence.target, 'fileTypeSwapConflictVariant4');
  assert.equal(firstEvidence.family, 'file-type-swap-conflict-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.typeSwap.action, 'put');
  assert.equal(readyCase.typeSwap.changeKind, 'type-change');
  assert.equal(readyCase.typeSwap.appliedHash, readyCase.typeSwap.localHash);
  assert.equal(readyCase.remotePreservation.decision, 'keep-remote');
  assert.equal(readyCase.remotePreservation.plannedMutation, false);
  assert.equal(readyCase.remotePreservation.plannedPrecondition, false);
  assert.equal(readyCase.remotePreservation.appliedHash, readyCase.remotePreservation.remoteHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.surface.remoteDescendant.resourceKey, nonReadyCase.conflict.relatedResourceKey);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.target.resourceKey);
  assert.equal(nonReadyCase.conflict.class, 'file-topology-conflict');
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.equal(nonReadyCase.conflict.plannedPrecondition, false);
  assert.equal(nonReadyCase.remoteDescendant.decision, 'keep-remote');
  assert.equal(nonReadyCase.remoteDescendant.plannedMutation, false);
  assert.equal(nonReadyCase.remoteDescendant.plannedPrecondition, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('local type swap '), false, 'variant 4 evidence leaked local type-swap payload');
  assert.equal(
    evidenceText.includes('remote descendant for type swap '),
    false,
    'variant 4 evidence leaked remote descendant payload',
  );
  assert.equal(evidenceText.includes('Remote ready preserve '), false, 'variant 4 evidence leaked remote preserve row');
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

test('RPP-0124 row create/update/delete mix target exposes stale replay and conflict coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.rowCreateUpdateDeleteMix;

  assert.ok(coverage, 'missing row create/update/delete mix target coverage');
  assert.equal(coverage.family, 'row-create-update-delete-mix-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['row-create-update-delete-mix']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.deepEqual(coverage.perTier, {
    0: 2,
    1: 2,
    2: 2,
    3: 2,
    4: 2,
    5: 2,
    6: 2,
    7: 2,
    8: 2,
    9: 2,
  });

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'row-create-update-delete-mix-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'row-create-update-delete-mix-conflict');

  assert.ok(readyCase, 'missing ready row create/update/delete mix case');
  assert.ok(conflictCase, 'missing conflict row create/update/delete mix case');
  assertRowMixShape(readyCase);
  assertRowMixShape(conflictCase);
  assertRowMixConflictShape(conflictCase);

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 3, 'ready row mix should create, update, and delete rows');
  assert.equal(ready.applied, true, 'ready row mix should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready row mix should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready row mix should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'conflict row mix should expose a row conflict');
  assert.equal(conflict.applied, false, 'conflict row mix must not apply mutations');
});

test('RPP-0144 row create/update/delete mix variant 3 rejects stale replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.rowCreateUpdateDeleteMixVariant3;

  assert.ok(coverage, 'missing row create/update/delete mix variant 3 target coverage');
  assert.equal(coverage.family, 'row-create-update-delete-mix-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['row-create-update-delete-mix-v3']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 3 target should include ready row mix cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 3 target should include non-ready row mix cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedRowCreateUpdateDeleteMixVariant3Evidence(coverage);
  const replayEvidence = generatedRowCreateUpdateDeleteMixVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0144 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 row mix evidence changed between runs');
  assert.equal(firstEvidence.target, 'rowCreateUpdateDeleteMixVariant3');
  assert.equal(firstEvidence.family, 'row-create-update-delete-mix-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 1, delete: 1, update: 1 });
  assert.equal(readyCase.remoteOnly.decision, 'keep-remote');
  assert.equal(readyCase.remoteOnly.plannedMutation, false);
  assert.equal(readyCase.remoteOnly.plannedPrecondition, false);
  assert.equal(readyCase.remoteOnly.appliedHash, readyCase.remoteOnly.remoteHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.update.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated row mix create '), false, 'variant 3 evidence leaked created row payload');
  assert.equal(evidenceText.includes('Generated row mix update '), false, 'variant 3 evidence leaked updated row payload');
  assert.equal(evidenceText.includes('Remote-only row mix preserve '), false, 'variant 3 evidence leaked remote-only row payload');
  assert.equal(evidenceText.includes('Remote concurrent row mix update '), false, 'variant 3 evidence leaked conflict row payload');
});

test('RPP-0164 row create/update/delete mix variant 4 rejects stale replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.rowCreateUpdateDeleteMixVariant4;

  assert.ok(coverage, 'missing row create/update/delete mix variant 4 target coverage');
  assert.equal(coverage.family, 'row-create-update-delete-mix-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['row-create-update-delete-mix-v4']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready row mix cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready row mix cases');
  assert.equal(report.summary.featureFamilies['row-create-update-delete-mix-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['row-create-update-delete-mix-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedRowCreateUpdateDeleteMixVariant4Evidence(coverage);
  const replayEvidence = generatedRowCreateUpdateDeleteMixVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0164 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 row mix evidence changed between runs');
  assert.equal(firstEvidence.target, 'rowCreateUpdateDeleteMixVariant4');
  assert.equal(firstEvidence.family, 'row-create-update-delete-mix-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 1, delete: 1, update: 1 });
  assert.equal(readyCase.remoteOnly.decision, 'keep-remote');
  assert.equal(readyCase.remoteOnly.plannedMutation, false);
  assert.equal(readyCase.remoteOnly.plannedPrecondition, false);
  assert.equal(readyCase.remoteOnly.appliedHash, readyCase.remoteOnly.remoteHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.update.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated row mix create '), false, 'variant 4 evidence leaked created row payload');
  assert.equal(evidenceText.includes('Generated row mix update '), false, 'variant 4 evidence leaked updated row payload');
  assert.equal(evidenceText.includes('Remote-only row mix preserve '), false, 'variant 4 evidence leaked remote-only row payload');
  assert.equal(evidenceText.includes('Remote concurrent row mix update '), false, 'variant 4 evidence leaked conflict row payload');
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

function assertRowMixConflictShape(testCase) {
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated row mix update '));

  assert.equal(updateRows.length, 1, `${testCase.id} should update one conflict target row`);

  const [rowId] = updateRows[0];
  assert.match(testCase.remote.db.wp_posts[rowId].post_title, /^Remote concurrent row mix update /);
  assert.notEqual(
    testCase.remote.db.wp_posts[rowId].post_title,
    testCase.base.db.wp_posts[rowId].post_title,
    `${testCase.id} conflict target should drift remotely`,
  );
}

function generatedRowCreateUpdateDeleteMixVariant3Evidence(targetCoverage) {
  return generatedRowCreateUpdateDeleteMixVariantEvidence(targetCoverage, {
    target: 'rowCreateUpdateDeleteMixVariant3',
    tag: 'row-create-update-delete-mix-v3',
    variantLabel: 'variant 3',
  });
}

function generatedRowCreateUpdateDeleteMixVariant4Evidence(targetCoverage) {
  return generatedRowCreateUpdateDeleteMixVariantEvidence(targetCoverage, {
    target: 'rowCreateUpdateDeleteMixVariant4',
    tag: 'row-create-update-delete-mix-v4',
    variantLabel: 'variant 4',
  });
}

function generatedRowCreateUpdateDeleteMixVariantEvidence(targetCoverage, { target, tag, variantLabel }) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has(tag)) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedRowCreateUpdateDeleteMixVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, `${variantLabel} row target recount should match summary tiers`);
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, `${variantLabel} row target recount should match summary statuses`);
  assert.equal(totalCases, targetCoverage.total, `${variantLabel} row target recount should match summary total`);
  assert.ok(selectedCases.has('ready'), `${variantLabel} target should select one ready row mix case`);
  assert.ok(selectedCases.has('non-ready'), `${variantLabel} target should select one non-ready row mix case`);

  return {
    target,
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

function generatedRowCreateUpdateDeleteMixVariant3CaseEvidence(testCase, result) {
  const conflict = testCase.family === 'row-create-update-delete-mix-conflict';
  const shape = rowMixVariant3Shape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = rowMixVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const plannedChangeKinds = rowMixVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });
    const remoteOnly = rowMixVariant3RemoteOnlyEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      remoteOnly,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        remoteOnly,
      })}`,
    };
  }

  assert.equal(conflict, true, `${testCase.id} non-ready row mix evidence should come from conflict family`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const conflictEvidence = rowMixVariant3ConflictEvidence({ testCase, plan, shape });
  const refusal = rowMixVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictEvidence,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictEvidence,
      refusal,
    })}`,
  };
}

function rowMixVariant3Shape(testCase, { conflict = false } = {}) {
  const createRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => !testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated row mix create '));
  const updateRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([id, row]) => testCase.base.db.wp_posts[id]
      && row.post_title.startsWith('Generated row mix update '));
  const deleteRows = Object.entries(testCase.base.db.wp_posts)
    .filter(([id, row]) => row.post_title.startsWith('Base row mix delete ')
      && !testCase.local.db.wp_posts[id]
      && testCase.remote.db.wp_posts[id]);
  const remoteOnlyRows = Object.entries(testCase.remote.db.wp_posts)
    .filter(([id, row]) => !testCase.base.db.wp_posts[id]
      && !testCase.local.db.wp_posts[id]
      && row.post_title.startsWith('Remote-only row mix preserve '));

  assert.equal(createRows.length, 1, `${testCase.id} should create one row`);
  assert.equal(updateRows.length, 1, `${testCase.id} should update one row`);
  assert.equal(deleteRows.length, 1, `${testCase.id} should delete one row`);
  assert.equal(remoteOnlyRows.length, 1, `${testCase.id} should preserve one remote-only row`);

  const [createRowId] = createRows[0];
  const [updateRowId] = updateRows[0];
  const [deleteRowId] = deleteRows[0];
  const [remoteOnlyRowId] = remoteOnlyRows[0];

  if (conflict) {
    assert.match(testCase.remote.db.wp_posts[updateRowId].post_title, /^Remote concurrent row mix update /);
  } else {
    assert.deepEqual(
      testCase.remote.db.wp_posts[updateRowId],
      testCase.base.db.wp_posts[updateRowId],
      `${testCase.id} ready update row should not drift remotely`,
    );
  }

  return {
    createResource: rowResource('wp_posts', createRowId),
    createResourceKey: rowResourceKey('wp_posts', createRowId),
    updateResource: rowResource('wp_posts', updateRowId),
    updateResourceKey: rowResourceKey('wp_posts', updateRowId),
    deleteResource: rowResource('wp_posts', deleteRowId),
    deleteResourceKey: rowResourceKey('wp_posts', deleteRowId),
    remoteOnlyResource: rowResource('wp_posts', remoteOnlyRowId),
    remoteOnlyResourceKey: rowResourceKey('wp_posts', remoteOnlyRowId),
  };
}

function rowMixVariant3SurfaceEvidence(testCase, shape) {
  return Object.fromEntries([
    ['create', shape.createResource],
    ['update', shape.updateResource],
    ['delete', shape.deleteResource],
    ['remoteOnly', shape.remoteOnlyResource],
  ].map(([label, resource]) => [
    label,
    {
      resourceKey: resource.key,
      baseHash: resourceHash(testCase.base, resource),
      localHash: resourceHash(testCase.local, resource),
      remoteHash: resourceHash(testCase.remote, resource),
    },
  ]));
}

function rowMixVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { resource: shape.createResource, resourceKey: shape.createResourceKey, changeKind: 'create' },
    { resource: shape.updateResource, resourceKey: shape.updateResourceKey, changeKind: 'update' },
    { resource: shape.deleteResource, resourceKey: shape.deleteResourceKey, changeKind: 'delete' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};

  for (const { resource, resourceKey, changeKind } of expected) {
    const mutation = mutations.get(resourceKey);
    const precondition = preconditions.get(resourceKey);
    assert.ok(mutation, `${testCase.id} should plan ${changeKind} mutation for ${resourceKey}`);
    assert.ok(precondition, `${testCase.id} should precondition ${resourceKey}`);
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(
      resourceHash(applied.site, resource),
      resourceHash(testCase.local, resource),
      `${testCase.id} did not apply local row mix value for ${resourceKey}`,
    );
    incrementCount(plannedChangeKinds, changeKind);
  }

  return sortStringObject(plannedChangeKinds);
}

function rowMixVariant3RemoteOnlyEvidence({ testCase, plan, applied, shape }) {
  const mutationResourceKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const preconditionResourceKeys = new Set(plan.preconditions.map((precondition) => precondition.resourceKey));
  const decision = plan.decisions.find((entry) => entry.resourceKey === shape.remoteOnlyResourceKey);

  assert.ok(decision, `${testCase.id} should record a keep-remote decision for ${shape.remoteOnlyResourceKey}`);
  assert.equal(decision.decision, 'keep-remote');
  assert.equal(mutationResourceKeys.has(shape.remoteOnlyResourceKey), false);
  assert.equal(preconditionResourceKeys.has(shape.remoteOnlyResourceKey), false);

  const baseHash = resourceHash(testCase.base, shape.remoteOnlyResource);
  const localHash = resourceHash(testCase.local, shape.remoteOnlyResource);
  const remoteHash = resourceHash(testCase.remote, shape.remoteOnlyResource);
  const appliedHash = resourceHash(applied.site, shape.remoteOnlyResource);

  assert.equal(localHash, baseHash, `${testCase.id} local should not create the remote-only row`);
  assert.notEqual(remoteHash, baseHash, `${testCase.id} remote should create the remote-only row`);
  assert.equal(appliedHash, remoteHash, `${testCase.id} apply should preserve the remote-only row`);

  return {
    resourceKey: shape.remoteOnlyResourceKey,
    decision: decision.decision,
    change: decision.change,
    baseHash,
    localHash,
    remoteHash,
    appliedHash,
    plannedMutation: false,
    plannedPrecondition: false,
    decisionHash: `sha256:${digest(decision)}`,
  };
}

function rowMixVariant3ConflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.updateResourceKey);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.updateResourceKey);

  assert.ok(conflict, `${testCase.id} should report a conflict for ${shape.updateResourceKey}`);
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted update row mutation`);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    change: conflict.change,
    plannedMutation,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function rowMixVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowResourceKey(table, id),
  };
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

test('RPP-0125 wp_options scalar target exposes per-tier ready and conflict coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpOptionsScalarChanges;

  assert.ok(coverage, 'missing wp_options scalar target coverage');
  assert.equal(coverage.family, 'wp-options-scalar-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-options-scalar']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.deepEqual(coverage.perTier, {
    0: 2,
    1: 2,
    2: 2,
    3: 2,
    4: 2,
    5: 2,
    6: 2,
    7: 2,
    8: 2,
    9: 2,
  });

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-options-scalar-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'wp-options-scalar-conflict');

  assert.ok(readyCase, 'missing ready wp_options scalar option case');
  assert.ok(conflictCase, 'missing conflicting wp_options scalar option case');
  assertWpOptionsScalarShape(readyCase, { conflict: false });
  assertWpOptionsScalarShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready scalar option should plan an option mutation');
  assert.equal(ready.applied, true, 'ready scalar option should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready scalar option should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready scalar option should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'remote scalar option drift should be a conflict');
  assert.equal(conflict.applied, false, 'conflicting scalar option must not apply mutations');
});

test('RPP-0145 wp_options scalar option changes variant 3 records surface and invariant', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpOptionsScalarChangesVariant3;

  assert.ok(coverage, 'missing wp_options scalar option changes variant 3 target coverage');
  assert.equal(coverage.family, 'wp-options-scalar-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-options-scalar-v3']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 3 target should include ready scalar option cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 3 target should include non-ready scalar option cases');
  assert.equal(report.summary.featureFamilies['wp-options-scalar-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-options-scalar-v3-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpOptionsScalarChangesVariant3Evidence(coverage);
  const replayEvidence = generatedWpOptionsScalarChangesVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0145 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 scalar option evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpOptionsScalarChangesVariant3');
  assert.equal(firstEvidence.family, 'wp-options-scalar-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.scalarMutation.action, 'put');
  assert.equal(readyCase.scalarMutation.changeKind, 'update');
  assert.equal(readyCase.scalarMutation.plannedMutation, true);
  assert.equal(readyCase.scalarMutation.plannedPrecondition, true);
  assert.equal(readyCase.scalarMutation.appliedHash, readyCase.surface.option.localHash);
  assert.equal(readyCase.scalarMutation.preconditionExpectedHash, readyCase.scalarMutation.remoteBeforeHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.option.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('base-scalar-option-'), false, 'variant 3 evidence leaked base scalar option payload');
  assert.equal(evidenceText.includes('local-scalar-option-'), false, 'variant 3 evidence leaked local scalar option payload');
  assert.equal(evidenceText.includes('remote-scalar-option-'), false, 'variant 3 evidence leaked remote scalar option payload');
});

test('RPP-0165 wp_options scalar option changes variant 4 records surface and invariant', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpOptionsScalarChangesVariant4;

  assert.ok(coverage, 'missing wp_options scalar option changes variant 4 target coverage');
  assert.equal(coverage.family, 'wp-options-scalar-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-options-scalar-v4']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready scalar option cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready scalar option cases');
  assert.equal(report.summary.featureFamilies['wp-options-scalar-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-options-scalar-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpOptionsScalarChangesVariant4Evidence(coverage);
  const replayEvidence = generatedWpOptionsScalarChangesVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0165 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 scalar option evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpOptionsScalarChangesVariant4');
  assert.equal(firstEvidence.family, 'wp-options-scalar-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes('wp-options-scalar-v4-ready'));
  assert.ok(nonReadyCase.tags.includes('wp-options-scalar-v4-non-ready'));
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.scalarMutation.action, 'put');
  assert.equal(readyCase.scalarMutation.changeKind, 'update');
  assert.equal(readyCase.scalarMutation.plannedMutation, true);
  assert.equal(readyCase.scalarMutation.plannedPrecondition, true);
  assert.equal(readyCase.scalarMutation.appliedHash, readyCase.surface.option.localHash);
  assert.equal(readyCase.scalarMutation.preconditionExpectedHash, readyCase.scalarMutation.remoteBeforeHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.option.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('base-scalar-option-'), false, 'variant 4 evidence leaked base scalar option payload');
  assert.equal(evidenceText.includes('local-scalar-option-'), false, 'variant 4 evidence leaked local scalar option payload');
  assert.equal(evidenceText.includes('remote-scalar-option-'), false, 'variant 4 evidence leaked remote scalar option payload');
});

function generatedWpOptionsScalarChangesVariant3Evidence(targetCoverage) {
  return generatedWpOptionsScalarChangesVariantEvidence(targetCoverage, {
    target: 'wpOptionsScalarChangesVariant3',
    tag: 'wp-options-scalar-v3',
    label: 'variant 3',
  });
}

function generatedWpOptionsScalarChangesVariant4Evidence(targetCoverage) {
  return generatedWpOptionsScalarChangesVariantEvidence(targetCoverage, {
    target: 'wpOptionsScalarChangesVariant4',
    tag: 'wp-options-scalar-v4',
    label: 'variant 4',
  });
}

function generatedWpOptionsScalarChangesVariantEvidence(targetCoverage, { target, tag, label }) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has(tag)) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedWpOptionsScalarChangesVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, `${label} scalar option target recount should match summary tiers`);
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, `${label} scalar option target recount should match summary statuses`);
  assert.equal(totalCases, targetCoverage.total, `${label} scalar option target recount should match summary total`);
  assert.ok(selectedCases.has('ready'), `${label} target should select one ready scalar option case`);
  assert.ok(selectedCases.has('non-ready'), `${label} target should select one non-ready scalar option case`);

  return {
    target,
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

function generatedWpOptionsScalarChangesVariant3CaseEvidence(testCase, result) {
  const conflict = testCase.family === 'wp-options-scalar-conflict';
  const shape = wpOptionsScalarVariant3Shape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = wpOptionsScalarVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    valueKind: shape.valueKind,
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const scalarMutation = wpOptionsScalarVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      scalarMutation,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        scalarMutation,
      })}`,
    };
  }

  assert.equal(conflict, true, `${testCase.id} non-ready scalar option evidence should come from conflict family`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const conflictEvidence = wpOptionsScalarVariant3ConflictEvidence({ testCase, plan, shape });
  const refusal = wpOptionsScalarVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictEvidence,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictEvidence,
      refusal,
    })}`,
  };
}

function wpOptionsScalarVariant3Shape(testCase, { conflict = false } = {}) {
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
  assert.equal(typeof remoteRow.option_value, typeof baseRow.option_value);
  assert.ok(isScalar(localRow.option_value), `${testCase.id} local option_value must stay scalar`);
  assert.equal(baseRow.autoload, 'no');
  assert.notEqual(localRow.option_value, baseRow.option_value);

  if (conflict) {
    assert.notEqual(remoteRow.option_value, baseRow.option_value);
    assert.notEqual(remoteRow.option_value, localRow.option_value);
  } else {
    assert.equal(remoteRow.option_value, baseRow.option_value);
  }

  return {
    rowId,
    resource: rowResource('wp_options', rowId),
    resourceKey: rowResourceKey('wp_options', rowId),
    valueKind: typeof baseRow.option_value,
    autoload: baseRow.autoload,
  };
}

function wpOptionsScalarVariant3SurfaceEvidence(testCase, shape) {
  return {
    option: {
      resourceKey: shape.resourceKey,
      baseHash: resourceHash(testCase.base, shape.resource),
      localHash: resourceHash(testCase.local, shape.resource),
      remoteHash: resourceHash(testCase.remote, shape.resource),
      valueKind: shape.valueKind,
      autoload: shape.autoload,
      pluginOwned: false,
    },
  };
}

function wpOptionsScalarVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === shape.resourceKey);
  const localHash = resourceHash(testCase.local, shape.resource);
  const appliedHash = resourceHash(applied.site, shape.resource);

  assert.ok(mutation, `${testCase.id} should plan a scalar option mutation for ${shape.resourceKey}`);
  assert.ok(precondition, `${testCase.id} should precondition ${shape.resourceKey}`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(appliedHash, localHash, `${testCase.id} did not apply local scalar option value`);

  return {
    resourceKey: shape.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    appliedHash,
    plannedMutation: true,
    plannedPrecondition: true,
    mutationHash: `sha256:${digest({
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    })}`,
  };
}

function wpOptionsScalarVariant3ConflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.resourceKey);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.resourceKey);

  assert.ok(conflict, `${testCase.id} should report a scalar option conflict for ${shape.resourceKey}`);
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted scalar option mutation`);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    change: conflict.change,
    plannedMutation,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function wpOptionsScalarVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

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
  const serializedRows = Object.entries(testCase.local.db.wp_options)
    .filter(([id, row]) => id.startsWith('option_name:generated_serialized_')
      && isSerializedOptionValue(row.option_value));

  assert.equal(serializedRows.length, 1, `${testCase.id} should update one serialized wp_options row`);
  const [rowId, localRow] = serializedRows[0];
  const baseRow = testCase.base.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];

  assert.ok(baseRow, `${testCase.id} missing base serialized option row`);
  assert.ok(remoteRow, `${testCase.id} missing remote serialized option row`);
  assert.equal(localRow.__pluginOwner, undefined, `${testCase.id} serialized option should not be plugin-owned`);
  assert.equal(remoteRow.__pluginOwner, undefined, `${testCase.id} serialized option should not be plugin-owned`);
  assert.equal(localRow.option_name, baseRow.option_name);
  assert.match(baseRow.option_value, /^a:\d+:{/);
  assert.match(localRow.option_value, /^a:\d+:{/);
  assert.ok(isSerializedOptionValue(localRow.option_value), `${testCase.id} local option_value must stay serialized`);
  assert.notEqual(localRow.option_value, baseRow.option_value, `${testCase.id} local option should change`);
  if (conflict) {
    assert.notEqual(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote option should drift`);
    assert.notEqual(remoteRow.option_value, localRow.option_value, `${testCase.id} remote drift should differ from local`);
  } else {
    assert.equal(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote option should stay at base`);
  }

  return { rowId, baseRow, localRow, remoteRow };
}

function isSerializedOptionValue(value) {
  return typeof value === 'string'
    && /^a:\d+:{/.test(value)
    && value.includes('private_notes')
    && value.includes('auth_token');
}

test('RPP-0126 wp_options serialized option target emits redacted ready and non-ready coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpOptionsSerializedChanges;

  assert.ok(coverage, 'missing wp_options serialized option target coverage');
  assert.equal(coverage.family, 'wp-options-serialized-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-options-serialized-change']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready serialized option cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready serialized option cases');
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
  assert.equal(JSON.stringify(report).includes('private_notes'), false, 'summary must not expose serialized private keys');
  assert.equal(JSON.stringify(report).includes('local-private-serialized'), false, 'summary must not expose private values');

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-options-serialized-ready');
  const nonReadyCase = cases.find((testCase) => testCase.family === 'wp-options-serialized-conflict');

  assert.ok(readyCase, 'missing ready wp_options serialized option case');
  assert.ok(nonReadyCase, 'missing non-ready wp_options serialized option case');
  const readyShape = assertWpOptionsSerializedShape(readyCase, { conflict: false });
  const nonReadyShape = assertWpOptionsSerializedShape(nonReadyCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const nonReady = validateGeneratedCase(nonReadyCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready serialized option should plan at least one row mutation');
  assert.equal(ready.applied, true, 'ready serialized option should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready serialized option should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready serialized option should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.notEqual(nonReady.status, 'ready', 'non-ready serialized option case should fail closed');
  assert.equal(nonReady.applied, false, 'non-ready serialized option case must not apply mutations');

  assertSerializedOptionEvidenceRedacted(readyCase, readyShape);
  assertSerializedOptionEvidenceRedacted(nonReadyCase, nonReadyShape);
});

function assertSerializedOptionEvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations.find((entry) =>
    entry.resourceKey === `row:${JSON.stringify(['wp_options', shape.rowId])}`);

  if (!mutation) {
    assert.notEqual(plan.status, 'ready', `${testCase.id} missing mutation should only happen for non-ready plans`);
    assert.ok(plan.conflicts.length + plan.blockers.length > 0, `${testCase.id} should carry fail-closed evidence`);
    const redactedPlanEvidence = redactEvidence({
      status: plan.status,
      conflicts: plan.conflicts,
      blockers: plan.blockers,
    });
    assertSerializedOptionRawValuesAbsent(testCase, shape, JSON.stringify(redactedPlanEvidence));
    return;
  }

  assert.ok(mutation, `${testCase.id} should include a serialized option mutation`);
  assert.match(mutation.localHash, /^[a-f0-9]{64}$/);
  assert.match(mutation.remoteBeforeHash, /^[a-f0-9]{64}$/);

  const redactedEvidence = redactEvidence({
    mutation: {
      resourceKey: mutation.resourceKey,
      value: mutation.value,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    },
  });
  const redactedJson = JSON.stringify(redactedEvidence);

  assertSerializedOptionRawValuesAbsent(testCase, shape, redactedJson);
  assert.equal(redactedEvidence.mutation.value.redaction, EVIDENCE_REDACTION_MARKER);
  assert.match(redactedEvidence.mutation.value.sha256, /^[a-f0-9]{64}$/);
}

function assertSerializedOptionRawValuesAbsent(testCase, shape, redactedJson) {
  for (const row of [shape.baseRow, shape.localRow, shape.remoteRow]) {
    assert.equal(
      redactedJson.includes(row.option_value),
      false,
      `${testCase.id} redacted evidence leaked serialized option payload`,
    );
  }
  assert.equal(redactedJson.includes('private_notes'), false, `${testCase.id} redacted evidence leaked private key`);
  assert.equal(redactedJson.includes('auth_token'), false, `${testCase.id} redacted evidence leaked token key`);
}

test('RPP-0146 wp_options serialized option changes variant 3 records redacted surface and invariant', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpOptionsSerializedChangesVariant3;

  assert.ok(coverage, 'missing wp_options serialized option changes variant 3 target coverage');
  assert.equal(coverage.family, 'wp-options-serialized-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-options-serialized-v3']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 3 target should include ready serialized option cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 3 target should include non-ready serialized option cases');
  assert.equal(report.summary.featureFamilies['wp-options-serialized-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-options-serialized-v3-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpOptionsSerializedChangesVariant3Evidence(coverage);
  const replayEvidence = generatedWpOptionsSerializedChangesVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0146 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 serialized option evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpOptionsSerializedChangesVariant3');
  assert.equal(firstEvidence.family, 'wp-options-serialized-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.serializedMutation.action, 'put');
  assert.equal(readyCase.serializedMutation.changeKind, 'update');
  assert.equal(readyCase.serializedMutation.plannedMutation, true);
  assert.equal(readyCase.serializedMutation.plannedPrecondition, true);
  assert.equal(readyCase.serializedMutation.appliedHash, readyCase.surface.option.localHash);
  assert.equal(
    readyCase.serializedMutation.preconditionExpectedHash,
    readyCase.serializedMutation.remoteBeforeHash,
  );
  assert.equal(readyCase.serializedMutation.redactedValue.redaction, EVIDENCE_REDACTION_MARKER);
  assert.match(readyCase.serializedMutation.redactedValue.sha256, /^[a-f0-9]{64}$/);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.option.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('base-private-serialized'), false, 'variant 3 evidence leaked base serialized payload');
  assert.equal(evidenceText.includes('local-private-serialized'), false, 'variant 3 evidence leaked local serialized payload');
  assert.equal(evidenceText.includes('remote-private-serialized'), false, 'variant 3 evidence leaked remote serialized payload');
  assert.equal(evidenceText.includes('ready-wp-options-serialized'), false, 'variant 3 evidence leaked ready serialized public label');
  assert.equal(evidenceText.includes('conflict-wp-options-serialized'), false, 'variant 3 evidence leaked conflict serialized public label');
  assert.equal(evidenceText.includes('private_notes'), false, 'variant 3 evidence leaked serialized private key');
  assert.equal(evidenceText.includes('auth_token'), false, 'variant 3 evidence leaked serialized token key');
});

function generatedWpOptionsSerializedChangesVariant3Evidence(targetCoverage) {
  return generatedWpOptionsSerializedChangesVariantEvidence(targetCoverage, {
    target: 'wpOptionsSerializedChangesVariant3',
    tag: 'wp-options-serialized-v3',
    label: 'variant 3',
  });
}

test('RPP-0166 wp_options serialized option changes variant 4 retains focused ready and non-ready regression coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpOptionsSerializedChangesVariant4;

  assert.ok(coverage, 'missing wp_options serialized option changes variant 4 target coverage');
  assert.equal(coverage.family, 'wp-options-serialized-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-options-serialized-v4']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready serialized option cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready serialized option cases');
  assert.equal(report.summary.featureFamilies['wp-options-serialized-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-options-serialized-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpOptionsSerializedChangesVariant4Evidence(coverage);
  const replayEvidence = generatedWpOptionsSerializedChangesVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0166 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 serialized option evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpOptionsSerializedChangesVariant4');
  assert.equal(firstEvidence.family, 'wp-options-serialized-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.ok(readyCase.tags.includes('wp-options-serialized-v4'));
  assert.ok(readyCase.tags.includes('wp-options-serialized-v4-ready'));
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.serializedMutation.action, 'put');
  assert.equal(readyCase.serializedMutation.changeKind, 'update');
  assert.equal(readyCase.serializedMutation.plannedMutation, true);
  assert.equal(readyCase.serializedMutation.plannedPrecondition, true);
  assert.equal(readyCase.serializedMutation.appliedHash, readyCase.surface.option.localHash);
  assert.equal(
    readyCase.serializedMutation.preconditionExpectedHash,
    readyCase.serializedMutation.remoteBeforeHash,
  );
  assert.equal(readyCase.serializedMutation.redactedValue.redaction, EVIDENCE_REDACTION_MARKER);
  assert.match(readyCase.serializedMutation.redactedValue.sha256, /^[a-f0-9]{64}$/);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.ok(nonReadyCase.tags.includes('wp-options-serialized-v4'));
  assert.ok(nonReadyCase.tags.includes('wp-options-serialized-v4-non-ready'));
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.option.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('base-private-serialized'), false, 'variant 4 evidence leaked base serialized payload');
  assert.equal(evidenceText.includes('local-private-serialized'), false, 'variant 4 evidence leaked local serialized payload');
  assert.equal(evidenceText.includes('remote-private-serialized'), false, 'variant 4 evidence leaked remote serialized payload');
  assert.equal(evidenceText.includes('ready-wp-options-serialized'), false, 'variant 4 evidence leaked ready serialized public label');
  assert.equal(evidenceText.includes('conflict-wp-options-serialized'), false, 'variant 4 evidence leaked conflict serialized public label');
  assert.equal(evidenceText.includes('private_notes'), false, 'variant 4 evidence leaked serialized private key');
  assert.equal(evidenceText.includes('auth_token'), false, 'variant 4 evidence leaked serialized token key');
});

function generatedWpOptionsSerializedChangesVariant4Evidence(targetCoverage) {
  return generatedWpOptionsSerializedChangesVariantEvidence(targetCoverage, {
    target: 'wpOptionsSerializedChangesVariant4',
    tag: 'wp-options-serialized-v4',
    label: 'variant 4',
  });
}

function generatedWpOptionsSerializedChangesVariantEvidence(targetCoverage, { target, tag, label }) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has(tag)) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedWpOptionsSerializedChangesVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, `${label} serialized option target recount should match summary tiers`);
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, `${label} serialized option target recount should match summary statuses`);
  assert.equal(totalCases, targetCoverage.total, `${label} serialized option target recount should match summary total`);
  assert.ok(selectedCases.has('ready'), `${label} target should select one ready serialized option case`);
  assert.ok(selectedCases.has('non-ready'), `${label} target should select one non-ready serialized option case`);

  return {
    target,
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

function generatedWpOptionsSerializedChangesVariant3CaseEvidence(testCase, result) {
  const conflict = testCase.family === 'wp-options-serialized-conflict';
  const shape = wpOptionsSerializedVariant3Shape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = wpOptionsSerializedVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    valueKind: shape.valueKind,
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const serializedMutation = wpOptionsSerializedVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    const caseEvidence = {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      serializedMutation,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        serializedMutation,
      })}`,
    };
    assertSerializedOptionRawValuesAbsent(testCase, shape, JSON.stringify(caseEvidence));
    return caseEvidence;
  }

  assert.equal(conflict, true, `${testCase.id} non-ready serialized option evidence should come from conflict family`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const conflictEvidence = wpOptionsSerializedVariant3ConflictEvidence({ testCase, plan, shape });
  const refusal = wpOptionsSerializedVariant3RefusalEvidence(testCase, plan, shape);
  const caseEvidence = {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictEvidence,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictEvidence,
      refusal,
    })}`,
  };
  assertSerializedOptionRawValuesAbsent(testCase, shape, JSON.stringify(caseEvidence));
  return caseEvidence;
}

function wpOptionsSerializedVariant3Shape(testCase, { conflict = false } = {}) {
  const serializedRows = Object.entries(testCase.base.db.wp_options)
    .filter(([id, row]) => id.startsWith('option_name:generated_serialized_')
      && isSerializedOptionValue(row.option_value));

  assert.equal(serializedRows.length, 1, `${testCase.id} should seed one serialized option row`);
  const [rowId, baseRow] = serializedRows[0];
  const localRow = testCase.local.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];
  const valueKind = serializedOptionVariant3ValueKind(baseRow.option_value);

  assert.ok(localRow, `${testCase.id} missing local serialized option row`);
  assert.ok(remoteRow, `${testCase.id} missing remote serialized option row`);
  assert.equal(localRow.__pluginOwner, undefined, `${testCase.id} serialized option should not be plugin-owned`);
  assert.equal(remoteRow.__pluginOwner, undefined, `${testCase.id} serialized option should not be plugin-owned`);
  assert.equal(baseRow.autoload, 'no');
  assert.equal(localRow.option_name, baseRow.option_name);
  assert.equal(serializedOptionVariant3ValueKind(localRow.option_value), valueKind);
  assert.ok(isSerializedOptionValue(localRow.option_value), `${testCase.id} local option_value must stay serialized`);
  assert.notEqual(localRow.option_value, baseRow.option_value, `${testCase.id} local serialized option should change`);

  if (conflict) {
    assert.equal(serializedOptionVariant3ValueKind(remoteRow.option_value), valueKind);
    assert.notEqual(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote serialized option should drift`);
    assert.notEqual(remoteRow.option_value, localRow.option_value, `${testCase.id} remote drift should differ from local`);
  } else {
    assert.equal(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote serialized option should stay at base`);
  }

  return {
    rowId,
    resource: rowResource('wp_options', rowId),
    resourceKey: rowResourceKey('wp_options', rowId),
    valueKind,
    autoload: baseRow.autoload,
    baseRow,
    localRow,
    remoteRow,
  };
}

function serializedOptionVariant3ValueKind(value) {
  const match = String(value).match(/s:5:"shape";s:(?:5|6):"(object|array)";/);
  assert.ok(match, 'serialized option variant 3 value should record object or array shape');
  return match[1];
}

function wpOptionsSerializedVariant3SurfaceEvidence(testCase, shape) {
  return {
    option: {
      resourceKey: shape.resourceKey,
      baseHash: resourceHash(testCase.base, shape.resource),
      localHash: resourceHash(testCase.local, shape.resource),
      remoteHash: resourceHash(testCase.remote, shape.resource),
      valueKind: shape.valueKind,
      autoload: shape.autoload,
      pluginOwned: false,
      evidenceMode: 'hash-only',
    },
  };
}

function wpOptionsSerializedVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === shape.resourceKey);
  const localHash = resourceHash(testCase.local, shape.resource);
  const appliedHash = resourceHash(applied.site, shape.resource);

  assert.ok(mutation, `${testCase.id} should plan a serialized option mutation for ${shape.resourceKey}`);
  assert.ok(precondition, `${testCase.id} should precondition ${shape.resourceKey}`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(appliedHash, localHash, `${testCase.id} did not apply local serialized option value`);

  const redactedEvidence = redactEvidence({
    mutation: {
      value: mutation.value,
    },
  });
  const redactedValue = redactedEvidence.mutation.value;
  const redactedJson = JSON.stringify(redactedEvidence);

  assert.equal(redactedValue.redaction, EVIDENCE_REDACTION_MARKER);
  assert.match(redactedValue.sha256, /^[a-f0-9]{64}$/);
  assertSerializedOptionRawValuesAbsent(testCase, shape, redactedJson);

  return {
    resourceKey: shape.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    appliedHash,
    plannedMutation: true,
    plannedPrecondition: true,
    redactedValue: {
      redaction: redactedValue.redaction,
      sha256: redactedValue.sha256,
      valueType: redactedValue.valueType,
    },
    mutationHash: `sha256:${digest({
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      redactedValueSha256: redactedValue.sha256,
    })}`,
  };
}

function wpOptionsSerializedVariant3ConflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.resourceKey);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.resourceKey);

  assert.ok(conflict, `${testCase.id} should report a serialized option conflict for ${shape.resourceKey}`);
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted serialized option mutation`);
  assertSerializedOptionRawValuesAbsent(testCase, shape, JSON.stringify(redactEvidence({ conflict })));

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    change: conflict.change,
    plannedMutation,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function wpOptionsSerializedVariant3RefusalEvidence(testCase, plan, shape) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);
  const redactedDetails = redactEvidence(error.details);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);
  assertSerializedOptionRawValuesAbsent(testCase, shape, JSON.stringify(redactedDetails));

  return {
    code: error.code,
    detailsHash: `sha256:${digest(redactedDetails)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

test('RPP-0107/RPP-0127 wp_posts create/update/delete target exposes per-tier ready and stale replay coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpPostsCreateUpdateDelete;

  assert.ok(coverage, 'missing wp_posts create/update/delete target coverage');
  assert.equal(coverage.family, 'wp-posts-create-update-delete-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-posts-create-update-delete']);
  assert.equal(coverage.statuses.ready, 10, 'target should include one ready wp_posts case per tier');
  assert.equal(coverage.statuses.conflict, 10, 'target should include one conflicting wp_posts case per tier');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(Object.values(coverage.perTier), Array(10).fill(2));
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-posts-create-update-delete-ready');
  const conflictCases = cases.filter((testCase) => testCase.family === 'wp-posts-create-update-delete-conflict');

  assert.equal(readyCases.length, 10, 'missing one ready wp_posts create/update/delete case per tier');
  assert.equal(conflictCases.length, 10, 'missing one conflicting wp_posts create/update/delete case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(conflictCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    assertWpPostsCreateUpdateDeleteShape(readyCase, { conflict: false });
    const ready = validateGeneratedCase(readyCase);
    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 3, 'ready wp_posts case should create, update, and delete rows');
    assert.equal(ready.applied, true, 'ready wp_posts case should apply through the harness');
    assert.equal(ready.unplannedRemotePreserved, true, 'ready wp_posts apply should preserve unplanned remote data');
    assert.equal(ready.staleReplayRejected, true, 'ready wp_posts case should reject stale replay');
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  }

  for (const conflictCase of conflictCases) {
    assertWpPostsCreateUpdateDeleteShape(conflictCase, { conflict: true });
    const conflict = validateGeneratedCase(conflictCase);
    assert.equal(conflict.status, 'conflict');
    assert.ok(conflict.conflicts >= 1, 'remote wp_posts drift should be a conflict');
    assert.equal(conflict.applied, false, 'conflicting wp_posts case must not apply mutations');
  }
});

function assertWpPostsCreateUpdateDeleteShape(testCase, { conflict }) {
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

  const [updateRowId, localUpdateRow] = updateRows[0];
  const [, deleteBaseRow] = deleteRows[0];
  assert.equal(
    testCase.remote.db.wp_posts[deleteRows[0][0]].post_title,
    deleteBaseRow.post_title,
    `${testCase.id} should not mutate the deleted row remotely before apply`,
  );
  assert.equal(
    testCase.remote.db.wp_posts[`ID:${createRows[0][1].ID}`],
    undefined,
    `${testCase.id} created row should be local-only before apply`,
  );

  if (conflict) {
    assert.notEqual(
      testCase.remote.db.wp_posts[updateRowId].post_title,
      testCase.base.db.wp_posts[updateRowId].post_title,
      `${testCase.id} conflict case should drift the updated post remotely`,
    );
    assert.notEqual(
      testCase.remote.db.wp_posts[updateRowId].post_title,
      localUpdateRow.post_title,
      `${testCase.id} conflict case remote value should differ from local`,
    );
    return;
  }

  assert.deepEqual(
    testCase.remote.db.wp_posts[updateRowId],
    testCase.base.db.wp_posts[updateRowId],
    `${testCase.id} ready case remote updated post should match base before apply`,
  );
}

test('RPP-0147 wp_posts create/update/delete variant 3 records per-tier surface coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpPostsCreateUpdateDeleteVariant3;

  assert.ok(coverage, 'missing wp_posts create/update/delete variant 3 target coverage');
  assert.equal(coverage.family, 'wp-posts-create-update-delete-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-posts-create-update-delete-v3']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 3 target should include ready wp_posts cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 3 target should include non-ready wp_posts cases');
  assert.equal(report.summary.featureFamilies['wp-posts-create-update-delete-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-posts-create-update-delete-v3-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpPostsCreateUpdateDeleteVariant3Evidence(coverage);
  const replayEvidence = generatedWpPostsCreateUpdateDeleteVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0147 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 wp_posts evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpPostsCreateUpdateDeleteVariant3');
  assert.equal(firstEvidence.family, 'wp-posts-create-update-delete-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 1, delete: 1, update: 1 });
  assert.equal(readyCase.postMutations.create.changeKind, 'create');
  assert.equal(readyCase.postMutations.update.changeKind, 'update');
  assert.equal(readyCase.postMutations.delete.changeKind, 'delete');
  assert.equal(readyCase.postMutations.create.plannedMutation, true);
  assert.equal(readyCase.postMutations.update.plannedPrecondition, true);
  assert.equal(readyCase.postMutations.delete.appliedHash, readyCase.surface.delete.localHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.update.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated wp_posts create'), false, 'variant 3 evidence leaked created post title');
  assert.equal(evidenceText.includes('Generated wp_posts update'), false, 'variant 3 evidence leaked updated post title');
  assert.equal(evidenceText.includes('Base wp_posts delete'), false, 'variant 3 evidence leaked deleted post title');
  assert.equal(evidenceText.includes('Remote concurrent wp_posts update'), false, 'variant 3 evidence leaked remote drift title');
});

test('RPP-0167 wp_posts create/update/delete variant 4 exposes per-tier generated coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpPostsCreateUpdateDeleteVariant4;

  assert.ok(coverage, 'missing wp_posts create/update/delete variant 4 target coverage');
  assert.equal(coverage.family, 'wp-posts-create-update-delete-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-posts-create-update-delete-v4']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready wp_posts cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready wp_posts cases');
  assert.equal(report.summary.featureFamilies['wp-posts-create-update-delete-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-posts-create-update-delete-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpPostsCreateUpdateDeleteVariant4Evidence(coverage);
  const replayEvidence = generatedWpPostsCreateUpdateDeleteVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0167 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 wp_posts evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpPostsCreateUpdateDeleteVariant4');
  assert.equal(firstEvidence.family, 'wp-posts-create-update-delete-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes('wp-posts-create-update-delete-v4-ready'));
  assert.ok(nonReadyCase.tags.includes('wp-posts-create-update-delete-v4-non-ready'));
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 1, delete: 1, update: 1 });
  assert.equal(readyCase.postMutations.create.changeKind, 'create');
  assert.equal(readyCase.postMutations.update.changeKind, 'update');
  assert.equal(readyCase.postMutations.delete.changeKind, 'delete');
  assert.equal(readyCase.postMutations.create.plannedPrecondition, true);
  assert.equal(readyCase.postMutations.update.plannedPrecondition, true);
  assert.equal(readyCase.postMutations.delete.plannedPrecondition, true);
  assert.equal(readyCase.postMutations.create.appliedHash, readyCase.surface.create.localHash);
  assert.equal(readyCase.postMutations.update.appliedHash, readyCase.surface.update.localHash);
  assert.equal(readyCase.postMutations.delete.appliedHash, readyCase.surface.delete.localHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.update.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated wp_posts create'), false, 'variant 4 evidence leaked created post title');
  assert.equal(evidenceText.includes('Generated wp_posts update'), false, 'variant 4 evidence leaked updated post title');
  assert.equal(evidenceText.includes('Base wp_posts delete'), false, 'variant 4 evidence leaked deleted post title');
  assert.equal(evidenceText.includes('Remote concurrent wp_posts update'), false, 'variant 4 evidence leaked remote drift title');
});

function generatedWpPostsCreateUpdateDeleteVariant3Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('wp-posts-create-update-delete-v3')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedWpPostsCreateUpdateDeleteVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 3 wp_posts target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 3 wp_posts target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 3 wp_posts target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 3 target should select one ready wp_posts case');
  assert.ok(selectedCases.has('non-ready'), 'variant 3 target should select one non-ready wp_posts case');

  return {
    target: 'wpPostsCreateUpdateDeleteVariant3',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

function generatedWpPostsCreateUpdateDeleteVariant4Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('wp-posts-create-update-delete-v4')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedWpPostsCreateUpdateDeleteVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 4 wp_posts target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 4 wp_posts target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 4 wp_posts target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 4 target should select one ready wp_posts case');
  assert.ok(selectedCases.has('non-ready'), 'variant 4 target should select one non-ready wp_posts case');

  return {
    target: 'wpPostsCreateUpdateDeleteVariant4',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

function generatedWpPostsCreateUpdateDeleteVariant3CaseEvidence(testCase, result) {
  const conflict = testCase.family === 'wp-posts-create-update-delete-conflict';
  const shape = wpPostsCreateUpdateDeleteVariant3Shape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = wpPostsCreateUpdateDeleteVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    postTypes: shape.postTypes,
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const { plannedChangeKinds, postMutations } = wpPostsCreateUpdateDeleteVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      postMutations,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        postMutations,
      })}`,
    };
  }

  assert.equal(conflict, true, `${testCase.id} non-ready wp_posts evidence should come from conflict family`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const conflictEvidence = wpPostsCreateUpdateDeleteVariant3ConflictEvidence({ testCase, plan, shape });
  const refusal = wpPostsCreateUpdateDeleteVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictEvidence,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictEvidence,
      refusal,
    })}`,
  };
}

function wpPostsCreateUpdateDeleteVariant3Shape(testCase, { conflict = false } = {}) {
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

  const [createRowId, createRow] = createRows[0];
  const [updateRowId, updateRow] = updateRows[0];
  const [deleteRowId, deleteRow] = deleteRows[0];

  assert.equal(createRowId, `ID:${createRow.ID}`, `${testCase.id} created row id should match row key`);
  assert.equal(updateRowId, `ID:${updateRow.ID}`, `${testCase.id} updated row id should match row key`);
  assert.equal(deleteRowId, `ID:${deleteRow.ID}`, `${testCase.id} deleted row id should match row key`);
  assert.equal(createRow.post_type, 'post');
  assert.equal(updateRow.post_type, 'page');
  assert.equal(deleteRow.post_type, 'post');

  if (conflict) {
    assert.match(testCase.remote.db.wp_posts[updateRowId].post_title, /^Remote concurrent wp_posts update /);
    assert.notEqual(
      testCase.remote.db.wp_posts[updateRowId].post_title,
      updateRow.post_title,
      `${testCase.id} conflict remote title should differ from local update`,
    );
  } else {
    assert.deepEqual(
      testCase.remote.db.wp_posts[updateRowId],
      testCase.base.db.wp_posts[updateRowId],
      `${testCase.id} ready update row should not drift remotely`,
    );
  }

  return {
    createResource: rowResource('wp_posts', createRowId),
    createResourceKey: rowResourceKey('wp_posts', createRowId),
    updateResource: rowResource('wp_posts', updateRowId),
    updateResourceKey: rowResourceKey('wp_posts', updateRowId),
    deleteResource: rowResource('wp_posts', deleteRowId),
    deleteResourceKey: rowResourceKey('wp_posts', deleteRowId),
    postTypes: {
      create: createRow.post_type,
      update: updateRow.post_type,
      delete: deleteRow.post_type,
    },
  };
}

function wpPostsCreateUpdateDeleteVariant3SurfaceEvidence(testCase, shape) {
  return Object.fromEntries([
    ['create', shape.createResource],
    ['update', shape.updateResource],
    ['delete', shape.deleteResource],
  ].map(([label, resource]) => [
    label,
    {
      resourceKey: resource.key,
      baseHash: resourceHash(testCase.base, resource),
      localHash: resourceHash(testCase.local, resource),
      remoteHash: resourceHash(testCase.remote, resource),
      postType: shape.postTypes[label],
    },
  ]));
}

function wpPostsCreateUpdateDeleteVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { label: 'create', resource: shape.createResource, resourceKey: shape.createResourceKey, changeKind: 'create' },
    { label: 'update', resource: shape.updateResource, resourceKey: shape.updateResourceKey, changeKind: 'update' },
    { label: 'delete', resource: shape.deleteResource, resourceKey: shape.deleteResourceKey, changeKind: 'delete' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};
  const postMutations = {};

  for (const { label, resource, resourceKey, changeKind } of expected) {
    const mutation = mutations.get(resourceKey);
    const precondition = preconditions.get(resourceKey);
    const localHash = resourceHash(testCase.local, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.ok(mutation, `${testCase.id} should plan ${changeKind} mutation for ${resourceKey}`);
    assert.ok(precondition, `${testCase.id} should precondition ${resourceKey}`);
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(appliedHash, localHash, `${testCase.id} did not apply local wp_posts ${changeKind} for ${resourceKey}`);
    incrementCount(plannedChangeKinds, changeKind);

    postMutations[label] = {
      resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      preconditionExpectedHash: precondition.expectedHash,
      appliedHash,
      plannedMutation: true,
      plannedPrecondition: true,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })}`,
    };
  }

  return {
    plannedChangeKinds: sortStringObject(plannedChangeKinds),
    postMutations,
  };
}

function wpPostsCreateUpdateDeleteVariant3ConflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.updateResourceKey);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.updateResourceKey);

  assert.ok(conflict, `${testCase.id} should report a wp_posts update conflict for ${shape.updateResourceKey}`);
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted wp_posts update mutation`);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    change: conflict.change,
    plannedMutation,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function wpPostsCreateUpdateDeleteVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

test('RPP-0108/RPP-0128 wp_postmeta create/update/delete target exposes per-tier ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpPostmetaCreateUpdateDelete;

  assert.ok(coverage, 'missing wp_postmeta create/update/delete target coverage');
  assert.equal(coverage.family, 'wp-postmeta-create-update-delete-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-postmeta-create-update-delete']);
  assert.equal(coverage.statuses.ready, 10, 'target should include one ready wp_postmeta case per tier');
  assert.equal(coverage.statuses.conflict, 10, 'target should include one conflicting wp_postmeta case per tier');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(Object.values(coverage.perTier), Array(10).fill(2));
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-postmeta-create-update-delete-ready');
  const conflictCases = cases.filter((testCase) => testCase.family === 'wp-postmeta-create-update-delete-conflict');

  assert.equal(readyCases.length, 10, 'missing one ready wp_postmeta create/update/delete case per tier');
  assert.equal(conflictCases.length, 10, 'missing one conflicting wp_postmeta create/update/delete case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(conflictCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    assertWpPostmetaCreateUpdateDeleteShape(readyCase, { conflict: false });
    const ready = validateGeneratedCase(readyCase);
    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 3, 'ready wp_postmeta case should create, update, and delete rows');
    assert.equal(ready.applied, true, 'ready wp_postmeta case should apply through the harness');
    assert.equal(ready.unplannedRemotePreserved, true, 'ready wp_postmeta apply should preserve unplanned remote data');
    assert.equal(ready.staleReplayRejected, true, 'ready wp_postmeta stale replay should be rejected');
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  }

  for (const conflictCase of conflictCases) {
    assertWpPostmetaCreateUpdateDeleteShape(conflictCase, { conflict: true });
    const conflict = validateGeneratedCase(conflictCase);
    assert.equal(conflict.status, 'conflict');
    assert.ok(conflict.conflicts >= 1, 'remote wp_postmeta drift should be a conflict');
    assert.equal(conflict.applied, false, 'conflicting wp_postmeta case must not apply mutations');
  }
});

function assertWpPostmetaCreateUpdateDeleteShape(testCase, { conflict }) {
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

  const [, createRow] = createRows[0];
  const [updateRowId, localUpdateRow] = updateRows[0];
  const [deleteRowId, deleteBaseRow] = deleteRows[0];
  assert.ok(testCase.base.db.wp_posts[`ID:${createRow.post_id}`], `${testCase.id} should keep the meta parent post in base`);
  assert.equal(
    testCase.remote.db.wp_postmeta[deleteRowId].meta_value,
    deleteBaseRow.meta_value,
    `${testCase.id} should not mutate the deleted meta row remotely before apply`,
  );
  assert.equal(
    testCase.remote.db.wp_postmeta[`meta_id:${createRow.meta_id}`],
    undefined,
    `${testCase.id} created meta row should be local-only before apply`,
  );

  if (conflict) {
    assert.notEqual(
      testCase.remote.db.wp_postmeta[updateRowId].meta_value,
      testCase.base.db.wp_postmeta[updateRowId].meta_value,
      `${testCase.id} conflict case should drift the updated meta row remotely`,
    );
    assert.notEqual(
      testCase.remote.db.wp_postmeta[updateRowId].meta_value,
      localUpdateRow.meta_value,
      `${testCase.id} conflict case remote value should differ from local`,
    );
    return;
  }

  assert.deepEqual(
    testCase.remote.db.wp_postmeta[updateRowId],
    testCase.base.db.wp_postmeta[updateRowId],
    `${testCase.id} ready case remote updated meta row should match base before apply`,
  );
}

test('RPP-0148 wp_postmeta create/update/delete variant 3 records per-tier surface coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpPostmetaCreateUpdateDeleteVariant3;

  assert.ok(coverage, 'missing wp_postmeta create/update/delete variant 3 target coverage');
  assert.equal(coverage.family, 'wp-postmeta-create-update-delete-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-postmeta-create-update-delete-v3']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 3 target should include ready wp_postmeta cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 3 target should include non-ready wp_postmeta cases');
  assert.equal(report.summary.featureFamilies['wp-postmeta-create-update-delete-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-postmeta-create-update-delete-v3-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpPostmetaCreateUpdateDeleteVariant3Evidence(coverage);
  const replayEvidence = generatedWpPostmetaCreateUpdateDeleteVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0148 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 wp_postmeta evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpPostmetaCreateUpdateDeleteVariant3');
  assert.equal(firstEvidence.family, 'wp-postmeta-create-update-delete-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 1, delete: 1, update: 1 });
  assert.equal(readyCase.postmetaMutations.create.changeKind, 'create');
  assert.equal(readyCase.postmetaMutations.update.changeKind, 'update');
  assert.equal(readyCase.postmetaMutations.delete.changeKind, 'delete');
  assert.equal(readyCase.postmetaMutations.create.plannedMutation, true);
  assert.equal(readyCase.postmetaMutations.update.plannedPrecondition, true);
  assert.equal(readyCase.postmetaMutations.delete.appliedHash, readyCase.surface.delete.localHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.update.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('generated wp_postmeta create'), false, 'variant 3 evidence leaked created meta value');
  assert.equal(evidenceText.includes('generated wp_postmeta update'), false, 'variant 3 evidence leaked updated meta value');
  assert.equal(evidenceText.includes('base postmeta update'), false, 'variant 3 evidence leaked base update meta value');
  assert.equal(evidenceText.includes('base postmeta delete'), false, 'variant 3 evidence leaked deleted meta value');
  assert.equal(evidenceText.includes('remote concurrent wp_postmeta update'), false, 'variant 3 evidence leaked remote drift value');
});

test('RPP-0168 wp_postmeta create/update/delete variant 4 applies ready changes without unplanned overwrite', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpPostmetaCreateUpdateDeleteVariant4;

  assert.ok(coverage, 'missing wp_postmeta create/update/delete variant 4 target coverage');
  assert.equal(coverage.family, 'wp-postmeta-create-update-delete-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-postmeta-create-update-delete-v4']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready wp_postmeta cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready wp_postmeta cases');
  assert.equal(report.summary.featureFamilies['wp-postmeta-create-update-delete-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-postmeta-create-update-delete-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpPostmetaCreateUpdateDeleteVariant4Evidence(coverage);
  const replayEvidence = generatedWpPostmetaCreateUpdateDeleteVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0168 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 wp_postmeta evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpPostmetaCreateUpdateDeleteVariant4');
  assert.equal(firstEvidence.family, 'wp-postmeta-create-update-delete-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.status),
    ['ready', 'conflict'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes('wp-postmeta-create-update-delete-v4-ready'));
  assert.ok(nonReadyCase.tags.includes('wp-postmeta-create-update-delete-v4-non-ready'));

  assert.equal(readyCase.variant, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 1, delete: 1, update: 1 });
  for (const change of ['create', 'update', 'delete']) {
    const mutation = readyCase.postmetaMutations[change];
    assert.equal(mutation.changeKind, change);
    assert.equal(mutation.plannedMutation, true);
    assert.equal(mutation.plannedPrecondition, true);
    assert.equal(mutation.appliedHash, readyCase.surface[change].localHash);
    assert.equal(mutation.preconditionExpectedHash, mutation.remoteBeforeHash);
  }
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.variant, 'non-ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.conflict.resourceKey, nonReadyCase.surface.update.resourceKey);
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.match(nonReadyCase.conflict.conflictHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('generated wp_postmeta create'), false, 'variant 4 evidence leaked created meta value');
  assert.equal(evidenceText.includes('generated wp_postmeta update'), false, 'variant 4 evidence leaked updated meta value');
  assert.equal(evidenceText.includes('base postmeta update'), false, 'variant 4 evidence leaked base update meta value');
  assert.equal(evidenceText.includes('base postmeta delete'), false, 'variant 4 evidence leaked deleted meta value');
  assert.equal(evidenceText.includes('remote concurrent wp_postmeta update'), false, 'variant 4 evidence leaked remote drift value');
});

function generatedWpPostmetaCreateUpdateDeleteVariant3Evidence(targetCoverage) {
  return generatedWpPostmetaCreateUpdateDeleteVariantEvidence(targetCoverage, {
    target: 'wpPostmetaCreateUpdateDeleteVariant3',
    tag: 'wp-postmeta-create-update-delete-v3',
    label: 'variant 3',
  });
}

function generatedWpPostmetaCreateUpdateDeleteVariant4Evidence(targetCoverage) {
  return generatedWpPostmetaCreateUpdateDeleteVariantEvidence(targetCoverage, {
    target: 'wpPostmetaCreateUpdateDeleteVariant4',
    tag: 'wp-postmeta-create-update-delete-v4',
    label: 'variant 4',
  });
}

function generatedWpPostmetaCreateUpdateDeleteVariantEvidence(targetCoverage, { target, tag, label }) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has(tag)) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedWpPostmetaCreateUpdateDeleteVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, `${label} wp_postmeta target recount should match summary tiers`);
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, `${label} wp_postmeta target recount should match summary statuses`);
  assert.equal(totalCases, targetCoverage.total, `${label} wp_postmeta target recount should match summary total`);
  assert.ok(selectedCases.has('ready'), `${label} target should select one ready wp_postmeta case`);
  assert.ok(selectedCases.has('non-ready'), `${label} target should select one non-ready wp_postmeta case`);

  return {
    target,
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

function generatedWpPostmetaCreateUpdateDeleteVariant3CaseEvidence(testCase, result) {
  const conflict = testCase.family === 'wp-postmeta-create-update-delete-conflict';
  const shape = wpPostmetaCreateUpdateDeleteVariant3Shape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = wpPostmetaCreateUpdateDeleteVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    parentPostIds: shape.parentPostIds,
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const { plannedChangeKinds, postmetaMutations } = wpPostmetaCreateUpdateDeleteVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      postmetaMutations,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        postmetaMutations,
      })}`,
    };
  }

  assert.equal(conflict, true, `${testCase.id} non-ready wp_postmeta evidence should come from conflict family`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const conflictEvidence = wpPostmetaCreateUpdateDeleteVariant3ConflictEvidence({ testCase, plan, shape });
  const refusal = wpPostmetaCreateUpdateDeleteVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictEvidence,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictEvidence,
      refusal,
    })}`,
  };
}

function wpPostmetaCreateUpdateDeleteVariant3Shape(testCase, { conflict = false } = {}) {
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

  const [createRowId, createRow] = createRows[0];
  const [updateRowId, updateRow] = updateRows[0];
  const [deleteRowId, deleteRow] = deleteRows[0];

  assert.equal(createRowId, `meta_id:${createRow.meta_id}`, `${testCase.id} created meta row id should match row key`);
  assert.equal(updateRowId, `meta_id:${updateRow.meta_id}`, `${testCase.id} updated meta row id should match row key`);
  assert.equal(deleteRowId, `meta_id:${deleteRow.meta_id}`, `${testCase.id} deleted meta row id should match row key`);
  assert.ok(testCase.base.db.wp_posts[`ID:${createRow.post_id}`], `${testCase.id} should keep the created meta parent post in base`);
  assert.ok(testCase.base.db.wp_posts[`ID:${updateRow.post_id}`], `${testCase.id} should keep the updated meta parent post in base`);
  assert.ok(testCase.base.db.wp_posts[`ID:${deleteRow.post_id}`], `${testCase.id} should keep the deleted meta parent post in base`);
  assert.match(createRow.meta_key, /^_generated_postmeta_create_/);
  assert.match(updateRow.meta_key, /^_generated_postmeta_update_/);
  assert.match(deleteRow.meta_key, /^_generated_postmeta_delete_/);

  if (conflict) {
    assert.match(testCase.remote.db.wp_postmeta[updateRowId].meta_value, /^remote concurrent wp_postmeta update /);
    assert.notEqual(
      testCase.remote.db.wp_postmeta[updateRowId].meta_value,
      updateRow.meta_value,
      `${testCase.id} conflict remote meta value should differ from local update`,
    );
  } else {
    assert.deepEqual(
      testCase.remote.db.wp_postmeta[updateRowId],
      testCase.base.db.wp_postmeta[updateRowId],
      `${testCase.id} ready update meta row should not drift remotely`,
    );
  }

  return {
    createResource: rowResource('wp_postmeta', createRowId),
    createResourceKey: rowResourceKey('wp_postmeta', createRowId),
    updateResource: rowResource('wp_postmeta', updateRowId),
    updateResourceKey: rowResourceKey('wp_postmeta', updateRowId),
    deleteResource: rowResource('wp_postmeta', deleteRowId),
    deleteResourceKey: rowResourceKey('wp_postmeta', deleteRowId),
    parentPostIds: {
      create: createRow.post_id,
      update: updateRow.post_id,
      delete: deleteRow.post_id,
    },
    metaKeyHashes: {
      create: `sha256:${digest(createRow.meta_key)}`,
      update: `sha256:${digest(updateRow.meta_key)}`,
      delete: `sha256:${digest(deleteRow.meta_key)}`,
    },
  };
}

function wpPostmetaCreateUpdateDeleteVariant3SurfaceEvidence(testCase, shape) {
  return Object.fromEntries([
    ['create', shape.createResource],
    ['update', shape.updateResource],
    ['delete', shape.deleteResource],
  ].map(([label, resource]) => [
    label,
    {
      resourceKey: resource.key,
      baseHash: resourceHash(testCase.base, resource),
      localHash: resourceHash(testCase.local, resource),
      remoteHash: resourceHash(testCase.remote, resource),
      parentPostId: shape.parentPostIds[label],
      metaKeyHash: shape.metaKeyHashes[label],
    },
  ]));
}

function wpPostmetaCreateUpdateDeleteVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { label: 'create', resource: shape.createResource, resourceKey: shape.createResourceKey, changeKind: 'create' },
    { label: 'update', resource: shape.updateResource, resourceKey: shape.updateResourceKey, changeKind: 'update' },
    { label: 'delete', resource: shape.deleteResource, resourceKey: shape.deleteResourceKey, changeKind: 'delete' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};
  const postmetaMutations = {};

  for (const { label, resource, resourceKey, changeKind } of expected) {
    const mutation = mutations.get(resourceKey);
    const precondition = preconditions.get(resourceKey);
    const localHash = resourceHash(testCase.local, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.ok(mutation, `${testCase.id} should plan ${changeKind} mutation for ${resourceKey}`);
    assert.ok(precondition, `${testCase.id} should precondition ${resourceKey}`);
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(appliedHash, localHash, `${testCase.id} did not apply local wp_postmeta ${changeKind} for ${resourceKey}`);
    incrementCount(plannedChangeKinds, changeKind);

    postmetaMutations[label] = {
      resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      preconditionExpectedHash: precondition.expectedHash,
      appliedHash,
      plannedMutation: true,
      plannedPrecondition: true,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })}`,
    };
  }

  return {
    plannedChangeKinds: sortStringObject(plannedChangeKinds),
    postmetaMutations,
  };
}

function wpPostmetaCreateUpdateDeleteVariant3ConflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.updateResourceKey);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.updateResourceKey);

  assert.ok(conflict, `${testCase.id} should report a wp_postmeta update conflict for ${shape.updateResourceKey}`);
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted wp_postmeta update mutation`);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    change: conflict.change,
    plannedMutation,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function wpPostmetaCreateUpdateDeleteVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

test('RPP-0110/RPP-0130 wp_comments/wp_commentmeta graph target exposes per-tier ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpCommentsCommentmetaGraph;

  assert.ok(coverage, 'missing wp_comments/wp_commentmeta graph target coverage');
  assert.equal(coverage.family, 'wp-comments-commentmeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-comments-commentmeta-graph']);
  assert.equal(coverage.total, 20, 'target should include ready and stale cases for every tier');
  assert.equal(coverage.statuses.ready, 10, 'target should include one ready comment/commentmeta graph per tier');
  assert.equal(nonReadyTargetCount(coverage), 10, 'target should include one stale comment/commentmeta graph per tier');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(Object.values(coverage.perTier), Array(10).fill(2));
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const summaryEvidence = JSON.stringify(report);
  assert.equal(summaryEvidence.includes('generated commentmeta graph '), false);
  assert.equal(summaryEvidence.includes('Remote stale comment graph target'), false);

  const cases = generatePushHarnessCases();
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-ready');
  const staleCases = cases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-stale');

  assert.equal(readyCases.length, 10, 'missing one ready wp_comments/wp_commentmeta graph case per tier');
  assert.equal(staleCases.length, 10, 'missing one stale wp_comments/wp_commentmeta graph case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    assertCommentCommentmetaGraphShape(readyCase, { staleTarget: false });
    const ready = validateGeneratedCase(readyCase);
    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 2, 'ready graph should create comment and commentmeta rows');
    assert.equal(ready.applied, true, 'ready comment/commentmeta graph should apply through the harness');
    assert.equal(ready.unplannedRemotePreserved, true, 'ready graph should preserve unplanned remote data');
    assert.equal(ready.staleReplayRejected, true, 'ready comment/commentmeta graph should reject stale replay');
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  }

  for (const staleCase of staleCases) {
    assertCommentCommentmetaGraphShape(staleCase, { staleTarget: true });
    const stale = validateGeneratedCase(staleCase);
    assert.notEqual(stale.status, 'ready', 'stale graph should not be ready');
    assert.ok(stale.blockers >= 1, 'stale graph should record a graph identity blocker');
    assert.equal(stale.applied, false, 'stale graph must not apply mutations');
  }
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

  const [commentmetaRowId, commentmetaRow] = commentmetaRows[0];
  const commentId = staleTarget
    ? commentmetaRow.comment_id
    : commentRows[0][1].comment_ID;
  assert.equal(commentmetaRow.comment_id, commentId);
  assert.equal(testCase.base.db.wp_commentmeta[commentmetaRowId], undefined);
  assert.equal(testCase.remote.db.wp_commentmeta[commentmetaRowId], undefined);

  if (staleTarget) {
    const commentRowId = `comment_ID:${commentId}`;
    assert.ok(testCase.base.db.wp_comments[commentRowId], `${testCase.id} stale target should exist in base`);
    assert.deepEqual(
      testCase.local.db.wp_comments[commentRowId],
      testCase.base.db.wp_comments[commentRowId],
      `${testCase.id} stale target should be unchanged locally`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_comments[commentRowId],
      testCase.base.db.wp_comments[commentRowId],
      `${testCase.id} stale target should drift remotely`,
    );
    return;
  }

  const commentRowId = `comment_ID:${commentId}`;
  assert.equal(testCase.base.db.wp_comments[commentRowId], undefined);
  assert.equal(testCase.remote.db.wp_comments[commentRowId], undefined);
}

test('RPP-0109/RPP-0129 wp_users/wp_usermeta graph target exposes ready, stale, and redacted coverage', () => {
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
  assert.equal(JSON.stringify(report).includes('local-private-usermeta-token'), false);
  assert.equal(JSON.stringify(report).includes('generated-private-user-pass'), false);

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'wp-users-usermeta-graph-ready');
  const staleCase = cases.find((testCase) => testCase.family === 'wp-users-usermeta-graph-stale');

  assert.ok(readyCase, 'missing ready wp_users/wp_usermeta graph case');
  assert.ok(staleCase, 'missing stale wp_users/wp_usermeta graph case');
  const readyShape = assertUserUsermetaGraphShape(readyCase, { staleTarget: false });
  const staleShape = assertUserUsermetaGraphShape(staleCase, { staleTarget: true });

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

  assertUsermetaGraphEvidenceRedacted(readyCase, readyShape);
  assertUsermetaGraphEvidenceRedacted(staleCase, staleShape);
});

function assertUserUsermetaGraphShape(testCase, { staleTarget }) {
  const userRows = Object.entries(testCase.local.db.wp_users)
    .filter(([id, row]) => !testCase.base.db.wp_users[id]
      && row.display_name.startsWith('Generated graph user ')
      && row.user_pass?.startsWith('generated-private-user-pass-'));
  const usermetaRows = Object.entries(testCase.local.db.wp_usermeta)
    .filter(([id, row]) => !testCase.base.db.wp_usermeta[id]
      && row.meta_key.startsWith('_generated_usermeta_graph_')
      && row.meta_value?.private_token?.startsWith('local-private-usermeta-token-'));

  assert.equal(userRows.length, staleTarget ? 0 : 1, `${testCase.id} ready graph should create one user`);
  assert.equal(usermetaRows.length, 1, `${testCase.id} should create one usermeta row`);

  const [metaRowId, usermetaRow] = usermetaRows[0];
  const userId = staleTarget ? usermetaRow.user_id : userRows[0][1].ID;
  const userRowId = `ID:${userId}`;
  assert.equal(usermetaRow.user_id, userId);
  assert.ok(testCase.local.db.wp_users[userRowId], `${testCase.id} should have the user target locally`);
  assert.equal(testCase.local.db.wp_users[userRowId].user_pass.startsWith('generated-private-user-pass-'), true);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_users[userRowId], `${testCase.id} stale target should exist in base`);
    assert.deepEqual(
      testCase.local.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale target should be unchanged locally`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale target should drift remotely`,
    );
  }

  return {
    userRowId,
    metaRowId,
    userRow: testCase.local.db.wp_users[userRowId],
    remoteUserRow: testCase.remote.db.wp_users[userRowId],
    usermetaRow,
  };
}

function assertUsermetaGraphEvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const userResourceKey = `row:${JSON.stringify(['wp_users', shape.userRowId])}`;
  const usermetaResourceKey = `row:${JSON.stringify(['wp_usermeta', shape.metaRowId])}`;
  const relatedMutations = plan.mutations.filter((mutation) =>
    mutation.resourceKey === userResourceKey || mutation.resourceKey === usermetaResourceKey);
  const relatedBlockers = plan.blockers.filter((blocker) =>
    blocker.resourceKey === usermetaResourceKey
    || blocker.references?.some((reference) => reference.targetResourceKey === userResourceKey));
  const relatedDecisions = plan.decisions.filter((decision) => decision.resourceKey === userResourceKey);

  for (const mutation of relatedMutations) {
    assert.match(mutation.localHash, /^[a-f0-9]{64}$/);
    assert.match(mutation.remoteBeforeHash, /^[a-f0-9]{64}$/);
  }

  if (plan.status === 'ready') {
    assert.equal(relatedMutations.length, 2, `${testCase.id} should mutate user and usermeta rows`);
  } else {
    assert.notEqual(plan.status, 'ready');
    assert.ok(relatedBlockers.length >= 1, `${testCase.id} should have usermeta graph blockers`);
  }

  const redacted = redactEvidence({
    status: plan.status,
    mutations: relatedMutations.map((mutation) => ({
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: mutation.change,
      value: mutation.value,
    })),
    blockers: relatedBlockers,
    decisions: relatedDecisions,
  });
  const redactedJson = JSON.stringify(redacted);

  if (relatedMutations.length > 0) {
    assert.ok(redactedJson.includes(EVIDENCE_REDACTION_MARKER), 'mutation values should be redacted in evidence');
    assert.ok(redactedJson.includes('sha256'), 'redacted mutation evidence should keep hashes');
  }
  assertUsermetaGraphRawValuesAbsent(testCase, shape, redactedJson);
}

function assertUsermetaGraphRawValuesAbsent(testCase, shape, redactedJson) {
  const values = [
    shape.userRow.user_pass,
    shape.userRow.user_activation_key,
    shape.remoteUserRow?.user_email,
    shape.remoteUserRow?.display_name,
    shape.remoteUserRow?.user_activation_key,
    shape.usermetaRow.meta_value.private_token,
    shape.usermetaRow.meta_value.private_notes,
    'generated-private-user-pass',
    'local-private-usermeta-token',
    'remote-private-user',
  ].filter(Boolean).map(String);

  for (const value of values) {
    assert.equal(
      redactedJson.includes(value),
      false,
      `${testCase.id} redacted evidence should not expose ${value}`,
    );
  }
}

test('RPP-0149 wp_users/wp_usermeta graph variant 3 records per-tier ready and stale non-ready coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpUsersUsermetaGraphVariant3;

  assert.ok(coverage, 'missing wp_users/wp_usermeta graph variant 3 target coverage');
  assert.equal(coverage.family, 'wp-users-usermeta-graph-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-users-usermeta-graph-v3']);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.statuses.ready, 10);
  assert.equal(nonReadyTargetCount(coverage), 10);
  assert.ok(coverage.statuses.ready > 0, 'variant 3 target should include ready user/usermeta graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 3 target should include non-ready stale graph cases');
  assert.equal(report.summary.featureFamilies['wp-users-usermeta-graph-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-users-usermeta-graph-v3-stale'], 10);
  assert.equal(report.summary.featureFamilies['wp-users-usermeta-graph-v3-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpUsersUsermetaGraphVariant3Evidence(coverage);
  const replayEvidence = generatedWpUsersUsermetaGraphVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0149 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 user/usermeta evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpUsersUsermetaGraphVariant3');
  assert.equal(firstEvidence.family, 'wp-users-usermeta-graph-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 2 });
  assert.equal(readyCase.graphMutations.user.changeKind, 'create');
  assert.equal(readyCase.graphMutations.usermeta.changeKind, 'create');
  assert.equal(readyCase.graphMutations.user.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.usermeta.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.user.appliedHash, readyCase.surface.user.localHash);
  assert.equal(readyCase.graphMutations.usermeta.appliedHash, readyCase.surface.usermeta.localHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.status, 'blocked');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.usermeta.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.user.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedMutation, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_usermeta.user_id']);
  assert.match(nonReadyCase.staleBlocker.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('generated-private-user-pass'), false, 'variant 3 evidence leaked user password');
  assert.equal(evidenceText.includes('generated-private-user-token'), false, 'variant 3 evidence leaked activation token');
  assert.equal(evidenceText.includes('local-private-usermeta-token'), false, 'variant 3 evidence leaked usermeta token');
  assert.equal(evidenceText.includes('local-private-usermeta-notes'), false, 'variant 3 evidence leaked usermeta notes');
  assert.equal(evidenceText.includes('remote-private-user-'), false, 'variant 3 evidence leaked remote user drift email');
  assert.equal(evidenceText.includes('Remote stale graph user'), false, 'variant 3 evidence leaked remote display name');
});

test('RPP-0169 wp_users/wp_usermeta graph variant 4 rejects stale replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpUsersUsermetaGraphVariant4;

  assert.ok(coverage, 'missing wp_users/wp_usermeta graph variant 4 target coverage');
  assert.equal(coverage.family, 'wp-users-usermeta-graph-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-users-usermeta-graph-v4']);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.statuses.ready, 10);
  assert.equal(nonReadyTargetCount(coverage), 10);
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready user/usermeta graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready stale graph cases');
  assert.equal(report.summary.featureFamilies['wp-users-usermeta-graph-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-users-usermeta-graph-v4-stale'], 10);
  assert.equal(report.summary.featureFamilies['wp-users-usermeta-graph-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpUsersUsermetaGraphVariant4Evidence(coverage);
  const replayEvidence = generatedWpUsersUsermetaGraphVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0169 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 user/usermeta evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpUsersUsermetaGraphVariant4');
  assert.equal(firstEvidence.family, 'wp-users-usermeta-graph-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.ok(readyCase.tags.includes('wp-users-usermeta-graph-v4'));
  assert.ok(readyCase.tags.includes('wp-users-usermeta-graph-v4-ready'));
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 2 });
  assert.equal(readyCase.graphMutations.user.changeKind, 'create');
  assert.equal(readyCase.graphMutations.usermeta.changeKind, 'create');
  assert.equal(readyCase.graphMutations.user.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.usermeta.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.user.appliedHash, readyCase.surface.user.localHash);
  assert.equal(readyCase.graphMutations.usermeta.appliedHash, readyCase.surface.usermeta.localHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.status, 'blocked');
  assert.ok(nonReadyCase.tags.includes('wp-users-usermeta-graph-v4'));
  assert.ok(nonReadyCase.tags.includes('wp-users-usermeta-graph-v4-non-ready'));
  assert.ok(nonReadyCase.tags.includes('wp-users-usermeta-graph-v4-stale'));
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.usermeta.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.user.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedMutation, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_usermeta.user_id']);
  assert.match(nonReadyCase.staleBlocker.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('generated-private-user-pass'), false, 'variant 4 evidence leaked user password');
  assert.equal(evidenceText.includes('generated-private-user-token'), false, 'variant 4 evidence leaked activation token');
  assert.equal(evidenceText.includes('local-private-usermeta-token'), false, 'variant 4 evidence leaked usermeta token');
  assert.equal(evidenceText.includes('local-private-usermeta-notes'), false, 'variant 4 evidence leaked usermeta notes');
  assert.equal(evidenceText.includes('remote-private-user-'), false, 'variant 4 evidence leaked remote user drift email');
  assert.equal(evidenceText.includes('Remote stale graph user'), false, 'variant 4 evidence leaked remote display name');
});

function generatedWpUsersUsermetaGraphVariant3Evidence(targetCoverage) {
  return generatedWpUsersUsermetaGraphVariantEvidence(targetCoverage, {
    target: 'wpUsersUsermetaGraphVariant3',
    tag: 'wp-users-usermeta-graph-v3',
    staleTag: 'wp-users-usermeta-graph-v3-stale',
    variantLabel: 'variant 3',
  });
}

function generatedWpUsersUsermetaGraphVariant4Evidence(targetCoverage) {
  return generatedWpUsersUsermetaGraphVariantEvidence(targetCoverage, {
    target: 'wpUsersUsermetaGraphVariant4',
    tag: 'wp-users-usermeta-graph-v4',
    staleTag: 'wp-users-usermeta-graph-v4-stale',
    variantLabel: 'variant 4',
  });
}

function generatedWpUsersUsermetaGraphVariantEvidence(targetCoverage, { target, tag, staleTag, variantLabel }) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has(tag)) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedWpUsersUsermetaGraphVariant3CaseEvidence(testCase, result, {
      staleTag,
      variantLabel,
    });
    const selectedKey = result.status === 'ready' ? 'ready' : 'stale-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, `${variantLabel} user/usermeta target recount should match summary tiers`);
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, `${variantLabel} user/usermeta target recount should match summary statuses`);
  assert.equal(totalCases, targetCoverage.total, `${variantLabel} user/usermeta target recount should match summary total`);
  assert.ok(selectedCases.has('ready'), `${variantLabel} target should select one ready user/usermeta case`);
  assert.ok(selectedCases.has('stale-non-ready'), `${variantLabel} target should select one stale non-ready user/usermeta case`);

  return {
    target,
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('stale-non-ready'),
    ],
  };
}

function generatedWpUsersUsermetaGraphVariant3CaseEvidence(testCase, result, {
  staleTag = 'wp-users-usermeta-graph-v3-stale',
  variantLabel = 'variant 3',
} = {}) {
  const staleTarget = testCase.tags.has(staleTag);
  assert.equal(
    staleTarget,
    testCase.family === 'wp-users-usermeta-graph-stale',
    `${testCase.id} ${variantLabel} stale tag should match stale graph family`,
  );
  const shape = assertUserUsermetaGraphShape(testCase, { staleTarget });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = wpUsersUsermetaGraphVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'stale-non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    assert.equal(staleTarget, false, `${testCase.id} ready evidence should not use stale graph target`);
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const { plannedChangeKinds, graphMutations } = wpUsersUsermetaGraphVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      graphMutations,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        graphMutations,
      })}`,
    };
  }

  assert.equal(staleTarget, true, `${testCase.id} non-ready evidence should use stale graph target`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const staleBlocker = wpUsersUsermetaGraphVariant3StaleBlockerEvidence({ testCase, plan, shape });
  const refusal = wpUsersUsermetaGraphVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    staleBlocker,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      staleBlocker,
      refusal,
    })}`,
  };
}

function wpUsersUsermetaGraphVariant3SurfaceEvidence(testCase, shape) {
  const userResource = rowResource('wp_users', shape.userRowId);
  const usermetaResource = rowResource('wp_usermeta', shape.metaRowId);

  return {
    user: {
      resourceKey: userResource.key,
      baseHash: resourceHash(testCase.base, userResource),
      localHash: resourceHash(testCase.local, userResource),
      remoteHash: resourceHash(testCase.remote, userResource),
      userIdHash: `sha256:${digest(shape.userRowId)}`,
    },
    usermeta: {
      resourceKey: usermetaResource.key,
      baseHash: resourceHash(testCase.base, usermetaResource),
      localHash: resourceHash(testCase.local, usermetaResource),
      remoteHash: resourceHash(testCase.remote, usermetaResource),
      userIdHash: `sha256:${digest(String(shape.usermetaRow.user_id))}`,
      metaKeyHash: `sha256:${digest(shape.usermetaRow.meta_key)}`,
    },
  };
}

function wpUsersUsermetaGraphVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { label: 'user', resource: rowResource('wp_users', shape.userRowId), changeKind: 'create' },
    { label: 'usermeta', resource: rowResource('wp_usermeta', shape.metaRowId), changeKind: 'create' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};
  const graphMutations = {};

  for (const { label, resource, changeKind } of expected) {
    const mutation = mutations.get(resource.key);
    const precondition = preconditions.get(resource.key);
    const localHash = resourceHash(testCase.local, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.ok(mutation, `${testCase.id} should plan ${label} graph mutation for ${resource.key}`);
    assert.ok(precondition, `${testCase.id} should precondition ${label} graph mutation for ${resource.key}`);
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(appliedHash, localHash, `${testCase.id} did not apply local ${label} graph row`);
    incrementCount(plannedChangeKinds, changeKind);

    graphMutations[label] = {
      resourceKey: resource.key,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      preconditionExpectedHash: precondition.expectedHash,
      appliedHash,
      plannedMutation: true,
      plannedPrecondition: true,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })}`,
    };
  }

  return {
    plannedChangeKinds: sortStringObject(plannedChangeKinds),
    graphMutations,
  };
}

function wpUsersUsermetaGraphVariant3StaleBlockerEvidence({ testCase, plan, shape }) {
  const userResourceKey = rowResourceKey('wp_users', shape.userRowId);
  const usermetaResourceKey = rowResourceKey('wp_usermeta', shape.metaRowId);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === usermetaResourceKey
    && entry.references?.some((reference) => reference.targetResourceKey === userResourceKey));
  const userDecision = plan.decisions.find((entry) => entry.resourceKey === userResourceKey);
  const plannedMutation = plan.mutations.some((mutation) =>
    mutation.resourceKey === userResourceKey || mutation.resourceKey === usermetaResourceKey);

  assert.ok(blocker, `${testCase.id} should report a stale user/usermeta graph blocker`);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.ok(userDecision, `${testCase.id} should keep the stale remote user`);
  assert.equal(userDecision.decision, 'keep-remote');
  assert.equal(plannedMutation, false, `${testCase.id} should not plan stale user/usermeta graph mutations`);

  return {
    resourceKey: blocker.resourceKey,
    class: blocker.class,
    plannedMutation,
    relationshipKeys: blocker.references.map((reference) => reference.relationshipKey).sort(),
    targetResourceKey: userResourceKey,
    targetChange: blocker.references.find((reference) => reference.targetResourceKey === userResourceKey).targetChange,
    blockerHash: `sha256:${digest(blocker)}`,
    decision: {
      resourceKey: userDecision.resourceKey,
      decision: userDecision.decision,
      decisionHash: `sha256:${digest(userDecision)}`,
    },
  };
}

function wpUsersUsermetaGraphVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}


test('RPP-0111/RPP-0131 wp_terms/wp_termmeta graph target exposes per-tier ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermsTermmetaGraph;

  assert.ok(coverage, 'missing wp_terms/wp_termmeta graph target coverage');
  assert.equal(coverage.family, 'wp-terms-termmeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-terms-termmeta-graph']);
  assert.equal(coverage.total, 20, 'target should include ready and stale cases for every tier');
  assert.equal(coverage.statuses.ready, 10, 'target should include one ready terms/termmeta graph per tier');
  assert.equal(nonReadyTargetCount(coverage), 10, 'target should include one stale terms/termmeta graph case per tier');
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
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-terms-termmeta-graph-ready');
  const staleCases = cases.filter((testCase) => testCase.family === 'wp-terms-termmeta-graph-stale');

  assert.equal(readyCases.length, 10, 'missing one ready wp_terms/wp_termmeta graph case per tier');
  assert.equal(staleCases.length, 10, 'missing one stale wp_terms/wp_termmeta graph case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    assertTermTermmetaGraphShape(readyCase, { staleTarget: false });

    const ready = validateGeneratedCase(readyCase);

    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 2, `${readyCase.id} should create term and termmeta rows`);
    assert.equal(ready.applied, true, `${readyCase.id} should apply through the harness`);
    assert.equal(ready.unplannedRemotePreserved, true, `${readyCase.id} should preserve unplanned remote data`);
    assert.equal(ready.staleReplayRejected, true, `${readyCase.id} should reject stale replay`);
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, `${readyCase.id} stale replay must fail before mutation`);
  }

  for (const staleCase of staleCases) {
    assertTermTermmetaGraphShape(staleCase, { staleTarget: true });

    const stale = validateGeneratedCase(staleCase);

    assert.notEqual(stale.status, 'ready', `${staleCase.id} should not be ready`);
    assert.ok(stale.blockers >= 1, `${staleCase.id} should record a graph identity blocker`);
    assert.equal(stale.applied, false, `${staleCase.id} must not apply mutations`);
  }
});

test('RPP-0151 wp_terms/wp_termmeta graph variant 3 records per-tier ready and stale non-ready coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermsTermmetaGraphVariant3;

  assert.ok(coverage, 'missing wp_terms/wp_termmeta graph variant 3 target coverage');
  assert.equal(coverage.family, 'wp-terms-termmeta-graph-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-terms-termmeta-graph-v3']);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.statuses.ready, 10);
  assert.equal(nonReadyTargetCount(coverage), 10);
  assert.ok(coverage.statuses.ready > 0, 'variant 3 target should include ready terms/termmeta graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 3 target should include non-ready stale graph cases');
  assert.equal(report.summary.featureFamilies['wp-terms-termmeta-graph-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-terms-termmeta-graph-v3-stale'], 10);
  assert.equal(report.summary.featureFamilies['wp-terms-termmeta-graph-v3-non-ready'], 10);
  assert.equal(JSON.stringify(report).includes('Generated term graph target'), false, 'summary leaked term name');
  assert.equal(JSON.stringify(report).includes('generated-term-graph-'), false, 'summary leaked term slug');
  assert.equal(JSON.stringify(report).includes('generated termmeta graph '), false, 'summary leaked termmeta value');
  assert.equal(JSON.stringify(report).includes('Remote stale term graph target'), false, 'summary leaked remote term drift');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpTermsTermmetaGraphVariant3Evidence(coverage);
  const replayEvidence = generatedWpTermsTermmetaGraphVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0151 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 terms/termmeta evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpTermsTermmetaGraphVariant3');
  assert.equal(firstEvidence.family, 'wp-terms-termmeta-graph-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 2 });
  assert.equal(readyCase.graphMutations.term.changeKind, 'create');
  assert.equal(readyCase.graphMutations.termmeta.changeKind, 'create');
  assert.equal(readyCase.graphMutations.term.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.termmeta.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.term.appliedHash, readyCase.surface.term.localHash);
  assert.equal(readyCase.graphMutations.termmeta.appliedHash, readyCase.surface.termmeta.localHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.notEqual(nonReadyCase.status, 'ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.termmeta.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.term.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedMutation, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_termmeta.term_id']);
  assert.match(nonReadyCase.staleBlocker.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated term graph target'), false, 'variant 3 evidence leaked term name');
  assert.equal(evidenceText.includes('generated-term-graph-'), false, 'variant 3 evidence leaked term slug');
  assert.equal(evidenceText.includes('generated termmeta graph '), false, 'variant 3 evidence leaked termmeta value');
  assert.equal(evidenceText.includes('Remote stale term graph target'), false, 'variant 3 evidence leaked remote term drift');
  assert.equal(evidenceText.includes('remote-stale-term-graph-'), false, 'variant 3 evidence leaked remote term slug');
});

test('RPP-0171 wp_terms/wp_termmeta graph variant 4 keeps ready and stale graph regression coverage focused', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermsTermmetaGraphVariant4;

  assert.ok(coverage, 'missing wp_terms/wp_termmeta graph variant 4 target coverage');
  assert.equal(coverage.family, 'wp-terms-termmeta-graph-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-terms-termmeta-graph-v4']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { blocked: 3, conflict: 7, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready terms/termmeta graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready stale graph cases');
  assert.equal(report.summary.featureFamilies['wp-terms-termmeta-graph-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-terms-termmeta-graph-v4-stale'], 10);
  assert.equal(report.summary.featureFamilies['wp-terms-termmeta-graph-v4-non-ready'], 10);
  assert.equal(JSON.stringify(report).includes('Generated term graph target'), false, 'summary leaked term name');
  assert.equal(JSON.stringify(report).includes('generated-term-graph-'), false, 'summary leaked term slug');
  assert.equal(JSON.stringify(report).includes('generated termmeta graph '), false, 'summary leaked termmeta value');
  assert.equal(JSON.stringify(report).includes('Remote stale term graph target'), false, 'summary leaked remote term drift');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpTermsTermmetaGraphVariant4Evidence(coverage);
  const replayEvidence = generatedWpTermsTermmetaGraphVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0171 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 terms/termmeta evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpTermsTermmetaGraphVariant4');
  assert.equal(firstEvidence.family, 'wp-terms-termmeta-graph-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes('wp-terms-termmeta-graph-v4-ready'));
  assert.ok(nonReadyCase.tags.includes('wp-terms-termmeta-graph-v4-non-ready'));

  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 2 });
  assert.equal(readyCase.graphMutations.term.changeKind, 'create');
  assert.equal(readyCase.graphMutations.termmeta.changeKind, 'create');
  assert.equal(readyCase.graphMutations.term.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.termmeta.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.term.appliedHash, readyCase.surface.term.localHash);
  assert.equal(readyCase.graphMutations.termmeta.appliedHash, readyCase.surface.termmeta.localHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.notEqual(nonReadyCase.status, 'ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.termmeta.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.term.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedMutation, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_termmeta.term_id']);
  assert.match(nonReadyCase.staleBlocker.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated term graph target'), false, 'variant 4 evidence leaked term name');
  assert.equal(evidenceText.includes('generated-term-graph-'), false, 'variant 4 evidence leaked term slug');
  assert.equal(evidenceText.includes('generated termmeta graph '), false, 'variant 4 evidence leaked termmeta value');
  assert.equal(evidenceText.includes('Remote stale term graph target'), false, 'variant 4 evidence leaked remote term drift');
  assert.equal(evidenceText.includes('remote-stale-term-graph-'), false, 'variant 4 evidence leaked remote term slug');
});

function assertTermTermmetaGraphShape(testCase, { staleTarget }) {
  assert.ok(testCase.tags.has('same-plan-graph'));
  assert.ok(testCase.tags.has('taxonomy-graph'));
  assert.ok(testCase.tags.has('wp-terms-termmeta-graph'));
  assert.ok(testCase.tags.has('wp-termmeta-create'));

  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([id, row]) => !testCase.base.db.wp_terms[id]
      && row.name.startsWith('Generated term graph target '));
  const termmetaRows = Object.entries(testCase.local.db.wp_termmeta)
    .filter(([id, row]) => !testCase.base.db.wp_termmeta[id]
      && row.meta_key.startsWith('_generated_termmeta_graph_'));

  assert.equal(termRows.length, staleTarget ? 0 : 1, `${testCase.id} ready graph should create one term`);
  assert.equal(termmetaRows.length, 1, `${testCase.id} should create one termmeta row`);

  const [termmetaRowId, termmetaRow] = termmetaRows[0];
  const termId = staleTarget
    ? termmetaRow.term_id
    : termRows[0][1].term_id;
  const termRowId = `term_id:${termId}`;
  assert.equal(termmetaRow.term_id, termId);
  assert.equal(testCase.base.db.wp_termmeta[termmetaRowId], undefined);
  assert.equal(testCase.remote.db.wp_termmeta[termmetaRowId], undefined);
  assert.ok(testCase.local.db.wp_terms[termRowId], `${testCase.id} should have the term target locally`);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_terms[termRowId], `${testCase.id} stale target should exist in base`);
    assert.deepEqual(
      testCase.local.db.wp_terms[termRowId],
      testCase.base.db.wp_terms[termRowId],
      `${testCase.id} stale target should be unchanged locally`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_terms[termRowId],
      testCase.base.db.wp_terms[termRowId],
      `${testCase.id} stale target should drift remotely`,
    );
    assert.ok(testCase.tags.has('stale-graph'));
    assert.ok(testCase.tags.has('wp-terms-remote-drift'));
  } else {
    assert.equal(testCase.base.db.wp_terms[termRowId], undefined);
    assert.equal(testCase.remote.db.wp_terms[termRowId], undefined);
    assert.ok(testCase.tags.has('wp-terms-create'));
  }

  return {
    termRowId,
    termmetaRowId,
    termRow: testCase.local.db.wp_terms[termRowId],
    remoteTermRow: testCase.remote.db.wp_terms[termRowId],
    baseTermRow: testCase.base.db.wp_terms[termRowId],
    termmetaRow,
  };
}

function generatedWpTermsTermmetaGraphVariant3Evidence(targetCoverage) {
  return generatedWpTermsTermmetaGraphVariantEvidence(targetCoverage, {
    target: 'wpTermsTermmetaGraphVariant3',
    tag: 'wp-terms-termmeta-graph-v3',
    staleTag: 'wp-terms-termmeta-graph-v3-stale',
    label: 'variant 3',
  });
}

function generatedWpTermsTermmetaGraphVariant4Evidence(targetCoverage) {
  return generatedWpTermsTermmetaGraphVariantEvidence(targetCoverage, {
    target: 'wpTermsTermmetaGraphVariant4',
    tag: 'wp-terms-termmeta-graph-v4',
    staleTag: 'wp-terms-termmeta-graph-v4-stale',
    label: 'variant 4',
  });
}

function generatedWpTermsTermmetaGraphVariantEvidence(targetCoverage, {
  target,
  tag,
  staleTag,
  label,
}) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has(tag)) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedWpTermsTermmetaGraphVariantCaseEvidence(testCase, result, {
      staleTag,
      label,
    });
    const selectedKey = result.status === 'ready' ? 'ready' : 'stale-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, `${label} terms/termmeta target recount should match summary tiers`);
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, `${label} terms/termmeta target recount should match summary statuses`);
  assert.equal(totalCases, targetCoverage.total, `${label} terms/termmeta target recount should match summary total`);
  assert.ok(selectedCases.has('ready'), `${label} target should select one ready terms/termmeta case`);
  assert.ok(selectedCases.has('stale-non-ready'), `${label} target should select one stale non-ready terms/termmeta case`);

  return {
    target,
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('stale-non-ready'),
    ],
  };
}

function generatedWpTermsTermmetaGraphVariantCaseEvidence(testCase, result, { staleTag, label }) {
  const staleTarget = testCase.tags.has(staleTag);
  assert.equal(
    staleTarget,
    testCase.family === 'wp-terms-termmeta-graph-stale',
    `${testCase.id} ${label} stale tag should match stale graph family`,
  );
  const shape = assertTermTermmetaGraphShape(testCase, { staleTarget });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = wpTermsTermmetaGraphVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'stale-non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  assertTermmetaGraphVariant3EvidenceRedacted(testCase, plan, shape);

  if (result.status === 'ready') {
    assert.equal(staleTarget, false, `${testCase.id} ready evidence should not use stale graph target`);
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const { plannedChangeKinds, graphMutations } = wpTermsTermmetaGraphVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      graphMutations,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        graphMutations,
      })}`,
    };
  }

  assert.equal(staleTarget, true, `${testCase.id} non-ready evidence should use stale graph target`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const staleBlocker = wpTermsTermmetaGraphVariant3StaleBlockerEvidence({ testCase, plan, shape });
  const refusal = wpTermsTermmetaGraphVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    staleBlocker,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      staleBlocker,
      refusal,
    })}`,
  };
}

function wpTermsTermmetaGraphVariant3SurfaceEvidence(testCase, shape) {
  const termResource = rowResource('wp_terms', shape.termRowId);
  const termmetaResource = rowResource('wp_termmeta', shape.termmetaRowId);

  return {
    term: {
      resourceKey: termResource.key,
      baseHash: resourceHash(testCase.base, termResource),
      localHash: resourceHash(testCase.local, termResource),
      remoteHash: resourceHash(testCase.remote, termResource),
      termIdHash: `sha256:${digest(shape.termRowId)}`,
      slugHash: `sha256:${digest(shape.termRow.slug)}`,
    },
    termmeta: {
      resourceKey: termmetaResource.key,
      baseHash: resourceHash(testCase.base, termmetaResource),
      localHash: resourceHash(testCase.local, termmetaResource),
      remoteHash: resourceHash(testCase.remote, termmetaResource),
      termIdHash: `sha256:${digest(String(shape.termmetaRow.term_id))}`,
      metaKeyHash: `sha256:${digest(shape.termmetaRow.meta_key)}`,
    },
  };
}

function wpTermsTermmetaGraphVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { label: 'term', resource: rowResource('wp_terms', shape.termRowId), changeKind: 'create' },
    { label: 'termmeta', resource: rowResource('wp_termmeta', shape.termmetaRowId), changeKind: 'create' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};
  const graphMutations = {};

  for (const { label, resource, changeKind } of expected) {
    const mutation = mutations.get(resource.key);
    const precondition = preconditions.get(resource.key);
    const localHash = resourceHash(testCase.local, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.ok(mutation, `${testCase.id} should plan ${label} graph mutation for ${resource.key}`);
    assert.ok(precondition, `${testCase.id} should precondition ${label} graph mutation for ${resource.key}`);
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(appliedHash, localHash, `${testCase.id} did not apply local ${label} graph row`);
    incrementCount(plannedChangeKinds, changeKind);

    graphMutations[label] = {
      resourceKey: resource.key,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      preconditionExpectedHash: precondition.expectedHash,
      appliedHash,
      plannedMutation: true,
      plannedPrecondition: true,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })}`,
    };
  }

  return {
    plannedChangeKinds: sortStringObject(plannedChangeKinds),
    graphMutations,
  };
}

function wpTermsTermmetaGraphVariant3StaleBlockerEvidence({ testCase, plan, shape }) {
  const termResourceKey = rowResourceKey('wp_terms', shape.termRowId);
  const termmetaResourceKey = rowResourceKey('wp_termmeta', shape.termmetaRowId);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === termmetaResourceKey
    && entry.references?.some((reference) => reference.targetResourceKey === termResourceKey));
  const termDecision = plan.decisions.find((entry) => entry.resourceKey === termResourceKey);
  const plannedMutation = plan.mutations.some((mutation) =>
    mutation.resourceKey === termResourceKey || mutation.resourceKey === termmetaResourceKey);

  assert.ok(blocker, `${testCase.id} should report a stale terms/termmeta graph blocker`);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.ok(termDecision, `${testCase.id} should keep the stale remote term`);
  assert.equal(termDecision.decision, 'keep-remote');
  assert.equal(plannedMutation, false, `${testCase.id} should not plan stale terms/termmeta graph mutations`);

  return {
    resourceKey: blocker.resourceKey,
    class: blocker.class,
    plannedMutation,
    relationshipKeys: blocker.references.map((reference) => reference.relationshipKey).sort(),
    targetResourceKey: termResourceKey,
    targetChange: blocker.references.find((reference) => reference.targetResourceKey === termResourceKey).targetChange,
    blockerHash: `sha256:${digest(blocker)}`,
    decision: {
      resourceKey: termDecision.resourceKey,
      decision: termDecision.decision,
      decisionHash: `sha256:${digest(termDecision)}`,
    },
  };
}

function wpTermsTermmetaGraphVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function assertTermmetaGraphVariant3EvidenceRedacted(testCase, plan, shape) {
  const termResourceKey = rowResourceKey('wp_terms', shape.termRowId);
  const termmetaResourceKey = rowResourceKey('wp_termmeta', shape.termmetaRowId);
  const relatedMutations = plan.mutations.filter((mutation) =>
    mutation.resourceKey === termResourceKey || mutation.resourceKey === termmetaResourceKey);
  const relatedBlockers = plan.blockers.filter((blocker) =>
    blocker.resourceKey === termmetaResourceKey
    || blocker.references?.some((reference) => reference.targetResourceKey === termResourceKey));
  const relatedDecisions = plan.decisions.filter((decision) => decision.resourceKey === termResourceKey);

  if (plan.status === 'ready') {
    assert.equal(relatedMutations.length, 2, `${testCase.id} should mutate term and termmeta rows`);
  } else {
    assert.ok(relatedBlockers.length >= 1, `${testCase.id} should have termmeta graph blockers`);
  }

  const redacted = redactEvidence({
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    tags: [...testCase.tags].sort(),
    status: plan.status,
    summary: plan.summary,
    mutations: relatedMutations,
    blockers: relatedBlockers,
    decisions: relatedDecisions,
    rawTermGraphProbe: {
      value: {
        localTerm: shape.termRow,
        remoteTerm: shape.remoteTermRow,
        baseTerm: shape.baseTermRow,
        termmeta: shape.termmetaRow,
      },
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), `${testCase.id} should redact raw terms/termmeta evidence`);
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, `${testCase.id} evidence should keep hash-only terms/termmeta values`);
  assert.equal(serialized.includes('Generated term graph target'), false, `${testCase.id} leaked raw term name`);
  assert.equal(serialized.includes('generated-term-graph-'), false, `${testCase.id} leaked raw term slug`);
  assert.equal(serialized.includes('generated termmeta graph '), false, `${testCase.id} leaked raw termmeta value`);
  assert.equal(serialized.includes('Remote stale term graph target'), false, `${testCase.id} leaked remote term drift`);
  assert.equal(serialized.includes('remote-stale-term-graph-'), false, `${testCase.id} leaked remote term slug`);
}

test('RPP-0112/RPP-0132 wp_term_taxonomy graph target exposes redacted per-tier ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermTaxonomyGraph;

  assert.ok(coverage, 'missing wp_term_taxonomy graph target coverage');
  assert.equal(coverage.family, 'wp-term-taxonomy-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-term-taxonomy-graph']);
  assert.equal(coverage.total, 20, 'target should include ready and stale term-taxonomy graph cases per tier');
  assert.deepEqual(coverage.statuses, { blocked: 4, conflict: 6, ready: 10 });
  assert.equal(nonReadyTargetCount(coverage), 10, 'target should include one stale term-taxonomy graph case per tier');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
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
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-term-taxonomy-graph-ready');
  const staleCases = cases.filter((testCase) => testCase.family === 'wp-term-taxonomy-graph-stale');

  assert.equal(readyCases.length, 10, 'missing one ready wp_term_taxonomy graph case per tier');
  assert.equal(staleCases.length, 10, 'missing one stale wp_term_taxonomy graph case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  for (const readyCase of readyCases) {
    const readyShape = assertTermTaxonomyGraphShape(readyCase, { staleTarget: false });
    const ready = validateGeneratedCase(readyCase);

    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 2, `${readyCase.id} should create term and term_taxonomy rows`);
    assert.equal(ready.applied, true, `${readyCase.id} should apply through the harness`);
    assert.equal(ready.unplannedRemotePreserved, true, `${readyCase.id} should preserve unplanned remote data`);
    assert.equal(ready.staleReplayRejected, true, `${readyCase.id} should reject stale replay`);
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, `${readyCase.id} stale replay must fail before mutation`);
    assertTermTaxonomyEvidenceRedacted(readyCase, readyShape);
  }

  for (const staleCase of staleCases) {
    const staleShape = assertTermTaxonomyGraphShape(staleCase, { staleTarget: true });
    const stale = validateGeneratedCase(staleCase);

    assert.notEqual(stale.status, 'ready', `${staleCase.id} should not be ready`);
    assert.ok(stale.blockers >= 1, `${staleCase.id} should record a graph identity blocker`);
    assert.equal(stale.applied, false, `${staleCase.id} must not apply mutations`);
    assertTermTaxonomyEvidenceRedacted(staleCase, staleShape);
  }
});

function assertTermTaxonomyGraphShape(testCase, { staleTarget }) {
  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([id, row]) => !testCase.base.db.wp_terms[id]
      && row.name.startsWith('Generated term taxonomy graph target '));
  const termTaxonomyRows = Object.entries(testCase.local.db.wp_term_taxonomy)
    .filter(([id, row]) => !testCase.base.db.wp_term_taxonomy[id]
      && typeof row.description === 'string'
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

  const termRowId = `term_id:${termId}`;
  const taxonomyRowId = termTaxonomyRows[0][0];
  return {
    termRowId,
    taxonomyRowId,
    termRow: testCase.local.db.wp_terms[termRowId],
    remoteTermRow: testCase.remote.db.wp_terms[termRowId],
    baseTermRow: testCase.base.db.wp_terms[termRowId],
    taxonomyRow: termTaxonomyRows[0][1],
  };
}

function assertTermTaxonomyEvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const termResourceKey = `row:${JSON.stringify(['wp_terms', shape.termRowId])}`;
  const taxonomyResourceKey = `row:${JSON.stringify(['wp_term_taxonomy', shape.taxonomyRowId])}`;
  const relatedMutations = plan.mutations.filter((mutation) =>
    mutation.resourceKey === termResourceKey || mutation.resourceKey === taxonomyResourceKey);
  const relatedBlockers = plan.blockers.filter((blocker) =>
    blocker.resourceKey === taxonomyResourceKey
    || blocker.references?.some((reference) => reference.targetResourceKey === termResourceKey));
  const relatedDecisions = plan.decisions.filter((decision) => decision.resourceKey === termResourceKey);

  if (plan.status === 'ready') {
    assert.equal(relatedMutations.length, 2, `${testCase.id} should mutate term and term_taxonomy rows`);
  } else {
    assert.notEqual(plan.status, 'ready');
    assert.ok(relatedBlockers.length >= 1, `${testCase.id} should have term_taxonomy graph blockers`);
  }

  const redacted = redactEvidence({
    status: plan.status,
    mutations: relatedMutations.map((mutation) => ({
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: mutation.change,
      value: mutation.value,
    })),
    blockers: relatedBlockers,
    decisions: relatedDecisions,
  });
  const redactedJson = JSON.stringify(redacted);

  if (relatedMutations.length > 0) {
    assert.ok(redactedJson.includes(EVIDENCE_REDACTION_MARKER), 'mutation values should be redacted in evidence');
    assert.ok(redactedJson.includes('sha256'), 'redacted mutation evidence should keep hashes');
  }
  assertTermTaxonomyRawValuesAbsent(testCase, shape, redactedJson);
}

function assertTermTaxonomyRawValuesAbsent(testCase, shape, redactedJson) {
  const values = [
    shape.termRow?.name,
    shape.termRow?.slug,
    shape.remoteTermRow?.name,
    shape.remoteTermRow?.slug,
    shape.taxonomyRow.description,
  ].filter(Boolean).map(String);

  for (const value of values) {
    assert.equal(
      redactedJson.includes(value),
      false,
      `${testCase.id} redacted evidence should not expose ${value}`,
    );
  }
}

test('RPP-0152 wp_term_taxonomy graph variant 3 records per-tier ready and stale non-ready coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermTaxonomyGraphVariant3;

  assert.ok(coverage, 'missing wp_term_taxonomy graph variant 3 target coverage');
  assert.equal(coverage.family, 'wp-term-taxonomy-graph-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-term-taxonomy-graph-v3']);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.statuses.ready, 10);
  assert.equal(nonReadyTargetCount(coverage), 10);
  assert.ok(coverage.statuses.ready > 0, 'variant 3 target should include ready term-taxonomy graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 3 target should include non-ready stale graph cases');
  assert.equal(report.summary.featureFamilies['wp-term-taxonomy-graph-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-term-taxonomy-graph-v3-stale'], 10);
  assert.equal(report.summary.featureFamilies['wp-term-taxonomy-graph-v3-non-ready'], 10);
  assert.equal(JSON.stringify(report).includes('Generated term taxonomy graph target'), false, 'summary leaked term name');
  assert.equal(JSON.stringify(report).includes('generated-term-taxonomy-graph-'), false, 'summary leaked term slug');
  assert.equal(JSON.stringify(report).includes('generated term taxonomy graph '), false, 'summary leaked taxonomy description');
  assert.equal(JSON.stringify(report).includes('Remote stale term taxonomy graph target'), false, 'summary leaked remote term drift');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpTermTaxonomyGraphVariant3Evidence(coverage);
  const replayEvidence = generatedWpTermTaxonomyGraphVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0152 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 term-taxonomy evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpTermTaxonomyGraphVariant3');
  assert.equal(firstEvidence.family, 'wp-term-taxonomy-graph-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 2 });
  assert.equal(readyCase.graphMutations.term.changeKind, 'create');
  assert.equal(readyCase.graphMutations.taxonomy.changeKind, 'create');
  assert.equal(readyCase.graphMutations.term.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.taxonomy.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.term.appliedHash, readyCase.surface.term.localHash);
  assert.equal(readyCase.graphMutations.taxonomy.appliedHash, readyCase.surface.taxonomy.localHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.notEqual(nonReadyCase.status, 'ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.taxonomy.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.term.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedMutation, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_term_taxonomy.term_id']);
  assert.match(nonReadyCase.staleBlocker.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated term taxonomy graph target'), false, 'variant 3 evidence leaked term name');
  assert.equal(evidenceText.includes('generated-term-taxonomy-graph-'), false, 'variant 3 evidence leaked term slug');
  assert.equal(evidenceText.includes('generated term taxonomy graph '), false, 'variant 3 evidence leaked taxonomy description');
  assert.equal(evidenceText.includes('Remote stale term taxonomy graph target'), false, 'variant 3 evidence leaked remote term drift');
  assert.equal(evidenceText.includes('remote-stale-term-taxonomy-graph-'), false, 'variant 3 evidence leaked remote term slug');
});

test('RPP-0172 wp_term_taxonomy graph variant 4 rejects stale replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermTaxonomyGraphVariant4;

  assert.ok(coverage, 'missing wp_term_taxonomy graph variant 4 target coverage');
  assert.equal(coverage.family, 'wp-term-taxonomy-graph-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-term-taxonomy-graph-v4']);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.statuses.ready, 10);
  assert.equal(nonReadyTargetCount(coverage), 10);
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready term-taxonomy graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready stale graph cases');
  assert.equal(report.summary.featureFamilies['wp-term-taxonomy-graph-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-term-taxonomy-graph-v4-stale'], 10);
  assert.equal(report.summary.featureFamilies['wp-term-taxonomy-graph-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpTermTaxonomyGraphVariant4Evidence(coverage);
  const replayEvidence = generatedWpTermTaxonomyGraphVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0172 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 term-taxonomy evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpTermTaxonomyGraphVariant4');
  assert.equal(firstEvidence.family, 'wp-term-taxonomy-graph-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.ok(readyCase.tags.includes('wp-term-taxonomy-graph-v4'));
  assert.ok(readyCase.tags.includes('wp-term-taxonomy-graph-v4-ready'));
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 2 });
  assert.equal(readyCase.graphMutations.term.changeKind, 'create');
  assert.equal(readyCase.graphMutations.taxonomy.changeKind, 'create');
  assert.equal(readyCase.graphMutations.term.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.taxonomy.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.term.appliedHash, readyCase.surface.term.localHash);
  assert.equal(readyCase.graphMutations.taxonomy.appliedHash, readyCase.surface.taxonomy.localHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.notEqual(nonReadyCase.status, 'ready');
  assert.ok(nonReadyCase.tags.includes('wp-term-taxonomy-graph-v4'));
  assert.ok(nonReadyCase.tags.includes('wp-term-taxonomy-graph-v4-non-ready'));
  assert.ok(nonReadyCase.tags.includes('wp-term-taxonomy-graph-v4-stale'));
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.taxonomy.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.term.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedMutation, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_term_taxonomy.term_id']);
  assert.match(nonReadyCase.staleBlocker.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated term taxonomy graph target'), false, 'variant 4 evidence leaked term name');
  assert.equal(evidenceText.includes('generated-term-taxonomy-graph-'), false, 'variant 4 evidence leaked term slug');
  assert.equal(evidenceText.includes('generated term taxonomy graph '), false, 'variant 4 evidence leaked taxonomy description');
  assert.equal(evidenceText.includes('Remote stale term taxonomy graph target'), false, 'variant 4 evidence leaked remote term drift');
  assert.equal(evidenceText.includes('remote-stale-term-taxonomy-graph-'), false, 'variant 4 evidence leaked remote term slug');
});

function generatedWpTermTaxonomyGraphVariant3Evidence(targetCoverage) {
  return generatedWpTermTaxonomyGraphVariantEvidence(targetCoverage, {
    target: 'wpTermTaxonomyGraphVariant3',
    tag: 'wp-term-taxonomy-graph-v3',
    readyTag: 'wp-term-taxonomy-graph-v3-ready',
    staleTag: 'wp-term-taxonomy-graph-v3-stale',
    variantLabel: 'variant 3',
  });
}

function generatedWpTermTaxonomyGraphVariant4Evidence(targetCoverage) {
  return generatedWpTermTaxonomyGraphVariantEvidence(targetCoverage, {
    target: 'wpTermTaxonomyGraphVariant4',
    tag: 'wp-term-taxonomy-graph-v4',
    readyTag: 'wp-term-taxonomy-graph-v4-ready',
    staleTag: 'wp-term-taxonomy-graph-v4-stale',
    variantLabel: 'variant 4',
  });
}

function generatedWpTermTaxonomyGraphVariantEvidence(targetCoverage, {
  target,
  tag,
  readyTag,
  staleTag,
  variantLabel,
}) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has(tag)) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedWpTermTaxonomyGraphVariant3CaseEvidence(testCase, result, {
      readyTag,
      staleTag,
      variantLabel,
    });
    const selectedKey = result.status === 'ready' ? 'ready' : 'stale-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, `${variantLabel} term-taxonomy target recount should match summary tiers`);
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, `${variantLabel} term-taxonomy target recount should match summary statuses`);
  assert.equal(totalCases, targetCoverage.total, `${variantLabel} term-taxonomy target recount should match summary total`);
  assert.ok(selectedCases.has('ready'), `${variantLabel} target should select one ready term-taxonomy case`);
  assert.ok(selectedCases.has('stale-non-ready'), `${variantLabel} target should select one stale non-ready term-taxonomy case`);

  return {
    target,
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('stale-non-ready'),
    ],
  };
}

function generatedWpTermTaxonomyGraphVariant3CaseEvidence(testCase, result, {
  readyTag = 'wp-term-taxonomy-graph-v3-ready',
  staleTag = 'wp-term-taxonomy-graph-v3-stale',
  variantLabel = 'variant 3',
} = {}) {
  const staleTarget = testCase.tags.has(staleTag);
  assert.equal(
    staleTarget,
    testCase.family === 'wp-term-taxonomy-graph-stale',
    `${testCase.id} ${variantLabel} stale tag should match stale graph family`,
  );
  assert.equal(
    testCase.tags.has(readyTag),
    testCase.family === 'wp-term-taxonomy-graph-ready',
    `${testCase.id} ${variantLabel} ready tag should match ready graph family`,
  );
  const shape = assertTermTaxonomyGraphShape(testCase, { staleTarget });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = wpTermTaxonomyGraphVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'stale-non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  assertTermTaxonomyGraphVariant3EvidenceRedacted(testCase, plan, shape);

  if (result.status === 'ready') {
    assert.equal(staleTarget, false, `${testCase.id} ready evidence should not use stale graph target`);
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const { plannedChangeKinds, graphMutations } = wpTermTaxonomyGraphVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      graphMutations,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        graphMutations,
      })}`,
    };
  }

  assert.equal(staleTarget, true, `${testCase.id} non-ready evidence should use stale graph target`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const staleBlocker = wpTermTaxonomyGraphVariant3StaleBlockerEvidence({ testCase, plan, shape });
  const refusal = wpTermTaxonomyGraphVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    staleBlocker,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      staleBlocker,
      refusal,
    })}`,
  };
}

function wpTermTaxonomyGraphVariant3SurfaceEvidence(testCase, shape) {
  const termResource = rowResource('wp_terms', shape.termRowId);
  const taxonomyResource = rowResource('wp_term_taxonomy', shape.taxonomyRowId);

  return {
    term: {
      resourceKey: termResource.key,
      baseHash: resourceHash(testCase.base, termResource),
      localHash: resourceHash(testCase.local, termResource),
      remoteHash: resourceHash(testCase.remote, termResource),
      termIdHash: `sha256:${digest(shape.termRowId)}`,
      slugHash: `sha256:${digest(shape.termRow.slug)}`,
    },
    taxonomy: {
      resourceKey: taxonomyResource.key,
      baseHash: resourceHash(testCase.base, taxonomyResource),
      localHash: resourceHash(testCase.local, taxonomyResource),
      remoteHash: resourceHash(testCase.remote, taxonomyResource),
      termIdHash: `sha256:${digest(String(shape.taxonomyRow.term_id))}`,
      taxonomyHash: `sha256:${digest(shape.taxonomyRow.taxonomy)}`,
      descriptionHash: `sha256:${digest(shape.taxonomyRow.description)}`,
    },
  };
}

function wpTermTaxonomyGraphVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { label: 'term', resource: rowResource('wp_terms', shape.termRowId), changeKind: 'create' },
    { label: 'taxonomy', resource: rowResource('wp_term_taxonomy', shape.taxonomyRowId), changeKind: 'create' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};
  const graphMutations = {};

  for (const { label, resource, changeKind } of expected) {
    const mutation = mutations.get(resource.key);
    const precondition = preconditions.get(resource.key);
    const localHash = resourceHash(testCase.local, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.ok(mutation, `${testCase.id} should plan ${label} graph mutation for ${resource.key}`);
    assert.ok(precondition, `${testCase.id} should precondition ${label} graph mutation for ${resource.key}`);
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(appliedHash, localHash, `${testCase.id} did not apply local ${label} graph row`);
    incrementCount(plannedChangeKinds, changeKind);

    graphMutations[label] = {
      resourceKey: resource.key,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      preconditionExpectedHash: precondition.expectedHash,
      appliedHash,
      plannedMutation: true,
      plannedPrecondition: true,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })}`,
    };
  }

  return {
    plannedChangeKinds: sortStringObject(plannedChangeKinds),
    graphMutations,
  };
}

function wpTermTaxonomyGraphVariant3StaleBlockerEvidence({ testCase, plan, shape }) {
  const termResourceKey = rowResourceKey('wp_terms', shape.termRowId);
  const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', shape.taxonomyRowId);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === taxonomyResourceKey
    && entry.references?.some((reference) => reference.targetResourceKey === termResourceKey));
  const termDecision = plan.decisions.find((entry) => entry.resourceKey === termResourceKey);
  const plannedMutation = plan.mutations.some((mutation) =>
    mutation.resourceKey === termResourceKey || mutation.resourceKey === taxonomyResourceKey);

  assert.ok(blocker, `${testCase.id} should report a stale term-taxonomy graph blocker`);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.ok(termDecision, `${testCase.id} should keep the stale remote term`);
  assert.equal(termDecision.decision, 'keep-remote');
  assert.equal(plannedMutation, false, `${testCase.id} should not plan stale term-taxonomy graph mutations`);

  return {
    resourceKey: blocker.resourceKey,
    class: blocker.class,
    plannedMutation,
    relationshipKeys: blocker.references.map((reference) => reference.relationshipKey).sort(),
    targetResourceKey: termResourceKey,
    targetChange: blocker.references.find((reference) => reference.targetResourceKey === termResourceKey).targetChange,
    blockerHash: `sha256:${digest(blocker)}`,
    decision: {
      resourceKey: termDecision.resourceKey,
      decision: termDecision.decision,
      decisionHash: `sha256:${digest(termDecision)}`,
    },
  };
}

function wpTermTaxonomyGraphVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function assertTermTaxonomyGraphVariant3EvidenceRedacted(testCase, plan, shape) {
  assertTermTaxonomyEvidenceRedacted(testCase, shape);

  const termResourceKey = rowResourceKey('wp_terms', shape.termRowId);
  const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', shape.taxonomyRowId);
  const relatedMutations = plan.mutations.filter((mutation) =>
    mutation.resourceKey === termResourceKey || mutation.resourceKey === taxonomyResourceKey);
  const relatedBlockers = plan.blockers.filter((blocker) =>
    blocker.resourceKey === taxonomyResourceKey
    || blocker.references?.some((reference) => reference.targetResourceKey === termResourceKey));
  const relatedDecisions = plan.decisions.filter((decision) => decision.resourceKey === termResourceKey);

  if (plan.status === 'ready') {
    assert.equal(relatedMutations.length, 2, `${testCase.id} should mutate term and term_taxonomy rows`);
  } else {
    assert.ok(relatedBlockers.length >= 1, `${testCase.id} should have term_taxonomy graph blockers`);
  }

  const redacted = redactEvidence({
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    tags: [...testCase.tags].sort(),
    status: plan.status,
    summary: plan.summary,
    mutations: relatedMutations,
    blockers: relatedBlockers,
    decisions: relatedDecisions,
    rawTermTaxonomyGraphProbe: {
      value: {
        localTerm: shape.termRow,
        remoteTerm: shape.remoteTermRow,
        baseTerm: shape.baseTermRow,
        taxonomy: shape.taxonomyRow,
      },
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), `${testCase.id} should redact raw term-taxonomy evidence`);
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, `${testCase.id} evidence should keep hash-only term-taxonomy values`);
  assertTermTaxonomyRawValuesAbsent(testCase, shape, serialized);
}

test('RPP-0113/RPP-0133 wp_term_relationships graph target exposes redacted ready and stale coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermRelationshipsGraph;

  assert.ok(coverage, 'missing wp_term_relationships graph target coverage');
  assert.equal(coverage.family, 'wp-term-relationships-graph');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-term-relationships-graph-target']);
  assert.equal(coverage.total, 10, 'target should include one relationship graph case per tier');
  assert.equal(report.summary.featureFamilies['wp-term-relationships-graph'], 10);
  assert.deepEqual(coverage.statuses, { blocked: 5, ready: 5 });
  assert.deepEqual(coverage.perTier, {
    0: 1,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
  });
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const summaryEvidence = JSON.stringify(report);
  assert.equal(summaryEvidence.includes('Generated wp_term_relationships'), false);
  assert.equal(summaryEvidence.includes('Remote stale wp_term_relationships'), false);

  const cases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('wp-term-relationships-graph-target'));
  const readyCases = cases.filter((testCase) => testCase.tags.has('wp-term-relationships-graph-ready'));
  const staleCases = cases.filter((testCase) => testCase.tags.has('wp-term-relationships-graph-stale'));

  assert.equal(cases.length, 10, 'one wp_term_relationships graph target should appear per tier');
  assert.equal(readyCases.length, 5, 'even tiers should produce ready relationship graph targets');
  assert.equal(staleCases.length, 5, 'odd tiers should produce stale relationship graph targets');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 2, 4, 6, 8]);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), [1, 3, 5, 7, 9]);

  for (const readyCase of readyCases) {
    const readyShape = assertTermRelationshipsGraphShape(readyCase, { staleTarget: false });
    const ready = validateGeneratedCase(readyCase);

    assert.equal(ready.status, 'ready');
    assert.ok(ready.mutations >= 4, 'ready graph should include the existing option plus graph row mutations');
    assert.equal(ready.applied, true, `${readyCase.id} should apply through the harness`);
    assert.equal(ready.unplannedRemotePreserved, true, `${readyCase.id} should preserve unplanned remote data`);
    assert.equal(ready.staleReplayRejected, true, `${readyCase.id} should reject stale replay`);
    assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(ready.staleReplayRemoteUnchanged, true, `${readyCase.id} stale replay must fail before mutation`);
    assertTermRelationshipsEvidenceRedacted(readyCase, readyShape);
  }

  for (const staleCase of staleCases) {
    const staleShape = assertTermRelationshipsGraphShape(staleCase, { staleTarget: true });
    const stale = validateGeneratedCase(staleCase);

    assert.equal(stale.status, 'blocked', `${staleCase.id} should be blocked by stale graph identity`);
    assert.ok(stale.blockers >= 1, `${staleCase.id} should record a graph identity blocker`);
    assert.equal(stale.applied, false, `${staleCase.id} must not apply mutations`);
    assertTermRelationshipsEvidenceRedacted(staleCase, staleShape);
  }
});

function assertTermRelationshipsGraphShape(testCase, { staleTarget }) {
  const termRows = Object.entries(testCase.local.db.wp_terms)
    .filter(([, row]) => typeof row.name === 'string'
      && row.name.startsWith('Generated wp_term_relationships term target '));
  const taxonomyRows = Object.entries(testCase.local.db.wp_term_taxonomy)
    .filter(([, row]) => typeof row.description === 'string'
      && row.description.startsWith('Generated wp_term_relationships taxonomy target '));

  assert.equal(termRows.length, 1, `${testCase.id} should carry one relationship target term`);
  assert.equal(taxonomyRows.length, 1, `${testCase.id} should carry one relationship target taxonomy`);

  const [termRowId, term] = termRows[0];
  const [taxonomyRowId, taxonomy] = taxonomyRows[0];
  const relationshipRowId = `object_id:1|term_taxonomy_id:${taxonomy.term_taxonomy_id}`;
  const relationship = testCase.local.db.wp_term_relationships[relationshipRowId];
  const remoteOnlyPrefix = staleTarget ? 'stale-wp-term-relationships' : 'ready-wp-term-relationships';
  const remoteOnlyPaths = Object.keys(testCase.remote.files)
    .filter((path) => path.includes(`${remoteOnlyPrefix}-remote-only-`)
      && !Object.hasOwn(testCase.base.files, path)
      && !Object.hasOwn(testCase.local.files, path));

  assert.ok(relationship, `${testCase.id} should create one relationship for the target taxonomy`);
  assert.equal(remoteOnlyPaths.length, 1, `${testCase.id} should seed one relationship remote-only preservation file`);
  assert.ok(testCase.base.db.wp_posts[`ID:${relationship.object_id}`], `${testCase.id} relationship post should exist`);
  assert.equal(taxonomy.term_id, term.term_id, `${testCase.id} taxonomy should reference the target term`);
  assert.equal(
    relationship.term_taxonomy_id,
    taxonomy.term_taxonomy_id,
    `${testCase.id} relationship should reference the target taxonomy`,
  );
  assert.equal(relationship.term_order, 0);
  assert.equal(testCase.base.db.wp_term_relationships[relationshipRowId], undefined);
  assert.equal(testCase.remote.db.wp_term_relationships[relationshipRowId], undefined);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_terms[termRowId], `${testCase.id} stale term target should exist in base`);
    assert.ok(
      testCase.base.db.wp_term_taxonomy[taxonomyRowId],
      `${testCase.id} stale taxonomy target should exist in base`,
    );
    assert.deepEqual(
      testCase.remote.db.wp_terms[termRowId],
      testCase.base.db.wp_terms[termRowId],
      `${testCase.id} stale term target should not drift`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_term_taxonomy[taxonomyRowId],
      testCase.base.db.wp_term_taxonomy[taxonomyRowId],
      `${testCase.id} stale taxonomy target should drift remotely`,
    );
  } else {
    assert.equal(testCase.base.db.wp_terms[termRowId], undefined);
    assert.equal(testCase.remote.db.wp_terms[termRowId], undefined);
    assert.equal(testCase.base.db.wp_term_taxonomy[taxonomyRowId], undefined);
    assert.equal(testCase.remote.db.wp_term_taxonomy[taxonomyRowId], undefined);
  }

  return {
    termRowId,
    taxonomyRowId,
    relationshipRowId,
    remoteOnlyPath: remoteOnlyPaths[0],
    termRow: term,
    taxonomyRow: taxonomy,
    relationshipRow: relationship,
    remoteTaxonomyRow: testCase.remote.db.wp_term_taxonomy[taxonomyRowId],
  };
}

function assertTermRelationshipsEvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const termResourceKey = generatedRowResourceKey('wp_terms', shape.termRowId);
  const taxonomyResourceKey = generatedRowResourceKey('wp_term_taxonomy', shape.taxonomyRowId);
  const relationshipResourceKey = generatedRowResourceKey('wp_term_relationships', shape.relationshipRowId);
  const graphResourceKeys = new Set([termResourceKey, taxonomyResourceKey, relationshipResourceKey]);
  const relatedMutations = plan.mutations.filter((mutation) => graphResourceKeys.has(mutation.resourceKey));
  const relatedBlockers = plan.blockers.filter((blocker) =>
    graphResourceKeys.has(blocker.resourceKey)
    || blocker.references?.some((reference) => graphResourceKeys.has(reference.targetResourceKey)));

  if (plan.status === 'ready') {
    assert.equal(relatedMutations.length, 3, `${testCase.id} should mutate term, taxonomy, and relationship rows`);
  } else {
    assert.notEqual(plan.status, 'ready');
    assert.ok(relatedBlockers.length >= 1, `${testCase.id} should have relationship graph blockers`);
  }

  const redacted = redactEvidence({
    status: plan.status,
    mutations: relatedMutations.map((mutation) => ({
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: mutation.change,
      value: mutation.value,
    })),
    blockers: relatedBlockers,
  });
  const redactedJson = JSON.stringify(redacted);

  if (relatedMutations.length > 0) {
    assert.ok(redactedJson.includes(EVIDENCE_REDACTION_MARKER), 'mutation values should be redacted in evidence');
    assert.ok(redactedJson.includes('sha256'), 'redacted relationship evidence should keep hashes');
  }

  const values = [
    shape.termRow?.name,
    shape.termRow?.slug,
    shape.taxonomyRow?.description,
    shape.remoteTaxonomyRow?.description,
  ].filter(Boolean).map(String);

  for (const value of values) {
    assert.equal(
      redactedJson.includes(value),
      false,
      `${testCase.id} redacted evidence should not expose ${value}`,
    );
  }
}

test('RPP-0153 wp_term_relationships graph variant 3 records ready apply and stale non-ready coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermRelationshipsGraphVariant3;

  assert.ok(coverage, 'missing wp_term_relationships graph variant 3 target coverage');
  assert.equal(coverage.family, 'wp-term-relationships-graph-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-term-relationships-graph-v3']);
  assert.equal(coverage.total, 10);
  assert.equal(coverage.statuses.ready, 5);
  assert.equal(nonReadyTargetCount(coverage), 5);
  assert.equal(report.summary.featureFamilies['wp-term-relationships-graph-v3-ready'], 5);
  assert.equal(report.summary.featureFamilies['wp-term-relationships-graph-v3-stale'], 5);
  assert.equal(report.summary.featureFamilies['wp-term-relationships-graph-v3-non-ready'], 5);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 1])),
  );

  const summaryEvidence = JSON.stringify(report);
  assert.equal(summaryEvidence.includes('Generated wp_term_relationships'), false, 'summary leaked relationship term/taxonomy value');
  assert.equal(summaryEvidence.includes('Remote stale wp_term_relationships'), false, 'summary leaked stale relationship value');
  assert.equal(
    summaryEvidence.includes('Remote preserved wp_term_relationships graph note'),
    false,
    'summary leaked remote-only relationship note',
  );

  const firstEvidence = generatedWpTermRelationshipsGraphVariant3Evidence(coverage);
  const replayEvidence = generatedWpTermRelationshipsGraphVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0153 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 relationship evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpTermRelationshipsGraphVariant3');
  assert.equal(firstEvidence.family, 'wp-term-relationships-graph-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 3 });
  assert.equal(readyCase.graphMutations.term.changeKind, 'create');
  assert.equal(readyCase.graphMutations.taxonomy.changeKind, 'create');
  assert.equal(readyCase.graphMutations.relationship.changeKind, 'create');
  assert.equal(readyCase.graphMutations.term.appliedHash, readyCase.surface.term.localHash);
  assert.equal(readyCase.graphMutations.taxonomy.appliedHash, readyCase.surface.taxonomy.localHash);
  assert.equal(readyCase.graphMutations.relationship.appliedHash, readyCase.surface.relationship.localHash);
  assert.equal(readyCase.remoteOnlyPreservation.preserved, true);
  assert.equal(readyCase.remoteOnlyPreservation.remoteBeforeHash, readyCase.remoteOnlyPreservation.appliedHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.notEqual(nonReadyCase.status, 'ready');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.relationship.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.taxonomy.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedGraphMutation, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_term_relationships.term_taxonomy_id']);
  assert.match(nonReadyCase.staleBlocker.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated wp_term_relationships'), false, 'variant 3 evidence leaked relationship value');
  assert.equal(evidenceText.includes('generated-wp-term-relationships'), false, 'variant 3 evidence leaked relationship slug');
  assert.equal(evidenceText.includes('Remote stale wp_term_relationships'), false, 'variant 3 evidence leaked stale relationship value');
  assert.equal(
    evidenceText.includes('Remote preserved wp_term_relationships graph note'),
    false,
    'variant 3 evidence leaked remote-only relationship note',
  );
});

test('RPP-0173 wp_term_relationships graph variant 4 retains ready apply and stale refusal regression coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpTermRelationshipsGraphVariant4;

  assert.ok(coverage, 'missing wp_term_relationships graph variant 4 target coverage');
  assert.equal(coverage.family, 'wp-term-relationships-graph-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-term-relationships-graph-v4']);
  assert.equal(coverage.total, 10);
  assert.equal(coverage.statuses.ready, 5);
  assert.equal(nonReadyTargetCount(coverage), 5);
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready relationship graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include stale relationship graph cases');
  assert.equal(report.summary.featureFamilies['wp-term-relationships-graph-v4-ready'], 5);
  assert.equal(report.summary.featureFamilies['wp-term-relationships-graph-v4-stale'], 5);
  assert.equal(report.summary.featureFamilies['wp-term-relationships-graph-v4-non-ready'], 5);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 1])),
  );

  const summaryEvidence = JSON.stringify(report);
  assert.equal(summaryEvidence.includes('Generated wp_term_relationships'), false, 'summary leaked relationship term/taxonomy value');
  assert.equal(summaryEvidence.includes('Remote stale wp_term_relationships'), false, 'summary leaked stale relationship value');
  assert.equal(
    summaryEvidence.includes('Remote preserved wp_term_relationships graph note'),
    false,
    'summary leaked remote-only relationship note',
  );

  const firstEvidence = generatedWpTermRelationshipsGraphVariant4Evidence(coverage);
  const replayEvidence = generatedWpTermRelationshipsGraphVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0173 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 relationship evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpTermRelationshipsGraphVariant4');
  assert.equal(firstEvidence.family, 'wp-term-relationships-graph-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes('wp-term-relationships-graph-v4-ready'));
  assert.ok(nonReadyCase.tags.includes('wp-term-relationships-graph-v4-stale'));
  assert.ok(nonReadyCase.tags.includes('wp-term-relationships-graph-v4-non-ready'));
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 3 });
  assert.equal(readyCase.graphMutations.term.changeKind, 'create');
  assert.equal(readyCase.graphMutations.taxonomy.changeKind, 'create');
  assert.equal(readyCase.graphMutations.relationship.changeKind, 'create');
  assert.equal(readyCase.graphMutations.term.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.taxonomy.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.relationship.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.term.appliedHash, readyCase.surface.term.localHash);
  assert.equal(readyCase.graphMutations.taxonomy.appliedHash, readyCase.surface.taxonomy.localHash);
  assert.equal(readyCase.graphMutations.relationship.appliedHash, readyCase.surface.relationship.localHash);
  assert.equal(readyCase.remoteOnlyPreservation.preserved, true);
  assert.equal(readyCase.remoteOnlyPreservation.remoteBeforeHash, readyCase.remoteOnlyPreservation.appliedHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.status, 'blocked');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.relationship.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.taxonomy.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedGraphMutation, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_term_relationships.term_taxonomy_id']);
  assert.match(nonReadyCase.staleBlocker.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('Generated wp_term_relationships'), false, 'variant 4 evidence leaked relationship value');
  assert.equal(evidenceText.includes('generated-wp-term-relationships'), false, 'variant 4 evidence leaked relationship slug');
  assert.equal(evidenceText.includes('Remote stale wp_term_relationships'), false, 'variant 4 evidence leaked stale relationship value');
  assert.equal(
    evidenceText.includes('Remote preserved wp_term_relationships graph note'),
    false,
    'variant 4 evidence leaked remote-only relationship note',
  );
});

function generatedWpTermRelationshipsGraphVariant3Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('wp-term-relationships-graph-v3')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedWpTermRelationshipsGraphVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'stale-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 3 relationship target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 3 relationship target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 3 relationship target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 3 target should select one ready relationship case');
  assert.ok(selectedCases.has('stale-non-ready'), 'variant 3 target should select one stale non-ready relationship case');

  return {
    target: 'wpTermRelationshipsGraphVariant3',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('stale-non-ready'),
    ],
  };
}

function generatedWpTermRelationshipsGraphVariant4Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('wp-term-relationships-graph-v4')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const staleTarget = testCase.tags.has('wp-term-relationships-graph-v4-stale');

    assert.equal(
      staleTarget,
      testCase.tags.has('wp-term-relationships-graph-stale'),
      `${testCase.id} variant 4 stale tag should match relationship graph stale tag`,
    );
    assert.equal(
      testCase.tags.has('wp-term-relationships-graph-v4-ready'),
      testCase.tags.has('wp-term-relationships-graph-ready'),
      `${testCase.id} variant 4 ready tag should match relationship graph ready tag`,
    );
    assert.equal(
      testCase.tags.has('wp-term-relationships-graph-v4-non-ready'),
      staleTarget,
      `${testCase.id} variant 4 non-ready tag should match stale relationship graph target`,
    );

    const evidence = generatedWpTermRelationshipsGraphVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'stale-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 4 relationship target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 4 relationship target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 4 relationship target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 4 target should select one ready relationship case');
  assert.ok(selectedCases.has('stale-non-ready'), 'variant 4 target should select one stale non-ready relationship case');

  return {
    target: 'wpTermRelationshipsGraphVariant4',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('stale-non-ready'),
    ],
  };
}

function generatedWpTermRelationshipsGraphVariant3CaseEvidence(testCase, result) {
  const staleTarget = testCase.tags.has('wp-term-relationships-graph-v3-stale');
  assert.equal(
    staleTarget,
    testCase.tags.has('wp-term-relationships-graph-stale'),
    `${testCase.id} variant 3 stale tag should match relationship graph stale tag`,
  );
  assert.equal(
    testCase.tags.has('wp-term-relationships-graph-v3-ready'),
    testCase.tags.has('wp-term-relationships-graph-ready'),
    `${testCase.id} variant 3 ready tag should match relationship graph ready tag`,
  );

  const shape = assertTermRelationshipsGraphShape(testCase, { staleTarget });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = wpTermRelationshipsGraphVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'stale-non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  assertTermRelationshipsEvidenceRedacted(testCase, shape);

  if (result.status === 'ready') {
    assert.equal(staleTarget, false, `${testCase.id} ready evidence should not use stale graph target`);
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const {
      plannedChangeKinds,
      graphMutations,
      remoteOnlyPreservation,
    } = wpTermRelationshipsGraphVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      graphMutations,
      remoteOnlyPreservation,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        graphMutations,
        remoteOnlyPreservation,
      })}`,
    };
  }

  assert.equal(staleTarget, true, `${testCase.id} non-ready evidence should use stale graph target`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const staleBlocker = wpTermRelationshipsGraphVariant3StaleBlockerEvidence({ testCase, plan, shape });
  const refusal = wpTermRelationshipsGraphVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    staleBlocker,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      staleBlocker,
      refusal,
    })}`,
  };
}

function wpTermRelationshipsGraphVariant3SurfaceEvidence(testCase, shape) {
  const termResource = rowResource('wp_terms', shape.termRowId);
  const taxonomyResource = rowResource('wp_term_taxonomy', shape.taxonomyRowId);
  const relationshipResource = rowResource('wp_term_relationships', shape.relationshipRowId);
  const remoteOnlyResource = { type: 'file', path: shape.remoteOnlyPath, key: `file:${shape.remoteOnlyPath}` };

  return {
    term: {
      resourceKey: termResource.key,
      baseHash: resourceHash(testCase.base, termResource),
      localHash: resourceHash(testCase.local, termResource),
      remoteHash: resourceHash(testCase.remote, termResource),
      termIdHash: `sha256:${digest(shape.termRowId)}`,
      slugHash: `sha256:${digest(shape.termRow.slug)}`,
    },
    taxonomy: {
      resourceKey: taxonomyResource.key,
      baseHash: resourceHash(testCase.base, taxonomyResource),
      localHash: resourceHash(testCase.local, taxonomyResource),
      remoteHash: resourceHash(testCase.remote, taxonomyResource),
      termIdHash: `sha256:${digest(String(shape.taxonomyRow.term_id))}`,
      taxonomyHash: `sha256:${digest(shape.taxonomyRow.taxonomy)}`,
      descriptionHash: `sha256:${digest(shape.taxonomyRow.description)}`,
    },
    relationship: {
      resourceKey: relationshipResource.key,
      baseHash: resourceHash(testCase.base, relationshipResource),
      localHash: resourceHash(testCase.local, relationshipResource),
      remoteHash: resourceHash(testCase.remote, relationshipResource),
      objectIdHash: `sha256:${digest(String(shape.relationshipRow.object_id))}`,
      taxonomyIdHash: `sha256:${digest(String(shape.relationshipRow.term_taxonomy_id))}`,
      termOrderHash: `sha256:${digest(String(shape.relationshipRow.term_order))}`,
    },
    remoteOnly: {
      resourceKey: remoteOnlyResource.key,
      baseHash: resourceHash(testCase.base, remoteOnlyResource),
      localHash: resourceHash(testCase.local, remoteOnlyResource),
      remoteHash: resourceHash(testCase.remote, remoteOnlyResource),
    },
  };
}

function wpTermRelationshipsGraphVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { label: 'term', resource: rowResource('wp_terms', shape.termRowId), changeKind: 'create' },
    { label: 'taxonomy', resource: rowResource('wp_term_taxonomy', shape.taxonomyRowId), changeKind: 'create' },
    { label: 'relationship', resource: rowResource('wp_term_relationships', shape.relationshipRowId), changeKind: 'create' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};
  const graphMutations = {};

  for (const { label, resource, changeKind } of expected) {
    const mutation = mutations.get(resource.key);
    const precondition = preconditions.get(resource.key);
    const localHash = resourceHash(testCase.local, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.ok(mutation, `${testCase.id} should plan ${label} graph mutation for ${resource.key}`);
    assert.ok(precondition, `${testCase.id} should precondition ${label} graph mutation for ${resource.key}`);
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(appliedHash, localHash, `${testCase.id} did not apply local ${label} graph row`);
    incrementCount(plannedChangeKinds, changeKind);

    graphMutations[label] = {
      resourceKey: resource.key,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      preconditionExpectedHash: precondition.expectedHash,
      appliedHash,
      plannedMutation: true,
      plannedPrecondition: true,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })}`,
    };
  }

  const remoteOnlyResource = { type: 'file', path: shape.remoteOnlyPath, key: `file:${shape.remoteOnlyPath}` };
  const remoteBeforeHash = resourceHash(testCase.remote, remoteOnlyResource);
  const appliedHash = resourceHash(applied.site, remoteOnlyResource);
  assert.equal(appliedHash, remoteBeforeHash, `${testCase.id} overwrote unplanned relationship remote-only file`);

  return {
    plannedChangeKinds: sortStringObject(plannedChangeKinds),
    graphMutations,
    remoteOnlyPreservation: {
      resourceKey: remoteOnlyResource.key,
      remoteBeforeHash,
      appliedHash,
      preserved: true,
    },
  };
}

function wpTermRelationshipsGraphVariant3StaleBlockerEvidence({ testCase, plan, shape }) {
  const termResourceKey = rowResourceKey('wp_terms', shape.termRowId);
  const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', shape.taxonomyRowId);
  const relationshipResourceKey = rowResourceKey('wp_term_relationships', shape.relationshipRowId);
  const graphResourceKeys = new Set([termResourceKey, taxonomyResourceKey, relationshipResourceKey]);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === relationshipResourceKey
    && entry.references?.some((reference) => reference.targetResourceKey === taxonomyResourceKey));
  const taxonomyDecision = plan.decisions.find((entry) => entry.resourceKey === taxonomyResourceKey);
  const plannedGraphMutation = plan.mutations.some((mutation) => graphResourceKeys.has(mutation.resourceKey));

  assert.ok(blocker, `${testCase.id} should report a stale term-relationship graph blocker`);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.ok(taxonomyDecision, `${testCase.id} should keep the stale remote taxonomy`);
  assert.equal(taxonomyDecision.decision, 'keep-remote');
  assert.equal(plannedGraphMutation, false, `${testCase.id} should not plan stale relationship graph mutations`);

  return {
    resourceKey: blocker.resourceKey,
    class: blocker.class,
    plannedGraphMutation,
    relationshipKeys: blocker.references.map((reference) => reference.relationshipKey).sort(),
    targetResourceKey: taxonomyResourceKey,
    targetChange: blocker.references.find((reference) => reference.targetResourceKey === taxonomyResourceKey).targetChange,
    blockerHash: `sha256:${digest(blocker)}`,
    decision: {
      resourceKey: taxonomyDecision.resourceKey,
      decision: taxonomyDecision.decision,
      decisionHash: `sha256:${digest(taxonomyDecision)}`,
    },
  };
}

function wpTermRelationshipsGraphVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}


test('RPP-0117 stale remote after dry-run target exposes per-tier ready replay rejection counts', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.staleRemoteAfterDryRun;

  assert.ok(coverage, 'missing stale remote after dry-run target coverage');
  assert.equal(coverage.family, 'ready-plan-stale-remote-after-dry-run');
  assert.equal(coverage.total, 344);
  assert.deepEqual(coverage.statuses, { ready: coverage.total });
  assert.deepEqual(coverage.perTier, {
    0: 34,
    1: 34,
    2: 35,
    3: 34,
    4: 35,
    5: 34,
    6: 35,
    7: 34,
    8: 35,
    9: 34,
  });
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(
    Object.values(coverage.perTier).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.ok(coverage.total < report.summary.statuses.ready, 'zero-mutation ready cases should not count');

  const readyCase = generatePushHarnessCases()
    .find((testCase) => {
      const result = validateGeneratedCase(testCase);
      return result.status === 'ready' && result.staleReplayRejected === true;
    });

  assert.ok(readyCase, 'missing ready case with stale remote replay rejection');
  const result = validateGeneratedCase(readyCase);

  assert.equal(result.status, 'ready');
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true);
});

test('RPP-0137 stale remote after dry-run variant 2 proves hash-only per-tier replay refusals', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.staleRemoteAfterDryRun;

  assert.ok(coverage, 'missing stale remote after dry-run target coverage');

  const firstEvidence = generatedStaleRemoteAfterDryRunVariant2Evidence(coverage);
  const replayEvidence = generatedStaleRemoteAfterDryRunVariant2Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0137 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'ready-plan-stale-remote-after-dry-run');
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 2 stale replay evidence changed between runs');
  assert.equal(firstEvidence.target, 'staleRemoteAfterDryRun');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(firstEvidence.selectedCases.length, 10, 'variant 2 evidence should select one stale replay case per tier');
  assert.equal(
    Object.values(firstEvidence.perTier).reduce((sum, count) => sum + count, 0),
    firstEvidence.totalCases,
  );

  for (const entry of firstEvidence.selectedCases) {
    assert.equal(entry.status, 'ready', `${entry.id} should be a ready stale replay target`);
    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.equal(entry.staleReplay.remoteBeforeHash, entry.staleReplay.remoteAfterHash);
    assert.equal(entry.staleReplay.expectedHash, entry.staleReplay.mutationRemoteBeforeHash);
    assert.notEqual(entry.staleReplay.actualHash, entry.staleReplay.expectedHash);
    assert.match(entry.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.plannedValueHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.preconditionHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('stale-private-rpp0137'), false, 'variant 2 evidence leaked stale replay payload');
  assert.equal(evidenceText.includes('local-private'), false, 'variant 2 evidence leaked generated local payload');
  assert.equal(evidenceText.includes('remote-private'), false, 'variant 2 evidence leaked generated remote payload');
});

test('RPP-0157 stale remote after dry-run variant 3 exposes per-tier hash-only replay refusals', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.staleRemoteAfterDryRunVariant3;
  const legacyCoverage = report.summary.targetCoverage.staleRemoteAfterDryRun;

  assert.ok(coverage, 'missing stale remote after dry-run variant 3 target coverage');
  assert.ok(legacyCoverage, 'missing stale remote after dry-run legacy target coverage');

  const firstEvidence = generatedStaleRemoteAfterDryRunVariant3Evidence(coverage);
  const replayEvidence = generatedStaleRemoteAfterDryRunVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0157 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'ready-plan-stale-remote-after-dry-run-variant3');
  assert.equal(coverage.total, legacyCoverage.total);
  assert.deepEqual(coverage.perTier, legacyCoverage.perTier);
  assert.deepEqual(coverage.statuses, legacyCoverage.statuses);
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 stale replay evidence changed between runs');
  assert.equal(firstEvidence.target, 'staleRemoteAfterDryRunVariant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    Object.keys(firstEvidence.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(firstEvidence.selectedCases.length, 10, 'variant 3 evidence should select one replay refusal per tier');
  assert.equal(
    Object.values(firstEvidence.perTier).reduce((sum, count) => sum + count, 0),
    firstEvidence.totalCases,
  );

  for (const entry of firstEvidence.selectedCases) {
    assert.equal(entry.status, 'ready', `${entry.id} should be a ready stale replay target`);
    assert.ok(entry.staleReplay.mutationCount > 1, `${entry.id} should prove a non-leading mutation precondition`);
    assert.equal(entry.staleReplay.mutationIndex, entry.staleReplay.mutationCount - 1);
    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.equal(entry.staleReplay.remoteBeforeHash, entry.staleReplay.remoteAfterHash);
    assert.equal(entry.staleReplay.expectedHash, entry.staleReplay.mutationRemoteBeforeHash);
    assert.notEqual(entry.staleReplay.actualHash, entry.staleReplay.expectedHash);
    assert.match(entry.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.plannedValueHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.preconditionHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('stale-private-rpp0157'), false, 'variant 3 evidence leaked stale replay payload');
  assert.equal(evidenceText.includes('local-private'), false, 'variant 3 evidence leaked generated local payload');
  assert.equal(evidenceText.includes('remote-private'), false, 'variant 3 evidence leaked generated remote payload');
});

test('RPP-0177 stale remote after dry-run variant 4 exposes per-tier midpoint replay refusals', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.staleRemoteAfterDryRunVariant4;
  const legacyCoverage = report.summary.targetCoverage.staleRemoteAfterDryRun;
  const variant3Coverage = report.summary.targetCoverage.staleRemoteAfterDryRunVariant3;

  assert.ok(coverage, 'missing stale remote after dry-run variant 4 target coverage');
  assert.ok(legacyCoverage, 'missing stale remote after dry-run legacy target coverage');
  assert.ok(variant3Coverage, 'missing stale remote after dry-run variant 3 target coverage');

  const firstEvidence = generatedStaleRemoteAfterDryRunVariant4Evidence(coverage);
  const replayEvidence = generatedStaleRemoteAfterDryRunVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0177 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.equal(coverage.family, 'ready-plan-stale-remote-after-dry-run-variant4');
  assert.equal(coverage.total, legacyCoverage.total);
  assert.equal(coverage.total, variant3Coverage.total);
  assert.deepEqual(coverage.perTier, legacyCoverage.perTier);
  assert.deepEqual(coverage.perTier, variant3Coverage.perTier);
  assert.deepEqual(coverage.statuses, legacyCoverage.statuses);
  assert.deepEqual(coverage.statuses, variant3Coverage.statuses);
  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 stale replay evidence changed between runs');
  assert.equal(firstEvidence.target, 'staleRemoteAfterDryRunVariant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    Object.keys(firstEvidence.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.tier),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(firstEvidence.selectedCases.length, 10, 'variant 4 evidence should select one replay refusal per tier');
  assert.equal(
    Object.values(firstEvidence.perTier).reduce((sum, count) => sum + count, 0),
    firstEvidence.totalCases,
  );

  for (const entry of firstEvidence.selectedCases) {
    assert.equal(entry.status, 'ready', `${entry.id} should be a ready stale replay target`);
    assert.ok(entry.staleReplay.mutationCount > 2, `${entry.id} should prove a midpoint mutation precondition`);
    assert.ok(entry.staleReplay.mutationIndex > 0, `${entry.id} midpoint mutation should not be first`);
    assert.ok(
      entry.staleReplay.mutationIndex < entry.staleReplay.mutationCount - 1,
      `${entry.id} midpoint mutation should not be last`,
    );
    assert.equal(entry.staleReplay.preconditionCount, entry.staleReplay.mutationCount);
    assert.equal(entry.staleReplay.code, 'PRECONDITION_FAILED');
    assert.equal(entry.staleReplay.remoteBeforeHash, entry.staleReplay.remoteAfterHash);
    assert.equal(entry.staleReplay.expectedHash, entry.staleReplay.mutationRemoteBeforeHash);
    assert.notEqual(entry.staleReplay.actualHash, entry.staleReplay.expectedHash);
    assert.match(entry.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.plannedValueHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.staleReplay.preconditionHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(entry.modelProofHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('stale-private-rpp0177'), false, 'variant 4 evidence leaked stale replay payload');
  assert.equal(evidenceText.includes('local-private'), false, 'variant 4 evidence leaked generated local payload');
  assert.equal(evidenceText.includes('remote-private'), false, 'variant 4 evidence leaked generated remote payload');
});


test('RPP-0114/RPP-0134 plugin-owned option target exposes ready, conflict, and redacted coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedOptionChange;

  assert.ok(coverage, 'missing plugin-owned option target coverage');
  assert.equal(coverage.family, 'plugin-owned-option-change-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-option-change']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready plugin-owned option cases');
  assert.ok(coverage.statuses.conflict > 0, 'target should include conflicting plugin-owned option cases');
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
  assert.equal(JSON.stringify(report).includes('private_plugin_owned_option'), false);
  assert.equal(JSON.stringify(report).includes('private-plugin-owned-option'), false);

  const cases = generatePushHarnessCases();
  const readyCase = cases.find((testCase) => testCase.family === 'plugin-owned-option-change-ready');
  const conflictCase = cases.find((testCase) => testCase.family === 'plugin-owned-option-change-conflict');

  assert.ok(readyCase, 'missing ready plugin-owned option case');
  assert.ok(conflictCase, 'missing conflicting plugin-owned option case');
  const readyShape = assertPluginOwnedOptionShape(readyCase, { conflict: false });
  const conflictShape = assertPluginOwnedOptionShape(conflictCase, { conflict: true });

  const ready = validateGeneratedCase(readyCase);
  const conflict = validateGeneratedCase(conflictCase);

  assert.equal(ready.status, 'ready');
  assert.ok(ready.mutations >= 1, 'ready plugin-owned option should plan a mutation');
  assert.equal(ready.applied, true, 'ready plugin-owned option should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready plugin-owned option should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready plugin-owned option should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.equal(conflict.status, 'conflict');
  assert.ok(conflict.conflicts >= 1, 'remote plugin-owned option drift should be a conflict');
  assert.equal(conflict.applied, false, 'conflicting plugin-owned option must not apply mutations');

  assertPluginOwnedOptionEvidenceRedacted(readyCase, readyShape);
  assertPluginOwnedOptionEvidenceRedacted(conflictCase, conflictShape);
});

test('RPP-0154 plugin-owned option changes variant 3 rejects stale replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedOptionChangeVariant3;

  assert.ok(coverage, 'missing plugin-owned option variant 3 target coverage');
  assert.equal(coverage.family, 'plugin-owned-option-change-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-option-change-v3']);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.statuses.ready, 10);
  assert.equal(coverage.statuses.conflict, 10);
  assert.equal(report.summary.featureFamilies['plugin-owned-option-change-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['plugin-owned-option-change-v3-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(JSON.stringify(report).includes('private-plugin-owned-option'), false);
  assert.equal(JSON.stringify(report).includes('private_plugin_owned_option'), false);

  const firstEvidence = generatedPluginOwnedOptionChangeVariant3Evidence(coverage);
  const replayEvidence = generatedPluginOwnedOptionChangeVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0154 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 plugin-owned option evidence changed between runs');
  assert.equal(firstEvidence.target, 'pluginOwnedOptionChangeVariant3');
  assert.equal(firstEvidence.family, 'plugin-owned-option-change-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, coverage.statuses.conflict);
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'conflict-non-ready'],
  );

  const [readyCase, conflictCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.optionMutation.changeKind, 'update');
  assert.equal(readyCase.optionMutation.pluginOwner, 'forms');
  assert.equal(readyCase.optionMutation.driver, 'wp-option');
  assert.equal(readyCase.optionMutation.ownerContextRequired, true);
  assert.equal(readyCase.optionMutation.appliedHash, readyCase.surface.localHash);
  assert.equal(readyCase.optionMutation.plannedPrecondition, true);
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.resourceKey, readyCase.surface.resourceKey);
  assert.equal(readyCase.staleReplay.expectedHash, readyCase.optionMutation.remoteBeforeHash);
  assert.notEqual(readyCase.staleReplay.actualHash, readyCase.staleReplay.expectedHash);
  assert.equal(readyCase.staleReplay.remoteBeforeHash, readyCase.staleReplay.remoteAfterHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(conflictCase.status, 'conflict');
  assert.equal(conflictCase.applied, false);
  assert.equal(conflictCase.conflict.class, 'plugin-data-conflict');
  assert.equal(conflictCase.conflict.pluginOwner, 'forms');
  assert.equal(conflictCase.conflict.plannedMutation, false);
  assert.equal(conflictCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(conflictCase.refusal.remoteBeforeHash, conflictCase.refusal.remoteAfterHash);
  assert.match(conflictCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('base-private-plugin-owned-option'), false, 'variant 3 evidence leaked base option value');
  assert.equal(evidenceText.includes('local-private-plugin-owned-option'), false, 'variant 3 evidence leaked local option value');
  assert.equal(evidenceText.includes('remote-private-plugin-owned-option'), false, 'variant 3 evidence leaked remote option value');
  assert.equal(evidenceText.includes('plugin-owned-option-local-'), false, 'variant 3 evidence leaked local token value');
  assert.equal(evidenceText.includes('plugin-owned-option-remote-'), false, 'variant 3 evidence leaked remote token value');
  assert.equal(evidenceText.includes('private_token'), false, 'variant 3 evidence leaked private token keys');
  assert.equal(evidenceText.includes('private_notes'), false, 'variant 3 evidence leaked private note keys');
});

test('RPP-0444 generated wp_options driver semantics variant 3 preserves plugin-owned remote drift', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpOptionsDriverSemanticsVariant3;

  assert.ok(coverage, 'missing wp_options driver semantics variant 3 target coverage');
  assert.equal(coverage.family, 'wp-options-driver-semantics-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-options-driver-semantics-v3']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.equal(report.summary.featureFamilies['wp-options-driver-semantics-v3-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-options-driver-semantics-v3-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(JSON.stringify(report).includes('base-private-plugin-owned-option'), false);
  assert.equal(JSON.stringify(report).includes('local-private-plugin-owned-option'), false);
  assert.equal(JSON.stringify(report).includes('remote-private-plugin-owned-option'), false);

  const firstEvidence = generatedWpOptionsDriverSemanticsVariant3Evidence(coverage);
  const replayEvidence = generatedWpOptionsDriverSemanticsVariant3Evidence(coverage);
  const evidenceEnvelope = {
    rpp: 'RPP-0444',
    command: 'node --test --test-name-pattern=RPP-0444 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; final release remains NO-GO.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'RPP-0444 wp_options driver semantics evidence changed between runs');
  assert.equal(firstEvidence.rpp, 'RPP-0444');
  assert.equal(firstEvidence.target, 'wpOptionsDriverSemanticsVariant3');
  assert.equal(firstEvidence.family, 'wp-options-driver-semantics-variant3');
  assert.equal(firstEvidence.verdict, 'REMOTE_DRIFT_PRESERVES_PLUGIN_OWNED_REMOTE_DATA');
  assert.equal(firstEvidence.releaseGate, 'NO-GO');
  assert.equal(firstEvidence.productionBacked, false);
  assert.equal(firstEvidence.rawValuesIncluded, false);
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);

  const [readyCase, conflictCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.ok(readyCase.tags.includes('wp-options-driver-semantics-v3-ready'));
  assert.equal(readyCase.optionMutation.pluginOwner, 'forms');
  assert.equal(readyCase.optionMutation.driver, 'wp-option');
  assert.equal(readyCase.optionMutation.ownerContextRequired, true);
  assert.equal(readyCase.optionMutation.supportsDelete, false);
  assert.equal(readyCase.optionMutation.plannedMutation, true);
  assert.equal(readyCase.optionMutation.plannedPrecondition, true);
  assert.match(readyCase.optionMutation.auditEvidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(readyCase.optionMutation.driverDecisionEvidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.expectedHash, readyCase.optionMutation.remoteBeforeHash);
  assert.notEqual(readyCase.staleReplay.actualHash, readyCase.staleReplay.expectedHash);
  assert.equal(readyCase.staleReplay.rowHashAfter, readyCase.staleReplay.rowHashBefore);
  assert.equal(readyCase.staleReplay.remoteBeforeHash, readyCase.staleReplay.remoteAfterHash);
  assert.equal(readyCase.staleReplay.remoteDataPreserved, true);
  assert.match(readyCase.staleReplay.detailsHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(conflictCase.status, 'conflict');
  assert.ok(conflictCase.tags.includes('wp-options-driver-semantics-v3-non-ready'));
  assert.equal(conflictCase.applied, false);
  assert.equal(conflictCase.conflict.class, 'plugin-data-conflict');
  assert.equal(conflictCase.conflict.pluginOwner, 'forms');
  assert.equal(conflictCase.conflict.plannedMutation, false);
  assert.equal(conflictCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(conflictCase.refusal.remoteBeforeHash, conflictCase.refusal.remoteAfterHash);
  assert.match(conflictCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('option_value'), false, 'RPP-0444 evidence leaked option_value fields');
  assert.equal(evidenceText.includes('base-private-plugin-owned-option'), false, 'RPP-0444 evidence leaked base option value');
  assert.equal(evidenceText.includes('local-private-plugin-owned-option'), false, 'RPP-0444 evidence leaked local option value');
  assert.equal(evidenceText.includes('remote-private-plugin-owned-option'), false, 'RPP-0444 evidence leaked remote option value');
  assert.equal(evidenceText.includes('plugin-owned-option-local-'), false, 'RPP-0444 evidence leaked local token value');
  assert.equal(evidenceText.includes('plugin-owned-option-remote-'), false, 'RPP-0444 evidence leaked remote token value');
  assert.equal(evidenceText.includes('rpp0444-stale-replay'), false, 'RPP-0444 evidence leaked stale replay value');
  assert.equal(evidenceText.includes('private_token'), false, 'RPP-0444 evidence leaked private token keys');
  assert.equal(evidenceText.includes('private_notes'), false, 'RPP-0444 evidence leaked private note keys');
});

test('RPP-0174 plugin-owned option changes variant 4 rejects stale replay before mutation', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedOptionChangeVariant4;

  assert.ok(coverage, 'missing plugin-owned option variant 4 target coverage');
  assert.equal(coverage.family, 'plugin-owned-option-change-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-option-change-v4']);
  assert.equal(coverage.total, 20);
  assert.deepEqual(coverage.statuses, { conflict: 10, ready: 10 });
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready plugin-owned option cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready plugin-owned option cases');
  assert.equal(report.summary.featureFamilies['plugin-owned-option-change-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['plugin-owned-option-change-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(JSON.stringify(report).includes('private-plugin-owned-option'), false);
  assert.equal(JSON.stringify(report).includes('private_plugin_owned_option'), false);

  const firstEvidence = generatedPluginOwnedOptionChangeVariant4Evidence(coverage);
  const replayEvidence = generatedPluginOwnedOptionChangeVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0174 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 plugin-owned option evidence changed between runs');
  assert.equal(firstEvidence.target, 'pluginOwnedOptionChangeVariant4');
  assert.equal(firstEvidence.family, 'plugin-owned-option-change-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'conflict-non-ready'],
  );

  const [readyCase, conflictCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes('plugin-owned-option-change-v4-ready'));
  assert.ok(conflictCase.tags.includes('plugin-owned-option-change-v4-non-ready'));
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.optionMutation.changeKind, 'update');
  assert.equal(readyCase.optionMutation.pluginOwner, 'forms');
  assert.equal(readyCase.optionMutation.driver, 'wp-option');
  assert.equal(readyCase.optionMutation.ownerContextRequired, true);
  assert.equal(readyCase.optionMutation.appliedHash, readyCase.surface.localHash);
  assert.equal(readyCase.optionMutation.plannedPrecondition, true);
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.resourceKey, readyCase.surface.resourceKey);
  assert.equal(readyCase.staleReplay.expectedHash, readyCase.optionMutation.remoteBeforeHash);
  assert.notEqual(readyCase.staleReplay.actualHash, readyCase.staleReplay.expectedHash);
  assert.equal(readyCase.staleReplay.remoteBeforeHash, readyCase.staleReplay.remoteAfterHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(conflictCase.status, 'conflict');
  assert.equal(conflictCase.applied, false);
  assert.equal(conflictCase.conflict.class, 'plugin-data-conflict');
  assert.equal(conflictCase.conflict.pluginOwner, 'forms');
  assert.equal(conflictCase.conflict.plannedMutation, false);
  assert.equal(conflictCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(conflictCase.refusal.remoteBeforeHash, conflictCase.refusal.remoteAfterHash);
  assert.match(conflictCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('base-private-plugin-owned-option'), false, 'variant 4 evidence leaked base option value');
  assert.equal(evidenceText.includes('local-private-plugin-owned-option'), false, 'variant 4 evidence leaked local option value');
  assert.equal(evidenceText.includes('remote-private-plugin-owned-option'), false, 'variant 4 evidence leaked remote option value');
  assert.equal(evidenceText.includes('plugin-owned-option-local-'), false, 'variant 4 evidence leaked local token value');
  assert.equal(evidenceText.includes('plugin-owned-option-remote-'), false, 'variant 4 evidence leaked remote token value');
  assert.equal(evidenceText.includes('private_token'), false, 'variant 4 evidence leaked private token keys');
  assert.equal(evidenceText.includes('private_notes'), false, 'variant 4 evidence leaked private note keys');
});

function assertPluginOwnedOptionShape(testCase, { conflict }) {
  const optionRows = Object.entries(testCase.local.db.wp_options)
    .filter(([id, row]) => id.startsWith('option_name:generated_plugin_owned_option_')
      && row.__pluginOwner === 'forms');

  assert.equal(optionRows.length, 1, `${testCase.id} should include one generated plugin-owned option`);
  const [rowId, row] = optionRows[0];
  const resourceKey = `row:["wp_options","${rowId}"]`;
  const baseRow = testCase.base.db.wp_options[rowId];
  const remoteRow = testCase.remote.db.wp_options[rowId];

  assert.ok(baseRow, `${testCase.id} should have a base plugin-owned option row`);
  assert.ok(remoteRow, `${testCase.id} should have a remote plugin-owned option row`);
  assert.notDeepEqual(row.option_value, baseRow.option_value, `${testCase.id} should update option_value locally`);
  assert.match(baseRow.option_value.private_token, /^base-private-plugin-owned-option-token-/);
  assert.match(baseRow.option_value.private_notes, /^base-private-plugin-owned-option-notes-/);
  assert.match(row.option_value.private_token, /^local-private-plugin-owned-option-token-/);
  assert.match(row.option_value.private_notes, /^local-private-plugin-owned-option-notes-/);
  if (conflict) {
    assert.notDeepEqual(remoteRow.option_value, baseRow.option_value, `${testCase.id} should drift remotely`);
    assert.match(remoteRow.option_value.private_token, /^remote-private-plugin-owned-option-token-/);
    assert.match(remoteRow.option_value.private_notes, /^remote-private-plugin-owned-option-notes-/);
    return { rowId, baseRow, localRow: row, remoteRow, resourceKey };
  }

  assert.deepEqual(remoteRow.option_value, baseRow.option_value, `${testCase.id} remote should match base`);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations.find((candidate) => candidate.resourceKey === resourceKey);
  assert.ok(mutation, `${testCase.id} should plan the plugin-owned option mutation`);
  assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource?.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
  return { rowId, baseRow, localRow: row, remoteRow, resourceKey };
}

function assertPluginOwnedOptionEvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations.find((candidate) => candidate.resourceKey === shape.resourceKey);
  const relatedConflicts = plan.conflicts.filter((conflict) => conflict.resourceKey === shape.resourceKey);

  if (plan.status === 'ready') {
    assert.ok(mutation, `${testCase.id} should include plugin-owned option mutation`);
    assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
    assert.equal(mutation.pluginOwnedResource?.driver, 'wp-option');
    assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
    assert.match(mutation.localHash, /^[a-f0-9]{64}$/);
    assert.match(mutation.remoteBeforeHash, /^[a-f0-9]{64}$/);
  } else {
    assert.notEqual(plan.status, 'ready');
    assert.ok(relatedConflicts.length >= 1, `${testCase.id} should carry plugin-owned option conflict evidence`);
  }

  const redacted = redactEvidence({
    status: plan.status,
    mutations: mutation ? [{
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: mutation.change,
      pluginOwnedResource: mutation.pluginOwnedResource,
      value: mutation.value,
    }] : [],
    conflicts: relatedConflicts,
  });
  const redactedJson = JSON.stringify(redacted);

  if (mutation) {
    assert.ok(redactedJson.includes(EVIDENCE_REDACTION_MARKER), 'plugin-owned option values should be redacted');
    assert.ok(redactedJson.includes('sha256'), 'redacted plugin-owned option evidence should keep hashes');
  }
  assertPluginOwnedOptionRawValuesAbsent(testCase, shape, redactedJson);
}

function assertPluginOwnedOptionRawValuesAbsent(testCase, shape, redactedJson) {
  const privateValues = [
    shape.baseRow.option_value.private_token,
    shape.baseRow.option_value.private_notes,
    shape.localRow.option_value.private_token,
    shape.localRow.option_value.private_notes,
    shape.remoteRow.option_value.private_token,
    shape.remoteRow.option_value.private_notes,
    'base-private-plugin-owned-option-token',
    'local-private-plugin-owned-option-token',
    'remote-private-plugin-owned-option-token',
    'private-plugin-owned-option-notes',
  ].filter(Boolean).map(String);

  for (const value of privateValues) {
    assert.equal(
      redactedJson.includes(value),
      false,
      `${testCase.id} redacted plugin-owned option evidence leaked ${value}`,
    );
  }
}

function generatedPluginOwnedOptionChangeVariant3Evidence(targetCoverage) {
  return generatedPluginOwnedOptionChangeVariantEvidence(targetCoverage, {
    target: 'pluginOwnedOptionChangeVariant3',
    tag: 'plugin-owned-option-change-v3',
    label: 'variant 3',
    staleReplayPrefix: 'rpp0154',
  });
}

function generatedPluginOwnedOptionChangeVariant4Evidence(targetCoverage) {
  return generatedPluginOwnedOptionChangeVariantEvidence(targetCoverage, {
    target: 'pluginOwnedOptionChangeVariant4',
    tag: 'plugin-owned-option-change-v4',
    label: 'variant 4',
    staleReplayPrefix: 'rpp0174',
  });
}

function generatedWpOptionsDriverSemanticsVariant3Evidence(targetCoverage) {
  const evidence = generatedPluginOwnedOptionChangeVariantEvidence(targetCoverage, {
    target: 'wpOptionsDriverSemanticsVariant3',
    tag: 'wp-options-driver-semantics-v3',
    label: 'RPP-0444 wp_options driver semantics variant 3',
    staleReplayPrefix: 'rpp0444',
  });

  return {
    rpp: 'RPP-0444',
    verdict: 'REMOTE_DRIFT_PRESERVES_PLUGIN_OWNED_REMOTE_DATA',
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    ...evidence,
  };
}

function generatedPluginOwnedOptionChangeVariantEvidence(
  targetCoverage,
  { target, tag, label, staleReplayPrefix },
) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has(tag)) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedPluginOwnedOptionChangeVariantCaseEvidence(
      testCase,
      result,
      { tag, label, staleReplayPrefix },
    );
    const selectedKey = result.status === 'ready' ? 'ready' : 'conflict-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, `${label} plugin-owned option target recount should match summary tiers`);
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, `${label} plugin-owned option target recount should match summary statuses`);
  assert.equal(totalCases, targetCoverage.total, `${label} plugin-owned option target recount should match summary total`);
  assert.ok(selectedCases.has('ready'), `${label} target should select one ready plugin-owned option case`);
  assert.ok(selectedCases.has('conflict-non-ready'), `${label} target should select one conflicting plugin-owned option case`);

  return {
    target,
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('conflict-non-ready'),
    ],
  };
}

function generatedPluginOwnedOptionChangeVariantCaseEvidence(
  testCase,
  result,
  { tag, label, staleReplayPrefix },
) {
  const conflict = testCase.tags.has(`${tag}-non-ready`);
  assert.equal(
    testCase.tags.has(`${tag}-ready`),
    !conflict,
    `${testCase.id} should carry exactly one plugin-owned option ${label} outcome tag`,
  );
  assert.equal(
    conflict,
    testCase.family === 'plugin-owned-option-change-conflict',
    `${testCase.id} plugin-owned option ${label} outcome tag should match its family`,
  );

  const shape = assertPluginOwnedOptionShape(testCase, { conflict });
  assertPluginOwnedOptionEvidenceRedacted(testCase, shape);

  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = pluginOwnedOptionVariantSurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: conflict ? 'conflict-non-ready' : 'ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  if (!conflict) {
    assert.equal(result.status, 'ready', `${testCase.id} should validate as ready`);
    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const optionMutation = pluginOwnedOptionVariantReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
      label,
    });
    const staleReplay = pluginOwnedOptionVariantReadyStaleReplayEvidence({
      testCase,
      plan,
      shape,
      staleReplayPrefix,
    });

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      optionMutation,
      staleReplay,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        optionMutation,
        staleReplay,
      })}`,
    };
  }

  assert.equal(result.status, 'conflict', `${testCase.id} should validate as conflict`);
  assert.equal(plan.status, 'conflict', `${testCase.id} should plan as conflict`);
  assert.equal(result.applied, false, `${testCase.id} conflict should not apply`);
  assert.equal(result.nonReadyRemoteUnchanged, true, `${testCase.id} conflict should leave remote unchanged`);

  const conflictEvidence = pluginOwnedOptionVariantConflictEvidence({ testCase, plan, shape });
  const refusal = pluginOwnedOptionVariantRefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictEvidence,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictEvidence,
      refusal,
    })}`,
  };
}

function pluginOwnedOptionVariantSurfaceEvidence(testCase, shape) {
  const resource = rowResource('wp_options', shape.rowId);

  return {
    resourceKey: resource.key,
    baseHash: resourceHash(testCase.base, resource),
    localHash: resourceHash(testCase.local, resource),
    remoteHash: resourceHash(testCase.remote, resource),
    optionNameHash: `sha256:${digest(shape.localRow.option_name)}`,
    owner: shape.localRow.__pluginOwner,
    driver: 'wp-option',
  };
}

function pluginOwnedOptionVariantReadyMutationEvidence({ testCase, plan, applied, shape, label }) {
  const resource = rowResource('wp_options', shape.rowId);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resource.key);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === resource.key);
  const localHash = resourceHash(testCase.local, resource);
  const appliedHash = resourceHash(applied.site, resource);

  assert.ok(mutation, `${testCase.id} should plan the ${label} plugin-owned option mutation`);
  assert.ok(precondition, `${testCase.id} should precondition the ${label} plugin-owned option mutation`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource?.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource?.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
  assert.equal(mutation.pluginOwnedResource?.auditEvidence?.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource?.auditEvidence?.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource?.driverAuditEvidence?.rawValuesIncluded, false);
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(appliedHash, localHash, `${testCase.id} did not apply the local plugin-owned option hash`);

  return {
    resourceKey: resource.key,
    action: mutation.action,
    changeKind: mutation.changeKind,
    pluginOwner: mutation.pluginOwnedResource.pluginOwner,
    driver: mutation.pluginOwnedResource.driver,
    supportsDelete: mutation.pluginOwnedResource.supportsDelete,
    ownerContextRequired: mutation.pluginOwnedResource.ownerContextRequired,
    ownerContextResourceKeys: mutation.pluginOwnedResource.ownerContext
      .map((entry) => entry.resourceKey)
      .sort(),
    localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    appliedHash,
    auditEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.auditEvidence)}`,
    driverDecisionEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.driverAuditEvidence)}`,
    plannedMutation: true,
    plannedPrecondition: true,
    mutationHash: `sha256:${digest({
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      pluginOwner: mutation.pluginOwnedResource.pluginOwner,
      driver: mutation.pluginOwnedResource.driver,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    })}`,
  };
}

function pluginOwnedOptionVariantReadyStaleReplayEvidence({
  testCase,
  plan,
  shape,
  staleReplayPrefix,
}) {
  const resource = rowResource('wp_options', shape.rowId);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resource.key);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === resource.key);
  const driftedRemote = cloneJson(testCase.remote);
  const staleRow = {
    ...shape.remoteRow,
    option_value: {
      mode: 'stale-replay',
      value: `${staleReplayPrefix}-stale-replay-${testCase.tier}`,
    },
  };

  assert.ok(mutation, `${testCase.id} should have a plugin-owned option mutation for stale replay`);
  assert.ok(precondition, `${testCase.id} should have a plugin-owned option precondition for stale replay`);
  setResource(driftedRemote, resource, staleRow);
  const remoteBeforeHash = digest(driftedRemote);
  const rowHashBefore = resourceHash(driftedRemote, resource);
  const error = captureError(() => applyPlan(driftedRemote, plan));
  const rowHashAfter = resourceHash(driftedRemote, resource);
  const remoteAfterHash = digest(driftedRemote);

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale plugin-owned option replay should fail`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale replay mutated the remote`);
  assert.equal(rowHashAfter, rowHashBefore, `${testCase.id} stale replay mutated the plugin-owned option row`);
  assert.deepEqual(getResource(driftedRemote, resource), staleRow, `${testCase.id} stale replay changed the drifted row`);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.notEqual(rowHashBefore, precondition.expectedHash);

  return {
    resourceKey: resource.key,
    code: error.code,
    expectedHash: precondition.expectedHash,
    actualHash: rowHashBefore,
    rowHashBefore,
    rowHashAfter,
    remoteBeforeHash,
    remoteAfterHash,
    remoteDataPreserved: rowHashAfter === rowHashBefore && remoteAfterHash === remoteBeforeHash,
    detailsHash: `sha256:${digest(error.details)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
  };
}

function pluginOwnedOptionVariantConflictEvidence({ testCase, plan, shape }) {
  const resource = rowResource('wp_options', shape.rowId);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resource.key);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === resource.key);

  assert.equal(mutation, undefined, `${testCase.id} should not plan the conflicted plugin-owned option mutation`);
  assert.ok(conflict, `${testCase.id} should carry plugin-owned option conflict evidence`);
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.pluginOwner, 'forms');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');

  return {
    resourceKey: resource.key,
    class: conflict.class,
    pluginOwner: conflict.pluginOwner,
    resolutionPolicy: conflict.resolutionPolicy,
    baseHash: conflict.baseHash,
    localHash: conflict.localHash,
    remoteHash: conflict.remoteHash,
    plannedMutation: false,
    conflictHash: `sha256:${digest({
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      pluginOwner: conflict.pluginOwner,
      resolutionPolicy: conflict.resolutionPolicy,
      change: conflict.change,
    })}`,
  };
}

function pluginOwnedOptionVariantRefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} conflict plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} conflict refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

test('RPP-0115 plugin-owned custom-table variant 1 records generated model evidence', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedCustomTableVariant1;

  assert.ok(coverage, 'missing plugin-owned custom-table variant 1 target coverage');
  assert.equal(coverage.family, 'plugin-owned-custom-table-variant1');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-custom-table-variant1']);
  assert.ok(coverage.statuses.ready > 0, 'variant 1 should include ready custom-table cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 1 should include non-ready custom-table cases');
  assert.deepEqual(
    Object.keys(coverage.perTier).map(Number),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );

  const cases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('plugin-owned-custom-table-variant1'));

  assert.equal(cases.length, coverage.total);
  const evidence = cases.map(assertPluginOwnedCustomTableVariant1ModelEvidence);
  const proof = {
    rpp: 'RPP-0115',
    evidenceSource: 'generated-push-harness-model',
    surface: 'plugin-owned-custom-table-variant1',
    format: 'hash-only',
    rawValuesIncluded: false,
    cases: evidence,
    proofHash: digest(evidence),
  };
  const proofJson = JSON.stringify(proof);

  assert.ok(evidence.some((entry) => entry.status === 'ready'), 'variant 1 evidence should include a ready case');
  assert.ok(evidence.some((entry) => entry.status !== 'ready'), 'variant 1 evidence should include a refusal case');
  assert.equal(proofJson.includes('rpp0135-private'), false);
  assert.equal(proofJson.includes('privateToken'), false);
});

function assertPluginOwnedCustomTableVariant1ModelEvidence(testCase) {
  const shape = pluginOwnedCustomTableVariant1Shape(testCase);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const result = validateGeneratedCase(testCase);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  const refusal = plan.conflicts.find((entry) => entry.resourceKey === shape.resourceKey)
    || plan.blockers.find((entry) => entry.resourceKey === shape.resourceKey);

  assert.equal(testCase.family, 'plugin-owned-custom-table-changes');
  assert.ok(testCase.tags.has('plugin-owned-custom-table-update'));
  assert.equal(shape.policy.pluginOwner, 'forms');
  assert.equal(shape.policy.driver, 'fixture-forms-lab-table');
  assert.equal(shape.policy.table, 'wp_reprint_push_forms_lab');
  assert.equal(shape.policy.supportsDelete === true, false);

  if (result.status === 'ready') {
    assert.ok(mutation, `${testCase.id} should plan the variant 1 custom-table mutation`);
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
    assert.equal(mutation.pluginOwnedResource?.driver, 'fixture-forms-lab-table');
    assert.equal(mutation.pluginOwnedResource?.supportsDelete, false);
    assert.equal(mutation.pluginOwnedResource?.auditEvidence?.format, 'hash-only');
    assert.equal(mutation.pluginOwnedResource?.auditEvidence?.rawValuesIncluded, false);
    assert.equal(result.applied, true);
    assert.equal(result.unplannedRemotePreserved, true);
    assert.equal(result.staleReplayRejected, true);
  } else {
    assert.equal(mutation, undefined, `${testCase.id} should refuse the stale variant 1 row before mutation`);
    assert.ok(refusal, `${testCase.id} should expose conflict/blocker evidence for the stale variant 1 row`);
    assert.equal(result.applied, false);
    assert.equal(result.nonReadyRemoteUnchanged, true);
  }

  const modelEvidence = {
    caseId: testCase.id,
    tier: testCase.tier,
    status: result.status,
    table: 'wp_reprint_push_forms_lab',
    rowId: shape.rowId,
    resourceKey: shape.resourceKey,
    owner: 'forms',
    driver: 'fixture-forms-lab-table',
    supportsDelete: false,
    baseRowHash: digest(shape.baseRow),
    localRowHash: digest(shape.localRow),
    remoteRowHash: digest(shape.remoteRow),
    planStatus: plan.status,
    mutationHash: mutation ? digest({
      action: mutation.action,
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      pluginOwner: mutation.pluginOwnedResource?.pluginOwner,
      driver: mutation.pluginOwnedResource?.driver,
      supportsDelete: mutation.pluginOwnedResource?.supportsDelete,
      auditEvidenceHash: digest(mutation.pluginOwnedResource?.auditEvidence),
      driverEvidenceHash: digest(mutation.pluginOwnedResource?.driverEvidence),
    }) : null,
    refusalHash: refusal ? digest(refusal) : null,
  };
  const modelEvidenceJson = JSON.stringify(modelEvidence);

  for (const rawValue of shape.privateValues) {
    assert.equal(
      modelEvidenceJson.includes(rawValue),
      false,
      `${testCase.id} variant 1 model evidence leaked raw custom-table value ${rawValue}`,
    );
  }

  return modelEvidence;
}

function pluginOwnedCustomTableVariant1Shape(testCase) {
  const rows = Object.entries(testCase.local.db.wp_reprint_push_forms_lab)
    .filter(([, row]) => row.payload?.generatedHarnessVariant === 'rpp-0115-variant1');

  assert.equal(rows.length, 1, `${testCase.id} should carry one RPP-0115 custom-table model row`);
  const [rowId, localRow] = rows[0];
  const baseRow = testCase.base.db.wp_reprint_push_forms_lab[rowId];
  const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[rowId];
  const resourceKey = generatedRowResourceKey('wp_reprint_push_forms_lab', rowId);
  const policy = testCase.local.meta.pluginOwnedResources.allowedResources
    .find((entry) => entry.resourceKey === resourceKey);

  assert.ok(baseRow, `${testCase.id} should seed the variant 1 row in the base model`);
  assert.ok(remoteRow, `${testCase.id} should seed the variant 1 row in the remote model`);
  assert.ok(policy, `${testCase.id} should allowlist the exact variant 1 row`);
  assert.match(rowId, /^id:\d+$/, `${testCase.id} should use a deterministic positive id row`);
  assert.equal(localRow.__pluginOwner, 'forms');
  assert.equal(baseRow.__pluginOwner, 'forms');
  assert.equal(remoteRow.__pluginOwner, 'forms');
  assert.equal(localRow.payload.owner, 'forms');
  assert.equal(baseRow.payload.owner, 'forms');
  assert.equal(remoteRow.payload.owner, 'forms');
  assert.equal(localRow.payload.generatedHarnessVariant, 'rpp-0115-variant1');
  assert.equal(baseRow.payload.generatedHarnessVariant, 'rpp-0115-variant1');
  assert.equal(remoteRow.payload.generatedHarnessVariant, 'rpp-0115-variant1');
  assert.equal(localRow.payload.mode, 'local');
  assert.equal(baseRow.payload.mode, 'base');
  assert.ok(
    remoteRow.payload.mode === 'base' || remoteRow.payload.mode === 'remote-stale',
    `${testCase.id} should model either an unchanged or stale remote custom-table row`,
  );

  return {
    rowId,
    resourceKey,
    baseRow,
    localRow,
    remoteRow,
    policy,
    privateValues: [
      baseRow.payload.privateToken,
      localRow.payload.privateToken,
      remoteRow.payload.privateToken,
    ].filter(Boolean),
  };
}

test('RPP-0135 plugin-owned custom-table target records ready and non-ready invariants', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedCustomTableChanges;

  assert.ok(coverage, 'missing plugin-owned custom-table target coverage');
  assert.equal(coverage.family, 'plugin-owned-custom-table-changes');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-custom-table-target']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready custom-table cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready custom-table cases');
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
  const readyCase = cases.find((testCase) =>
    testCase.family === 'plugin-owned-custom-table-changes'
    && testCase.tags.has('forms-lab-custom-table-ready'));
  const staleCase = cases.find((testCase) =>
    testCase.family === 'plugin-owned-custom-table-changes'
    && testCase.tags.has('forms-lab-custom-table-stale'));
  const deleteBlockedCase = cases.find((testCase) =>
    testCase.family === 'forms-lab-delete-blocked'
    && validateGeneratedCase(testCase).status === 'blocked');

  assert.ok(readyCase, 'missing ready plugin-owned custom-table case');
  assert.ok(staleCase, 'missing stale plugin-owned custom-table case');
  assert.ok(deleteBlockedCase, 'missing blocked plugin-owned custom-table delete case');
  assert.ok(readyCase.tags.has('plugin-owned-custom-table-change'));
  assert.ok(staleCase.tags.has('plugin-owned-custom-table-change'));
  assert.ok(deleteBlockedCase.tags.has('plugin-owned-custom-table-change'));

  const readyShape = assertFormsLabReadyShape(readyCase);
  const staleShape = assertFormsLabStaleShape(staleCase);
  const deleteShape = assertFormsLabDeleteBlockedShape(deleteBlockedCase);
  const ready = validateGeneratedCase(readyCase);
  const stale = validateGeneratedCase(staleCase);
  const deleteBlocked = validateGeneratedCase(deleteBlockedCase);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.applied, true, 'ready custom-table case should apply through the harness');
  assert.equal(ready.unplannedRemotePreserved, true, 'ready custom-table apply should preserve unplanned remote data');
  assert.equal(ready.staleReplayRejected, true, 'ready custom-table case should reject stale replay');
  assert.equal(ready.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(ready.staleReplayRemoteUnchanged, true, 'stale replay must fail before mutation');
  assert.notEqual(stale.status, 'ready', 'stale custom-table case must not be ready');
  assert.equal(stale.applied, false, 'stale custom-table case must not apply mutations');
  assert.ok(stale.conflicts >= 1 || stale.blockers >= 1, 'stale custom-table case should record a refusal');
  assert.equal(deleteBlocked.status, 'blocked', 'delete custom-table case must be blocked');
  assert.ok(deleteBlocked.blockers >= 1, 'custom-table delete should be blocked by driver policy');
  assert.equal(deleteBlocked.applied, false, 'blocked custom-table delete must not apply mutations');

  assertFormsLabReadyPlanEvidence(readyCase, readyShape.resourceKey, readyShape.payloadToken);
  assertFormsLabStalePlanRefusesMutation(staleCase, staleShape.resourceKey);
  assertFormsLabDeletePlanRefusesMutation(deleteBlockedCase, deleteShape.resourceKey);
});

function assertFormsLabReadyShape(testCase) {
  const rows = Object.entries(testCase.local.db.wp_reprint_push_forms_lab)
    .filter(([id, row]) => {
      const baseRow = testCase.base.db.wp_reprint_push_forms_lab[id];
      const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[id];
      return baseRow
        && remoteRow
        && row.__pluginOwner === 'forms'
        && row.payload?.mode === 'local'
        && baseRow.payload?.mode === 'base'
        && remoteRow.payload?.mode === 'base';
    });

  assert.equal(rows.length, 1, `${testCase.id} should update one plugin-owned custom-table row`);
  const [rowId, row] = rows[0];
  const baseRow = testCase.base.db.wp_reprint_push_forms_lab[rowId];
  const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[rowId];
  const payloadToken = row.payload.privateToken || row.payload.token;

  assert.match(rowId, /^id:\d+$/, `${testCase.id} should use deterministic numeric custom-table ids`);
  assert.equal(row.payload.owner, 'forms');
  assert.equal(baseRow.payload.owner, 'forms');
  assert.equal(remoteRow.payload.owner, 'forms');
  assert.ok(payloadToken, `${testCase.id} should carry a local payload token for redaction checks`);
  return {
    rowId,
    resourceKey: generatedRowResourceKey('wp_reprint_push_forms_lab', rowId),
    payloadToken,
  };
}

function assertFormsLabStaleShape(testCase) {
  const rows = Object.entries(testCase.local.db.wp_reprint_push_forms_lab)
    .filter(([id, row]) => {
      const baseRow = testCase.base.db.wp_reprint_push_forms_lab[id];
      const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[id];
      return baseRow
        && remoteRow
        && row.__pluginOwner === 'forms'
        && row.payload?.mode === 'local'
        && baseRow.payload?.mode === 'base'
        && remoteRow.payload?.mode === 'remote-stale';
    });

  assert.equal(rows.length, 1, `${testCase.id} should expose one stale plugin-owned custom-table row`);
  const [rowId, row] = rows[0];
  const baseRow = testCase.base.db.wp_reprint_push_forms_lab[rowId];
  const remoteRow = testCase.remote.db.wp_reprint_push_forms_lab[rowId];

  assert.match(rowId, /^id:\d+$/, `${testCase.id} should use deterministic numeric custom-table ids`);
  assert.notDeepEqual(remoteRow, baseRow, `${testCase.id} stale row should drift remotely`);
  assert.equal(row.payload.owner, 'forms');
  assert.equal(remoteRow.payload.owner, 'forms');
  return {
    rowId,
    resourceKey: generatedRowResourceKey('wp_reprint_push_forms_lab', rowId),
  };
}

function assertFormsLabDeleteBlockedShape(testCase) {
  const rows = Object.entries(testCase.base.db.wp_reprint_push_forms_lab)
    .filter(([id, row]) => row.__pluginOwner === 'forms'
      && row.payload?.token?.startsWith('delete-blocked-')
      && !testCase.local.db.wp_reprint_push_forms_lab[id]
      && testCase.remote.db.wp_reprint_push_forms_lab[id]);

  assert.equal(rows.length, 1, `${testCase.id} should attempt one custom-table delete`);
  const [rowId] = rows[0];
  assert.match(rowId, /^id:\d+$/, `${testCase.id} should use deterministic numeric custom-table ids`);
  return {
    rowId,
    resourceKey: generatedRowResourceKey('wp_reprint_push_forms_lab', rowId),
  };
}

function assertFormsLabReadyPlanEvidence(testCase, resourceKey, payloadToken) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resourceKey);
  const auditEvidence = mutation?.pluginOwnedResource?.auditEvidence;

  assert.equal(plan.status, 'ready');
  assert.ok(mutation, `${testCase.id} should plan a custom-table mutation`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource?.driver, 'fixture-forms-lab-table');
  assert.equal(mutation.pluginOwnedResource?.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
  assert.ok(mutation.pluginOwnedResource?.ownerContext.length >= 2);
  assert.equal(auditEvidence?.format, 'hash-only');
  assert.equal(auditEvidence?.rawValuesIncluded, false);
  assert.equal(auditEvidence?.resourceKey, resourceKey);
  assert.equal(auditEvidence?.driver, 'fixture-forms-lab-table');
  assert.equal(auditEvidence?.supportsDelete, false);
  assert.equal(auditEvidence?.baseHash, mutation.baseHash);
  assert.equal(auditEvidence?.localHash, mutation.localHash);
  assert.equal(auditEvidence?.remoteHash, mutation.remoteBeforeHash);
  assert.match(auditEvidence?.driverEvidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(mutation.pluginOwnedResource?.driverEvidence?.plugin, 'reprint-push-forms-fixture');
  assert.match(mutation.pluginOwnedResource?.driverEvidence?.baseHash, /^[a-f0-9]{64}$/);
  assert.equal(
    mutation.pluginOwnedResource?.driverEvidence?.baseHash,
    mutation.pluginOwnedResource?.driverEvidence?.remoteHash,
  );
  assert.equal(
    Object.hasOwn(auditEvidence, 'payload'),
    false,
    'custom-table audit evidence must not include payload fields',
  );
  assert.equal(
    JSON.stringify(auditEvidence).includes(payloadToken),
    false,
    'custom-table audit evidence must be hash-only',
  );
}

function assertFormsLabStalePlanRefusesMutation(testCase, resourceKey) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });

  assert.notEqual(plan.status, 'ready');
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === resourceKey),
    false,
    `${testCase.id} should not plan the stale custom-table mutation`,
  );
  assert.ok(
    plan.conflicts.some((conflict) => conflict.resourceKey === resourceKey)
      || plan.blockers.some((blocker) => blocker.resourceKey === resourceKey),
    `${testCase.id} should refuse the stale custom-table change before mutation`,
  );
}

function assertFormsLabDeletePlanRefusesMutation(testCase, resourceKey) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });

  assert.notEqual(plan.status, 'ready');
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === resourceKey),
    false,
    `${testCase.id} should not plan the refused custom-table delete`,
  );
  assert.ok(
    plan.blockers.some((blocker) =>
      blocker.resourceKey === resourceKey
      && blocker.class === 'unsupported-plugin-owned-resource'
      && blocker.driver === 'fixture-forms-lab-table'
      && blocker.change?.localChange === 'delete'
      && (
        blocker.reason === 'Plugin-owned resource driver does not support delete mutations.'
        || (
          blocker.driverDryRunValidationEvidence?.reasonCode === 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_REFUSED'
          && blocker.driverDryRunValidationEvidence?.issueCodes?.includes('PLANNED_ROW_INVALID')
        )
      )),
    `${testCase.id} should block custom-table delete before mutation with driver refusal evidence`,
  );
}

test('RPP-0155 plugin-owned custom-table changes variant 3 records surface and invariant', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedCustomTableChangesVariant3;

  assert.ok(coverage, 'missing plugin-owned custom-table changes variant 3 target coverage');
  assert.equal(coverage.family, 'plugin-owned-custom-table-changes-variant3');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-custom-table-variant3']);
  assert.equal(coverage.total, 10);
  assert.equal(coverage.statuses.ready, 5);
  assert.equal(nonReadyTargetCount(coverage), 5);
  assert.equal(report.summary.featureFamilies['plugin-owned-custom-table-variant3-ready'], 5);
  assert.equal(report.summary.featureFamilies['plugin-owned-custom-table-variant3-stale'], 5);
  assert.equal(report.summary.featureFamilies['plugin-owned-custom-table-variant3-non-ready'], 5);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 1])),
  );

  const summaryEvidence = JSON.stringify(report);
  assert.equal(summaryEvidence.includes('rpp0135-private'), false, 'summary leaked custom-table private value');
  assert.equal(summaryEvidence.includes('privateToken'), false, 'summary leaked custom-table private key');

  const firstEvidence = generatedPluginOwnedCustomTableChangesVariant3Evidence(coverage);
  const replayEvidence = generatedPluginOwnedCustomTableChangesVariant3Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0155 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 3 custom-table evidence changed between runs');
  assert.equal(firstEvidence.target, 'pluginOwnedCustomTableChangesVariant3');
  assert.equal(firstEvidence.family, 'plugin-owned-custom-table-changes-variant3');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.tableMutation.action, 'put');
  assert.equal(readyCase.tableMutation.changeKind, 'update');
  assert.equal(readyCase.tableMutation.pluginOwner, 'forms');
  assert.equal(readyCase.tableMutation.driver, 'fixture-forms-lab-table');
  assert.equal(readyCase.tableMutation.supportsDelete, false);
  assert.equal(readyCase.tableMutation.ownerContextRequired, true);
  assert.equal(readyCase.tableMutation.appliedHash, readyCase.surface.row.localHash);
  assert.equal(readyCase.tableMutation.plannedPrecondition, true);
  assert.equal(readyCase.remoteOnlyPreservation.preserved, true);
  assert.equal(readyCase.remoteOnlyPreservation.appliedHash, readyCase.surface.remoteOnly.remoteHash);
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.resourceKey, readyCase.surface.row.resourceKey);
  assert.equal(readyCase.staleReplay.expectedHash, readyCase.tableMutation.remoteBeforeHash);
  assert.notEqual(readyCase.staleReplay.actualHash, readyCase.staleReplay.expectedHash);
  assert.equal(readyCase.staleReplay.remoteBeforeHash, readyCase.staleReplay.remoteAfterHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.status, 'conflict');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.conflict.class, 'plugin-data-conflict');
  assert.equal(nonReadyCase.conflict.pluginOwner, 'forms');
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('rpp0135-private'), false, 'variant 3 evidence leaked custom-table private value');
  assert.equal(evidenceText.includes('privateToken'), false, 'variant 3 evidence leaked custom-table private key');
  assert.equal(evidenceText.includes('generated-rpp-0135'), false, 'variant 3 evidence leaked custom-table slug');
  assert.equal(evidenceText.includes('Remote preserved custom table note'), false, 'variant 3 evidence leaked remote-only file contents');
});

test('RPP-0175 plugin-owned custom-table changes variant 4 records surface and invariant', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.pluginOwnedCustomTableChangesVariant4;

  assert.ok(coverage, 'missing plugin-owned custom-table changes variant 4 target coverage');
  assert.equal(coverage.family, 'plugin-owned-custom-table-changes-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['plugin-owned-custom-table-variant4']);
  assert.equal(coverage.total, 10);
  assert.equal(coverage.statuses.ready, 5);
  assert.equal(nonReadyTargetCount(coverage), 5);
  assert.equal(report.summary.featureFamilies['plugin-owned-custom-table-variant4-ready'], 5);
  assert.equal(report.summary.featureFamilies['plugin-owned-custom-table-variant4-stale'], 5);
  assert.equal(report.summary.featureFamilies['plugin-owned-custom-table-variant4-non-ready'], 5);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 1])),
  );

  const summaryEvidence = JSON.stringify(report);
  assert.equal(summaryEvidence.includes('rpp0135-private'), false, 'summary leaked custom-table private value');
  assert.equal(summaryEvidence.includes('privateToken'), false, 'summary leaked custom-table private key');

  const firstEvidence = generatedPluginOwnedCustomTableChangesVariant4Evidence(coverage);
  const replayEvidence = generatedPluginOwnedCustomTableChangesVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0175 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 custom-table evidence changed between runs');
  assert.equal(firstEvidence.target, 'pluginOwnedCustomTableChangesVariant4');
  assert.equal(firstEvidence.family, 'plugin-owned-custom-table-changes-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.equal(readyCase.status, 'ready');
  assert.ok(readyCase.tags.includes('plugin-owned-custom-table-variant4'));
  assert.ok(readyCase.tags.includes('plugin-owned-custom-table-variant4-ready'));
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.equal(readyCase.tableMutation.action, 'put');
  assert.equal(readyCase.tableMutation.changeKind, 'update');
  assert.equal(readyCase.tableMutation.pluginOwner, 'forms');
  assert.equal(readyCase.tableMutation.driver, 'fixture-forms-lab-table');
  assert.equal(readyCase.tableMutation.supportsDelete, false);
  assert.equal(readyCase.tableMutation.ownerContextRequired, true);
  assert.equal(readyCase.tableMutation.appliedHash, readyCase.surface.row.localHash);
  assert.equal(readyCase.tableMutation.plannedPrecondition, true);
  assert.equal(readyCase.remoteOnlyPreservation.preserved, true);
  assert.equal(readyCase.remoteOnlyPreservation.appliedHash, readyCase.surface.remoteOnly.remoteHash);
  assert.equal(readyCase.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplay.resourceKey, readyCase.surface.row.resourceKey);
  assert.equal(readyCase.staleReplay.expectedHash, readyCase.tableMutation.remoteBeforeHash);
  assert.notEqual(readyCase.staleReplay.actualHash, readyCase.staleReplay.expectedHash);
  assert.equal(readyCase.staleReplay.remoteBeforeHash, readyCase.staleReplay.remoteAfterHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.status, 'conflict');
  assert.ok(nonReadyCase.tags.includes('plugin-owned-custom-table-variant4'));
  assert.ok(nonReadyCase.tags.includes('plugin-owned-custom-table-variant4-stale'));
  assert.ok(nonReadyCase.tags.includes('plugin-owned-custom-table-variant4-non-ready'));
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.conflict.class, 'plugin-data-conflict');
  assert.equal(nonReadyCase.conflict.pluginOwner, 'forms');
  assert.equal(nonReadyCase.conflict.plannedMutation, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('rpp0135-private'), false, 'variant 4 evidence leaked custom-table private value');
  assert.equal(evidenceText.includes('privateToken'), false, 'variant 4 evidence leaked custom-table private key');
  assert.equal(evidenceText.includes('generated-rpp-0135'), false, 'variant 4 evidence leaked custom-table slug');
  assert.equal(evidenceText.includes('Remote preserved custom table note'), false, 'variant 4 evidence leaked remote-only file contents');
});

function generatedPluginOwnedCustomTableChangesVariant3Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('plugin-owned-custom-table-variant3')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedPluginOwnedCustomTableChangesVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'stale-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 3 custom-table target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 3 custom-table target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 3 custom-table target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 3 target should select one ready custom-table case');
  assert.ok(selectedCases.has('stale-non-ready'), 'variant 3 target should select one stale non-ready custom-table case');

  return {
    target: 'pluginOwnedCustomTableChangesVariant3',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('stale-non-ready'),
    ],
  };
}

function generatedPluginOwnedCustomTableChangesVariant4Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('plugin-owned-custom-table-variant4')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    assertPluginOwnedCustomTableVariant4Tags(testCase, result);
    const evidence = generatedPluginOwnedCustomTableChangesVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'stale-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 4 custom-table target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 4 custom-table target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 4 custom-table target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 4 target should select one ready custom-table case');
  assert.ok(selectedCases.has('stale-non-ready'), 'variant 4 target should select one stale non-ready custom-table case');

  return {
    target: 'pluginOwnedCustomTableChangesVariant4',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('stale-non-ready'),
    ],
  };
}

function assertPluginOwnedCustomTableVariant4Tags(testCase, result) {
  const staleTarget = testCase.tags.has('plugin-owned-custom-table-variant4-stale');

  assert.equal(testCase.family, 'plugin-owned-custom-table-changes');
  assert.equal(
    testCase.tags.has('plugin-owned-custom-table-variant4-ready'),
    !staleTarget,
    `${testCase.id} should carry exactly one custom-table variant 4 ready/stale tag`,
  );
  assert.equal(
    testCase.tags.has('plugin-owned-custom-table-variant4-non-ready'),
    staleTarget,
    `${testCase.id} should tag stale custom-table variant 4 cases as non-ready`,
  );
  assert.equal(
    staleTarget,
    testCase.tags.has('forms-lab-custom-table-stale'),
    `${testCase.id} variant 4 stale tag should match forms-lab stale tag`,
  );
  assert.equal(
    testCase.tags.has('plugin-owned-custom-table-variant4-ready'),
    testCase.tags.has('forms-lab-custom-table-ready'),
    `${testCase.id} variant 4 ready tag should match forms-lab ready tag`,
  );
  assert.equal(
    result.status === 'ready',
    !staleTarget,
    `${testCase.id} variant 4 status should match ready/stale target tag`,
  );
}

function generatedPluginOwnedCustomTableChangesVariant3CaseEvidence(testCase, result) {
  const staleTarget = testCase.tags.has('plugin-owned-custom-table-variant3-stale');
  assert.equal(testCase.family, 'plugin-owned-custom-table-changes');
  assert.equal(
    testCase.tags.has('plugin-owned-custom-table-variant3-ready'),
    !staleTarget,
    `${testCase.id} should carry exactly one custom-table variant 3 ready/stale tag`,
  );
  assert.equal(
    testCase.tags.has('plugin-owned-custom-table-variant3-non-ready'),
    staleTarget,
    `${testCase.id} should tag stale custom-table variant 3 cases as non-ready`,
  );
  assert.equal(
    staleTarget,
    testCase.tags.has('forms-lab-custom-table-stale'),
    `${testCase.id} variant 3 stale tag should match forms-lab stale tag`,
  );
  assert.equal(
    testCase.tags.has('plugin-owned-custom-table-variant3-ready'),
    testCase.tags.has('forms-lab-custom-table-ready'),
    `${testCase.id} variant 3 ready tag should match forms-lab ready tag`,
  );

  const shape = pluginOwnedCustomTableVariant3Shape(testCase, { staleTarget });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = pluginOwnedCustomTableVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'stale-non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  assertPluginOwnedCustomTableVariant3EvidenceRedacted(testCase, shape);

  if (result.status === 'ready') {
    assert.equal(staleTarget, false, `${testCase.id} ready evidence should not use stale custom-table target`);
    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const tableMutation = pluginOwnedCustomTableVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });
    const staleReplay = pluginOwnedCustomTableVariant3ReadyStaleReplayEvidence({
      testCase,
      plan,
      shape,
    });
    const remoteOnlyPreservation = pluginOwnedCustomTableVariant3RemoteOnlyEvidence({
      testCase,
      applied,
      shape,
    });

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      tableMutation,
      staleReplay,
      remoteOnlyPreservation,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        tableMutation,
        staleReplay,
        remoteOnlyPreservation,
      })}`,
    };
  }

  assert.equal(staleTarget, true, `${testCase.id} non-ready evidence should use stale custom-table target`);
  assert.equal(result.status, 'conflict', `${testCase.id} should validate as conflict`);
  assert.equal(plan.status, 'conflict', `${testCase.id} should plan as conflict`);
  assert.equal(result.applied, false, `${testCase.id} conflict should not apply`);
  assert.equal(result.nonReadyRemoteUnchanged, true, `${testCase.id} conflict should leave remote unchanged`);

  const conflict = pluginOwnedCustomTableVariant3ConflictEvidence({ testCase, plan, shape });
  const refusal = pluginOwnedCustomTableVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict,
      refusal,
    })}`,
  };
}

function pluginOwnedCustomTableVariant3Shape(testCase, { staleTarget }) {
  const shape = pluginOwnedCustomTableVariant1Shape(testCase);
  const remoteOnlyRows = Object.entries(testCase.remote.files)
    .filter(([path]) => path.includes('custom-table-remote-only-')
      && testCase.base.files[path] === undefined
      && testCase.local.files[path] === undefined);

  assert.equal(remoteOnlyRows.length, 1, `${testCase.id} should carry one custom-table remote-only file`);
  assert.equal(shape.policy.pluginOwner, 'forms');
  assert.equal(shape.policy.driver, 'fixture-forms-lab-table');
  assert.equal(shape.policy.table, 'wp_reprint_push_forms_lab');
  assert.equal(shape.policy.supportsDelete === true, false);
  assert.equal(shape.remoteRow.payload.mode === 'remote-stale', staleTarget);
  assert.equal(shape.localRow.payload.mode, 'local');
  assert.equal(shape.baseRow.payload.mode, 'base');

  return {
    ...shape,
    remoteOnlyPath: remoteOnlyRows[0][0],
    remoteOnlyContents: remoteOnlyRows[0][1],
  };
}

function pluginOwnedCustomTableVariant3SurfaceEvidence(testCase, shape) {
  const row = rowResource('wp_reprint_push_forms_lab', shape.rowId);
  const remoteOnly = { type: 'file', path: shape.remoteOnlyPath, key: `file:${shape.remoteOnlyPath}` };

  return {
    row: {
      resourceKey: row.key,
      table: row.table,
      baseHash: resourceHash(testCase.base, row),
      localHash: resourceHash(testCase.local, row),
      remoteHash: resourceHash(testCase.remote, row),
      rowIdHash: `sha256:${digest(shape.rowId)}`,
      formSlugHash: `sha256:${digest(shape.localRow.form_slug)}`,
      localMarkerHash: `sha256:${digest(shape.localRow.updated_marker)}`,
      remoteMarkerHash: `sha256:${digest(shape.remoteRow.updated_marker)}`,
    },
    remoteOnly: {
      resourceKey: remoteOnly.key,
      baseHash: resourceHash(testCase.base, remoteOnly),
      localHash: resourceHash(testCase.local, remoteOnly),
      remoteHash: resourceHash(testCase.remote, remoteOnly),
      pathHash: `sha256:${digest(shape.remoteOnlyPath)}`,
    },
    owner: shape.localRow.__pluginOwner,
    driver: 'fixture-forms-lab-table',
  };
}

function pluginOwnedCustomTableVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const resource = rowResource('wp_reprint_push_forms_lab', shape.rowId);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resource.key);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === resource.key);
  const localHash = resourceHash(testCase.local, resource);
  const appliedHash = resourceHash(applied.site, resource);

  assert.ok(mutation, `${testCase.id} should plan the variant 3 custom-table mutation`);
  assert.ok(precondition, `${testCase.id} should precondition the variant 3 custom-table mutation`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.pluginOwnedResource?.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource?.driver, 'fixture-forms-lab-table');
  assert.equal(mutation.pluginOwnedResource?.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource?.ownerContextRequired, true);
  assert.equal(mutation.pluginOwnedResource?.auditEvidence?.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource?.auditEvidence?.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource?.driverAuditEvidence?.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource?.driverEvidence?.dryRunValidationEvidence?.rawValuesIncluded, false);
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(appliedHash, localHash, `${testCase.id} did not apply the local custom-table hash`);

  return {
    resourceKey: resource.key,
    action: mutation.action,
    changeKind: mutation.changeKind,
    pluginOwner: mutation.pluginOwnedResource.pluginOwner,
    driver: mutation.pluginOwnedResource.driver,
    supportsDelete: mutation.pluginOwnedResource.supportsDelete,
    ownerContextRequired: mutation.pluginOwnedResource.ownerContextRequired,
    ownerContextResourceKeys: mutation.pluginOwnedResource.ownerContext
      .map((entry) => entry.resourceKey)
      .sort(),
    localHash,
    remoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    appliedHash,
    plannedMutation: true,
    plannedPrecondition: true,
    auditEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.auditEvidence)}`,
    driverAuditEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.driverAuditEvidence)}`,
    driverEvidenceHash: `sha256:${digest(mutation.pluginOwnedResource.driverEvidence)}`,
    mutationHash: `sha256:${digest({
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      pluginOwner: mutation.pluginOwnedResource.pluginOwner,
      driver: mutation.pluginOwnedResource.driver,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    })}`,
  };
}

function pluginOwnedCustomTableVariant3ReadyStaleReplayEvidence({ testCase, plan, shape }) {
  const resource = rowResource('wp_reprint_push_forms_lab', shape.rowId);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resource.key);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === resource.key);
  const driftedRemote = cloneJson(testCase.remote);
  const staleRow = {
    ...shape.remoteRow,
    payload: {
      ...shape.remoteRow.payload,
      mode: 'stale-replay',
    },
    updated_marker: `stale-replay-${testCase.tier}`,
  };

  assert.ok(mutation, `${testCase.id} should have a custom-table mutation for stale replay`);
  assert.ok(precondition, `${testCase.id} should have a custom-table precondition for stale replay`);
  setResource(driftedRemote, resource, staleRow);
  const remoteBeforeHash = digest(driftedRemote);
  const actualHash = resourceHash(driftedRemote, resource);
  const error = captureError(() => applyPlan(driftedRemote, plan));
  const remoteAfterHash = digest(driftedRemote);

  assert.ok(error instanceof PushPlanError, `${testCase.id} stale custom-table replay should fail`);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale replay mutated the remote`);
  assert.deepEqual(getResource(driftedRemote, resource), staleRow, `${testCase.id} stale replay changed the drifted row`);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.notEqual(actualHash, precondition.expectedHash);

  return {
    resourceKey: resource.key,
    code: error.code,
    expectedHash: precondition.expectedHash,
    actualHash,
    remoteBeforeHash,
    remoteAfterHash,
    detailsHash: `sha256:${digest(error.details)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
  };
}

function pluginOwnedCustomTableVariant3RemoteOnlyEvidence({ testCase, applied, shape }) {
  const remoteOnly = { type: 'file', path: shape.remoteOnlyPath, key: `file:${shape.remoteOnlyPath}` };
  const remoteBeforeHash = resourceHash(testCase.remote, remoteOnly);
  const appliedHash = resourceHash(applied.site, remoteOnly);

  assert.equal(appliedHash, remoteBeforeHash, `${testCase.id} overwrote unplanned custom-table remote-only file`);

  return {
    resourceKey: remoteOnly.key,
    remoteBeforeHash,
    appliedHash,
    preserved: true,
  };
}

function pluginOwnedCustomTableVariant3ConflictEvidence({ testCase, plan, shape }) {
  const resource = rowResource('wp_reprint_push_forms_lab', shape.rowId);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resource.key);
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === resource.key);

  assert.equal(mutation, undefined, `${testCase.id} should not plan the stale custom-table mutation`);
  assert.ok(conflict, `${testCase.id} should carry custom-table conflict evidence`);
  assert.equal(conflict.class, 'plugin-data-conflict');
  assert.equal(conflict.pluginOwner, 'forms');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');

  return {
    resourceKey: resource.key,
    class: conflict.class,
    pluginOwner: conflict.pluginOwner,
    resolutionPolicy: conflict.resolutionPolicy,
    baseHash: conflict.baseHash,
    localHash: conflict.localHash,
    remoteHash: conflict.remoteHash,
    plannedMutation: false,
    conflictHash: `sha256:${digest({
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      pluginOwner: conflict.pluginOwner,
      resolutionPolicy: conflict.resolutionPolicy,
      change: conflict.change,
    })}`,
  };
}

function pluginOwnedCustomTableVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} conflict plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} conflict refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function assertPluginOwnedCustomTableVariant3EvidenceRedacted(testCase, shape) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  const relatedConflicts = plan.conflicts.filter((conflict) => conflict.resourceKey === shape.resourceKey);
  const redacted = redactEvidence({
    status: plan.status,
    mutations: mutation ? [{
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
      change: mutation.change,
      pluginOwnedResource: mutation.pluginOwnedResource,
      value: mutation.value,
    }] : [],
    conflicts: relatedConflicts,
  });
  const redactedJson = JSON.stringify(redacted);

  if (mutation) {
    assert.ok(redactedJson.includes(EVIDENCE_REDACTION_MARKER), 'custom-table mutation values should be redacted');
    assert.ok(redactedJson.includes('sha256'), 'redacted custom-table evidence should keep hashes');
  }

  for (const value of [
    ...shape.privateValues,
    shape.remoteOnlyContents,
    shape.localRow.form_slug,
    shape.baseRow.form_slug,
    shape.remoteRow.form_slug,
    'rpp0135-private',
    'privateToken',
    'Remote preserved custom table note',
  ].filter(Boolean).map(String)) {
    assert.equal(
      redactedJson.includes(value),
      false,
      `${testCase.id} redacted custom-table evidence leaked ${value}`,
    );
  }
}

test('RPP-0303 generated harness emits post author ready and stale graph cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.postAuthorGraph;

  assert.ok(coverage, 'missing post author graph target coverage');
  assert.equal(coverage.family, 'same-plan-post-author-graph');
  assert.equal(coverage.total, report.summary.featureFamilies['post-author-graph']);
  assert.deepEqual(coverage.statuses, { blocked: 10, ready: 10 });
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );

  const cases = generatePushHarnessCases();
  const targetCases = cases.filter((testCase) => testCase.tags.has('post-author-graph'));
  const readyCases = targetCases.filter((testCase) => testCase.family === 'same-plan-post-author-graph');
  const staleCases = targetCases.filter((testCase) => testCase.family === 'stale-post-author-graph');

  assert.equal(readyCases.length, 10, 'expected one ready post author graph case per tier');
  assert.equal(staleCases.length, 10, 'expected one stale post author graph case per tier');
  assert.equal(nonReadyTargetCount(coverage), staleCases.length);

  for (const readyCase of readyCases) {
    const shape = assertPostAuthorGraphShape(readyCase, { staleTarget: false });
    const plan = createPushPlan({
      base: readyCase.base,
      local: readyCase.local,
      remote: readyCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(readyCase);
    const userMutation = plan.mutations.find((mutation) =>
      mutation.resourceKey === shape.userResourceKey);
    const postMutation = plan.mutations.find((mutation) =>
      mutation.resourceKey === shape.postResourceKey);

    assert.equal(plan.status, 'ready');
    assert.equal(result.status, 'ready');
    assert.equal(result.applied, true);
    assert.equal(result.unplannedRemotePreserved, true);
    assert.equal(result.staleReplayRejected, true);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.ok(userMutation, `${readyCase.id} should create the user target`);
    assert.ok(postMutation, `${readyCase.id} should create the authored post`);
    const plannedPost = deserializeResourceValue(postMutation.value);
    assert.equal(plannedPost.post_author, shape.userId);

    const applied = applyPlan(cloneJson(readyCase.remote), plan);
    assert.deepEqual(applied.site.db.wp_users[shape.userRowId], readyCase.local.db.wp_users[shape.userRowId]);
    assert.deepEqual(applied.site.db.wp_posts[shape.postRowId], readyCase.local.db.wp_posts[shape.postRowId]);
  }

  for (const staleCase of staleCases) {
    const shape = assertPostAuthorGraphShape(staleCase, { staleTarget: true });
    const plan = createPushPlan({
      base: staleCase.base,
      local: staleCase.local,
      remote: staleCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(staleCase);
    const staleBlocker = plan.blockers.find((blocker) =>
      blocker.resourceKey === shape.postResourceKey);
    const staleReference = staleBlocker?.references?.find((reference) =>
      reference.relationshipType === 'post-author');
    const planJson = JSON.stringify(plan);

    assert.equal(plan.status, 'blocked');
    assert.equal(result.status, 'blocked');
    assert.equal(result.applied, false);
    assert.equal(result.nonReadyRemoteUnchanged, true);
    assert.equal(
      plan.mutations.some((mutation) => mutation.resourceKey === shape.postResourceKey),
      false,
      `${staleCase.id} must not plan the stale authored post`,
    );
    assert.ok(staleBlocker, `${staleCase.id} should block the post_author reference`);
    assert.equal(staleBlocker.class, 'stale-wordpress-graph-identity');
    assert.ok(staleReference, `${staleCase.id} should include post_author reference evidence`);
    assert.equal(staleReference.relationshipKey, 'wp_posts.post_author');
    assert.equal(staleReference.targetResourceKey, shape.userResourceKey);
    assert.equal(staleReference.targetChange.remoteChange, 'update');
    assert.match(staleReference.targetRemoteHash, /^[a-f0-9]{64}$/);
    assert.match(staleReference.targetBaseHash, /^[a-f0-9]{64}$/);
    assert.match(staleReference.targetLocalHash, /^[a-f0-9]{64}$/);
    assert.equal(planJson.includes('post-author-reference-'), false);
    assert.equal(planJson.includes('Generated post author target'), false);
    assert.equal(planJson.includes('Remote stale post author'), false);
    assert.equal(planJson.includes('remote-private-post-author'), false);
  }
});

test('RPP-0398 generated harness emits GUID and slug collision ready and stale cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.postGuidSlugCollision;

  assert.ok(coverage, 'missing GUID and slug collision target coverage');
  assert.equal(coverage.family, 'post-guid-slug-collision-guard');
  assert.equal(coverage.total, report.summary.featureFamilies['post-guid-slug-collision-guard']);
  assert.deepEqual(coverage.statuses, { blocked: 10, ready: 10 });
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const cases = generatePushHarnessCases();
  const targetCases = cases.filter((testCase) => testCase.tags.has('post-guid-slug-collision-guard'));
  const readyCases = targetCases.filter((testCase) => testCase.tags.has('post-guid-slug-collision-ready'));
  const staleCases = targetCases.filter((testCase) => testCase.tags.has('post-guid-slug-collision-stale'));

  assert.equal(targetCases.length, 20, 'expected one ready and one stale collision case per tier');
  assert.equal(readyCases.length, 10, 'expected one ready GUID/slug case per tier');
  assert.equal(staleCases.length, 10, 'expected one stale GUID/slug collision case per tier');

  for (const readyCase of readyCases) {
    const shape = assertPostGuidSlugCollisionShape(readyCase, { staleTarget: false });
    const plan = createPushPlan({
      base: readyCase.base,
      local: readyCase.local,
      remote: readyCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(readyCase);
    const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.localResourceKey);
    const blocker = plan.blockers.find((entry) => entry.resourceKey === shape.localResourceKey);

    assert.equal(plan.status, 'ready', `${readyCase.id} should be ready without a remote identity collision`);
    assert.equal(result.status, 'ready');
    assert.equal(result.applied, true);
    assert.equal(result.staleReplayRejected, true);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.ok(mutation, `${readyCase.id} should plan the unique GUID/slug post`);
    assert.equal(blocker, undefined, `${readyCase.id} should not block the unique GUID/slug post`);
    const plannedPost = deserializeResourceValue(mutation.value);
    assert.equal(plannedPost.guid, shape.guid);
    assert.equal(plannedPost.post_name, shape.slug);
    assert.equal(plannedPost.post_type, 'page');
  }

  for (const staleCase of staleCases) {
    const shape = assertPostGuidSlugCollisionShape(staleCase, { staleTarget: true });
    const plan = createPushPlan({
      base: staleCase.base,
      local: staleCase.local,
      remote: staleCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(staleCase);
    const blocker = plan.blockers.find((entry) => entry.resourceKey === shape.localResourceKey);
    const reference = blocker?.references?.find((entry) =>
      entry.relationshipType === 'post-natural-identity-collision');
    const remoteDecision = plan.decisions.find((entry) => entry.resourceKey === shape.remoteResourceKey);
    const planJson = JSON.stringify(plan);

    assert.equal(plan.status, 'blocked', `${staleCase.id} should fail closed on GUID/slug collision`);
    assert.equal(result.status, 'blocked');
    assert.equal(result.applied, false);
    assert.equal(result.nonReadyRemoteUnchanged, true);
    assert.equal(
      plan.mutations.some((entry) => entry.resourceKey === shape.localResourceKey),
      false,
      `${staleCase.id} must not plan the colliding local post`,
    );
    assert.ok(blocker, `${staleCase.id} should expose a collision blocker`);
    assert.equal(blocker.class, 'stale-wordpress-graph-identity');
    assert.match(blocker.reason, /collides with existing remote post identity/);
    assert.ok(reference, `${staleCase.id} should include natural identity collision evidence`);
    assert.equal(reference.targetResourceKey, shape.remoteResourceKey);
    assert.deepEqual(reference.identityKinds, ['guid', 'post_type+post_name']);
    assert.match(reference.targetRemoteHash, /^[a-f0-9]{64}$/);
    assert.equal(remoteDecision?.decision, 'keep-remote');
    assert.equal(planJson.includes(shape.localTitle), false, `${staleCase.id} leaked local title`);
    assert.equal(planJson.includes(shape.remoteTitle), false, `${staleCase.id} leaked remote title`);
    assert.equal(planJson.includes(shape.guid), false, `${staleCase.id} leaked colliding GUID`);
    assert.equal(planJson.includes(shape.slug), false, `${staleCase.id} leaked colliding slug`);
  }
});

function assertPostGuidSlugCollisionShape(testCase, { staleTarget }) {
  const localRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([, row]) => String(row.post_title || '').startsWith('Generated GUID slug collision guard '));

  assert.equal(localRows.length, 1, `${testCase.id} should include one generated GUID/slug collision row`);

  const [localRowId, localRow] = localRows[0];
  const matchingRemoteRows = Object.entries(testCase.remote.db.wp_posts)
    .filter(([remoteRowId, row]) =>
      remoteRowId !== localRowId
      && row?.guid === localRow.guid
      && row?.post_type === localRow.post_type
      && row?.post_name === localRow.post_name);

  assert.equal(localRowId, `ID:${localRow.ID}`);
  assert.equal(localRow.post_type, 'page');
  assert.ok(localRow.guid, `${testCase.id} should set a GUID identity`);
  assert.ok(localRow.post_name, `${testCase.id} should set a slug identity`);

  if (staleTarget) {
    assert.equal(matchingRemoteRows.length, 1, `${testCase.id} should include one remote identity collision`);
    assert.equal(testCase.base.db.wp_posts[localRowId], undefined);
    assert.equal(testCase.remote.db.wp_posts[localRowId], undefined);
  } else {
    assert.equal(matchingRemoteRows.length, 0, `${testCase.id} should not collide with remote identity`);
  }

  const [remoteRowId, remoteRow] = matchingRemoteRows[0] || [];
  return {
    localRowId,
    localTitle: localRow.post_title,
    localResourceKey: rowResourceKey('wp_posts', localRowId),
    remoteRowId,
    remoteTitle: remoteRow?.post_title || null,
    remoteResourceKey: remoteRowId ? rowResourceKey('wp_posts', remoteRowId) : null,
    guid: localRow.guid,
    slug: localRow.post_name,
  };
}

function assertPostAuthorGraphShape(testCase, { staleTarget }) {
  const authoredRows = Object.entries(testCase.local.db.wp_posts)
    .filter(([, row]) => String(row.post_title || '').startsWith('post-author-reference-'));

  assert.equal(authoredRows.length, 1, `${testCase.id} should create one authored post row`);

  const [postRowId, postRow] = authoredRows[0];
  const userId = Number(postRow.post_author);
  const userRowId = `ID:${userId}`;
  const user = testCase.local.db.wp_users[userRowId];

  assert.ok(Number.isSafeInteger(userId), `${testCase.id} post_author should be numeric`);
  assert.equal(postRowId, `ID:${postRow.ID}`);
  assert.ok(user, `${testCase.id} missing local user target ${userRowId}`);
  assert.equal(user.ID, userId);

  if (staleTarget) {
    assert.deepEqual(
      testCase.local.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale local user should match the pull base`,
    );
    assert.notDeepEqual(
      testCase.remote.db.wp_users[userRowId],
      testCase.base.db.wp_users[userRowId],
      `${testCase.id} stale user target should drift remotely`,
    );
  } else {
    assert.equal(testCase.base.db.wp_users[userRowId], undefined);
    assert.equal(testCase.remote.db.wp_users[userRowId], undefined);
  }

  return {
    userId,
    userRowId,
    postRowId,
    userResourceKey: rowResourceKey('wp_users', userRowId),
    postResourceKey: rowResourceKey('wp_posts', postRowId),
  };
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

test('RPP-0342 generated harness emits featured image attachment ready and stale graph cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.featuredImageAttachmentGraph;

  assert.ok(coverage, 'missing featured image attachment graph target coverage');
  assert.equal(coverage.family, 'featured-image-attachment-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['featured-image-attachment']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready featured image graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include stale/non-ready featured image graph cases');
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
  const readyCase = cases.find((testCase) => testCase.family === 'featured-image-attachment-ready');
  const staleCase = cases.find((testCase) => testCase.family === 'featured-image-attachment-stale');

  assert.ok(readyCase, 'missing ready featured image attachment graph case');
  assert.ok(staleCase, 'missing stale featured image attachment graph case');
  const readyShape = assertFeaturedImageAttachmentGraphShape(readyCase, { staleTarget: false });
  const staleShape = assertFeaturedImageAttachmentGraphShape(staleCase, { staleTarget: true });

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
  const thumbnailMutation = readyPlan.mutations.find((mutation) =>
    mutation.resourceKey === readyShape.thumbnailResourceKey);
  const attachmentMutation = readyPlan.mutations.find((mutation) =>
    mutation.resourceKey === readyShape.attachmentResourceKey);
  const thumbnailValue = deserializeResourceValue(thumbnailMutation.value);
  const staleBlocker = stalePlan.blockers.find((blocker) =>
    blocker.resourceKey === staleShape.thumbnailResourceKey);
  const stalePlanJson = JSON.stringify(stalePlan);

  assert.equal(ready.status, 'ready');
  assert.equal(ready.applied, true, 'ready featured image graph should apply through the harness');
  assert.equal(ready.staleReplayRejected, true, 'ready featured image graph should reject stale replay');
  assert.ok(thumbnailMutation, 'ready graph should plan the thumbnail postmeta row');
  assert.ok(attachmentMutation, 'ready graph should plan the attachment target row');
  assert.equal(thumbnailValue.meta_key, '_thumbnail_id');
  assert.equal(thumbnailValue.meta_value, String(readyShape.attachmentId));
  assert.equal(stale.status, 'blocked');
  assert.ok(stale.blockers >= 1, 'stale graph should record a graph identity blocker');
  assert.equal(stale.applied, false, 'stale featured image graph must not apply mutations');
  assert.ok(staleBlocker, 'stale graph should block the thumbnail postmeta row');
  assert.equal(staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(staleBlocker.references[0].relationshipType, 'featured-image-attachment');
  assert.equal(staleBlocker.references[0].targetResourceKey, staleShape.attachmentResourceKey);
  assert.match(staleBlocker.references[0].targetRemoteHash, /^[a-f0-9]{64}$/);
  assert.match(staleBlocker.references[0].targetBaseHash, /^[a-f0-9]{64}$/);
  assert.match(staleBlocker.references[0].targetLocalHash, /^[a-f0-9]{64}$/);
  assert.equal(stalePlanJson.includes('Generated featured image attachment'), false);
  assert.equal(stalePlanJson.includes('Remote stale featured image attachment'), false);
  assert.equal(stalePlanJson.includes('remote stale featured image private payload'), false);
});

function assertFeaturedImageAttachmentGraphShape(testCase, { staleTarget }) {
  const thumbnailRows = Object.entries(testCase.local.db.wp_postmeta)
    .filter(([, row]) => row.meta_key === '_thumbnail_id');

  assert.equal(thumbnailRows.length, 1, `${testCase.id} should create one featured image postmeta row`);

  const [thumbnailRowId, thumbnailRow] = thumbnailRows[0];
  const attachmentId = Number(thumbnailRow.meta_value);
  const attachmentRowId = `ID:${attachmentId}`;
  const attachment = testCase.local.db.wp_posts[attachmentRowId];

  assert.equal(thumbnailRowId, `post_id:${thumbnailRow.post_id}:meta_key:_thumbnail_id`);
  assert.equal(thumbnailRow.post_id, 1, `${testCase.id} thumbnail should point at the base post`);
  assert.ok(Number.isSafeInteger(attachmentId), `${testCase.id} thumbnail meta_value should be a numeric attachment ID`);
  assert.ok(attachment, `${testCase.id} missing local attachment target ${attachmentRowId}`);
  assert.equal(attachment.post_type, 'attachment');
  assert.equal(attachment.post_status, 'inherit');
  assert.equal(attachment.post_parent, 1);

  if (staleTarget) {
    assert.ok(testCase.base.db.wp_posts[attachmentRowId], `${testCase.id} stale target should exist in base`);
    assert.notDeepEqual(
      testCase.remote.db.wp_posts[attachmentRowId],
      testCase.base.db.wp_posts[attachmentRowId],
      `${testCase.id} stale attachment target should drift remotely`,
    );
  } else {
    assert.equal(testCase.base.db.wp_posts[attachmentRowId], undefined);
    assert.equal(testCase.remote.db.wp_posts[attachmentRowId], undefined);
  }

  return {
    attachmentId,
    attachmentResourceKey: rowResourceKey('wp_posts', attachmentRowId),
    thumbnailResourceKey: rowResourceKey('wp_postmeta', thumbnailRowId),
  };
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

test('RPP-0150 wp_comments and wp_commentmeta graph target exposes ready and non-ready coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpCommentsCommentmetaGraph;

  assert.ok(coverage, 'missing wp_comments/wp_commentmeta graph target coverage');
  assert.equal(coverage.family, 'wp-comments-commentmeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-comments-commentmeta-graph']);
  assert.ok(coverage.statuses.ready > 0, 'target should include ready wp_comments/wp_commentmeta graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'target should include non-ready stale graph cases');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(
    Object.values(coverage.statuses).reduce((sum, count) => sum + count, 0),
    coverage.total,
  );
  assert.match(`sha256:${digest(coverage)}`, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(report).includes('generated commentmeta graph '), false);
  assert.equal(JSON.stringify(report).includes('Remote stale comment graph target'), false);

  const cases = generatePushHarnessCases();
  const targetCases = cases.filter((testCase) => testCase.tags.has('wp-comments-commentmeta-graph'));
  const readyFamilyCases = cases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-ready');
  const staleFamilyCases = cases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-stale');
  const plannedCases = targetCases.map((testCase) => ({
    testCase,
    plan: createGeneratedPlan(testCase),
    shape: assertCommentsCommentmetaGraphShape(testCase, {
      staleTarget: testCase.family === 'wp-comments-commentmeta-graph-stale',
    }),
  }));
  const readyCases = plannedCases.filter(({ plan }) => plan.status === 'ready');
  const nonReadyCases = plannedCases.filter(({ plan }) => plan.status !== 'ready');

  assert.equal(readyFamilyCases.length, 10, 'expected one ready comment/commentmeta graph case per tier');
  assert.equal(staleFamilyCases.length, 10, 'expected one stale comment/commentmeta graph case per tier');
  assert.equal(readyCases.length, coverage.statuses.ready, 'ready comment/commentmeta count should match summary');
  assert.equal(nonReadyCases.length, nonReadyTargetCount(coverage), 'non-ready comment/commentmeta count should match summary');

  for (const { testCase: readyCase, plan, shape } of readyCases) {
    const result = validateGeneratedCase(readyCase);
    const mutationKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
    const commentResourceKey = rowResourceKey('wp_comments', shape.commentRowId);
    const commentmetaResourceKey = rowResourceKey('wp_commentmeta', shape.commentmetaRowId);

    assert.equal(plan.status, 'ready');
    assert.equal(result.status, 'ready');
    assert.ok(mutationKeys.has(commentResourceKey), `${readyCase.id} should plan wp_comments create`);
    assert.ok(mutationKeys.has(commentmetaResourceKey), `${readyCase.id} should plan wp_commentmeta create`);
    assert.equal(result.applied, true, `${readyCase.id} should apply planned comment graph work`);
    assert.equal(result.unplannedRemotePreserved, true, `${readyCase.id} should preserve unrelated remote data`);
    assert.equal(result.staleReplayRejected, true, `${readyCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${readyCase.id} stale replay must fail before mutation`);

    const applied = applyPlan(cloneJson(readyCase.remote), plan);
    assert.deepEqual(applied.site.db.wp_comments[shape.commentRowId], readyCase.local.db.wp_comments[shape.commentRowId]);
    assert.deepEqual(
      applied.site.db.wp_commentmeta[shape.commentmetaRowId],
      readyCase.local.db.wp_commentmeta[shape.commentmetaRowId],
    );
    assertCommentsCommentmetaEvidenceRedacted(readyCase, plan, shape);
  }

  for (const { testCase: nonReadyCase, plan, shape } of nonReadyCases) {
    const result = validateGeneratedCase(nonReadyCase);
    const commentmetaResourceKey = rowResourceKey('wp_commentmeta', shape.commentmetaRowId);
    const remoteBefore = cloneJson(nonReadyCase.remote);
    const beforeHash = digest(remoteBefore);
    const error = captureError(() => applyPlan(remoteBefore, plan));

    assert.notEqual(plan.status, 'ready');
    assert.notEqual(result.status, 'ready');
    assert.equal(result.applied, false, `${nonReadyCase.id} stale graph must not apply`);
    assert.ok(error instanceof PushPlanError, `${nonReadyCase.id} non-ready plan should refuse`);
    assert.equal(error.code, 'PLAN_NOT_READY');
    assert.equal(digest(remoteBefore), beforeHash, `${nonReadyCase.id} refusal must happen before mutation`);
    assert.ok(
      plan.blockers.some((blocker) => blocker.resourceKey === commentmetaResourceKey),
      `${nonReadyCase.id} should block the commentmeta row that references stale wp_comments`,
    );
    assert.equal(
      plan.mutations.some((mutation) => mutation.resourceKey === commentmetaResourceKey),
      false,
      `${nonReadyCase.id} must not plan a mutation for the stale commentmeta row`,
    );
    assert.equal(
      JSON.stringify(plan.blockers).includes(shape.remoteComment.comment_content),
      false,
      `${nonReadyCase.id} blocker evidence should stay hash-only`,
    );
    assertCommentsCommentmetaEvidenceRedacted(nonReadyCase, plan, shape);
  }
});

function assertCommentsCommentmetaGraphShape(testCase, { staleTarget }) {
  assert.ok(testCase.tags.has('same-plan-graph'));
  assert.ok(testCase.tags.has('comment-graph'));
  assert.ok(testCase.tags.has('wp-comments-commentmeta-graph'));
  assert.ok(testCase.tags.has('wp-commentmeta-create'));

  const commentmetaRows = Object.entries(testCase.local.db.wp_commentmeta)
    .filter(([id, row]) =>
      !testCase.base.db.wp_commentmeta[id]
      && row.meta_key.startsWith('_generated_commentmeta_graph_'));

  assert.equal(commentmetaRows.length, 1, `${testCase.id} should create one wp_commentmeta row`);

  const commentId = commentmetaRows[0][1].comment_id;
  const commentRowId = `comment_ID:${commentId}`;
  const localComment = testCase.local.db.wp_comments[commentRowId];
  const remoteComment = testCase.remote.db.wp_comments[commentRowId];
  const baseComment = testCase.base.db.wp_comments[commentRowId];

  assert.ok(localComment, `${testCase.id} should have a local wp_comments target`);
  assert.equal(localComment.comment_content, `Generated comment graph target ${commentId}`);

  if (staleTarget) {
    assert.ok(baseComment, `${testCase.id} stale target should exist in base`);
    assert.ok(remoteComment, `${testCase.id} stale target should exist remotely`);
    assert.notDeepEqual(remoteComment, baseComment, `${testCase.id} stale target should drift remotely`);
    assert.equal(remoteComment.comment_content, `Remote stale comment graph target ${commentId}`);
    assert.ok(testCase.tags.has('stale-graph'));
    assert.ok(testCase.tags.has('wp-comments-remote-drift'));
  } else {
    assert.equal(baseComment, undefined, `${testCase.id} ready target should not exist in base`);
    assert.equal(remoteComment, undefined, `${testCase.id} ready target should not exist remotely`);
    assert.ok(testCase.tags.has('wp-comments-create'));
  }

  return {
    commentRowId,
    commentmetaRowId: commentmetaRows[0][0],
    localComment,
    remoteComment,
    baseComment,
    commentmetaRow: commentmetaRows[0][1],
  };
}

function createGeneratedPlan(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function assertCommentsCommentmetaEvidenceRedacted(testCase, plan, shape) {
  const redacted = redactEvidence({
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    tags: [...testCase.tags].sort(),
    status: plan.status,
    summary: plan.summary,
    preconditions: plan.preconditions,
    mutations: plan.mutations,
    conflicts: plan.conflicts,
    blockers: plan.blockers,
    decisions: plan.decisions,
    rawCommentGraphProbe: {
      value: {
        localComment: shape.localComment,
        remoteComment: shape.remoteComment,
        baseComment: shape.baseComment,
        commentmeta: shape.commentmetaRow,
      },
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), `${testCase.id} should redact raw comment graph evidence`);
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, `${testCase.id} evidence should keep hash-only comment values`);
  assert.equal(serialized.includes('generated commentmeta graph '), false, `${testCase.id} leaked raw commentmeta value`);
  assert.equal(serialized.includes('Generated comment graph target'), false, `${testCase.id} leaked raw comment content`);
  assert.equal(serialized.includes('Remote stale comment graph target'), false, `${testCase.id} leaked remote comment drift`);
}

test('RPP-0170 wp_comments and wp_commentmeta graph variant 4 records surface and invariant', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpCommentsCommentmetaGraphVariant4;

  assert.ok(coverage, 'missing wp_comments/wp_commentmeta graph variant 4 target coverage');
  assert.equal(coverage.family, 'wp-comments-commentmeta-graph-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-comments-commentmeta-graph-v4']);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.statuses.ready, 10);
  assert.equal(nonReadyTargetCount(coverage), 10);
  assert.ok(coverage.statuses.ready > 0, 'variant 4 target should include ready comment/commentmeta graph cases');
  assert.ok(nonReadyTargetCount(coverage) > 0, 'variant 4 target should include non-ready stale graph cases');
  assert.equal(report.summary.featureFamilies['wp-comments-commentmeta-graph-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-comments-commentmeta-graph-v4-stale'], 10);
  assert.equal(report.summary.featureFamilies['wp-comments-commentmeta-graph-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );

  const firstEvidence = generatedWpCommentsCommentmetaGraphVariant4Evidence(coverage);
  const replayEvidence = generatedWpCommentsCommentmetaGraphVariant4Evidence(coverage);
  const evidenceEnvelope = {
    command: 'node --test --test-name-pattern=RPP-0170 test/generated-push-harness.test.js',
    caveat: 'Generated local/model evidence only; release remains gated separately.',
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    evidenceHash: `sha256:${digest(firstEvidence)}`,
    evidence: firstEvidence,
  };
  const evidenceText = JSON.stringify(evidenceEnvelope);

  assert.deepEqual(firstEvidence, replayEvidence, 'variant 4 comment/commentmeta evidence changed between runs');
  assert.equal(firstEvidence.target, 'wpCommentsCommentmetaGraphVariant4');
  assert.equal(firstEvidence.family, 'wp-comments-commentmeta-graph-variant4');
  assert.equal(firstEvidence.totalCases, coverage.total);
  assert.equal(firstEvidence.readyCases, coverage.statuses.ready);
  assert.equal(firstEvidence.nonReadyCases, nonReadyTargetCount(coverage));
  assert.deepEqual(firstEvidence.perTier, coverage.perTier);
  assert.deepEqual(firstEvidence.statuses, coverage.statuses);
  assert.deepEqual(
    firstEvidence.selectedCases.map((entry) => entry.variant),
    ['ready', 'stale-non-ready'],
  );

  const [readyCase, nonReadyCase] = firstEvidence.selectedCases;
  assert.ok(readyCase.tags.includes('wp-comments-commentmeta-graph-v4-ready'));
  assert.ok(nonReadyCase.tags.includes('wp-comments-commentmeta-graph-v4-stale'));
  assert.ok(nonReadyCase.tags.includes('wp-comments-commentmeta-graph-v4-non-ready'));
  assert.equal(readyCase.status, 'ready');
  assert.equal(readyCase.applied, true);
  assert.equal(readyCase.unplannedRemotePreserved, true);
  assert.equal(readyCase.staleReplayRejected, true);
  assert.equal(readyCase.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(readyCase.staleReplayRemoteUnchanged, true);
  assert.deepEqual(readyCase.plannedChangeKinds, { create: 2 });
  assert.equal(readyCase.graphMutations.comment.changeKind, 'create');
  assert.equal(readyCase.graphMutations.commentmeta.changeKind, 'create');
  assert.equal(readyCase.graphMutations.comment.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.commentmeta.plannedPrecondition, true);
  assert.equal(readyCase.graphMutations.comment.appliedHash, readyCase.surface.comment.localHash);
  assert.equal(readyCase.graphMutations.commentmeta.appliedHash, readyCase.surface.commentmeta.localHash);
  assert.match(readyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.equal(nonReadyCase.status, 'blocked');
  assert.equal(nonReadyCase.applied, false);
  assert.equal(nonReadyCase.refusal.code, 'PLAN_NOT_READY');
  assert.equal(nonReadyCase.refusal.remoteBeforeHash, nonReadyCase.refusal.remoteAfterHash);
  assert.equal(nonReadyCase.staleBlocker.class, 'stale-wordpress-graph-identity');
  assert.equal(nonReadyCase.staleBlocker.resourceKey, nonReadyCase.surface.commentmeta.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.targetResourceKey, nonReadyCase.surface.comment.resourceKey);
  assert.equal(nonReadyCase.staleBlocker.plannedMutation, false);
  assert.deepEqual(nonReadyCase.staleBlocker.relationshipKeys, ['wp_commentmeta.comment_id']);
  assert.match(nonReadyCase.staleBlocker.blockerHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(nonReadyCase.modelProofHash, /^sha256:[a-f0-9]{64}$/);

  assert.match(evidenceEnvelope.evidenceHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidenceText.includes('generated commentmeta graph '), false, 'variant 4 evidence leaked commentmeta value');
  assert.equal(evidenceText.includes('Generated comment graph target'), false, 'variant 4 evidence leaked local comment content');
  assert.equal(evidenceText.includes('Remote stale comment graph target'), false, 'variant 4 evidence leaked remote comment drift');
  assert.equal(evidenceText.includes('_generated_commentmeta_graph_'), false, 'variant 4 evidence leaked commentmeta key');
});

function generatedWpCommentsCommentmetaGraphVariant4Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('wp-comments-commentmeta-graph-v4')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedWpCommentsCommentmetaGraphVariant4CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'stale-non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(
    sortedPerTier,
    targetCoverage.perTier,
    'variant 4 comment/commentmeta target recount should match summary tiers',
  );
  assert.deepEqual(
    sortedStatuses,
    targetCoverage.statuses,
    'variant 4 comment/commentmeta target recount should match summary statuses',
  );
  assert.equal(totalCases, targetCoverage.total, 'variant 4 comment/commentmeta target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 4 target should select one ready comment/commentmeta case');
  assert.ok(selectedCases.has('stale-non-ready'), 'variant 4 target should select one stale non-ready comment/commentmeta case');

  return {
    target: 'wpCommentsCommentmetaGraphVariant4',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('stale-non-ready'),
    ],
  };
}

function generatedWpCommentsCommentmetaGraphVariant4CaseEvidence(testCase, result) {
  const staleTarget = testCase.tags.has('wp-comments-commentmeta-graph-v4-stale');
  assert.equal(
    staleTarget,
    testCase.family === 'wp-comments-commentmeta-graph-stale',
    `${testCase.id} variant 4 stale tag should match stale graph family`,
  );
  const shape = assertCommentsCommentmetaGraphShape(testCase, { staleTarget });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = wpCommentsCommentmetaGraphVariant4SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'stale-non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  assertCommentsCommentmetaEvidenceRedacted(testCase, plan, shape);

  if (result.status === 'ready') {
    assert.equal(staleTarget, false, `${testCase.id} ready evidence should not use stale graph target`);
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const { plannedChangeKinds, graphMutations } = wpCommentsCommentmetaGraphVariant4ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      graphMutations,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        graphMutations,
      })}`,
    };
  }

  assert.equal(staleTarget, true, `${testCase.id} non-ready evidence should use stale graph target`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const staleBlocker = wpCommentsCommentmetaGraphVariant4StaleBlockerEvidence({ testCase, plan, shape });
  const refusal = wpCommentsCommentmetaGraphVariant4RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    staleBlocker,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      staleBlocker,
      refusal,
    })}`,
  };
}

function wpCommentsCommentmetaGraphVariant4SurfaceEvidence(testCase, shape) {
  const commentResource = rowResource('wp_comments', shape.commentRowId);
  const commentmetaResource = rowResource('wp_commentmeta', shape.commentmetaRowId);

  return {
    comment: {
      resourceKey: commentResource.key,
      baseHash: resourceHash(testCase.base, commentResource),
      localHash: resourceHash(testCase.local, commentResource),
      remoteHash: resourceHash(testCase.remote, commentResource),
      commentIdHash: `sha256:${digest(shape.commentRowId)}`,
    },
    commentmeta: {
      resourceKey: commentmetaResource.key,
      baseHash: resourceHash(testCase.base, commentmetaResource),
      localHash: resourceHash(testCase.local, commentmetaResource),
      remoteHash: resourceHash(testCase.remote, commentmetaResource),
      commentIdHash: `sha256:${digest(String(shape.commentmetaRow.comment_id))}`,
      metaKeyHash: `sha256:${digest(shape.commentmetaRow.meta_key)}`,
    },
  };
}

function wpCommentsCommentmetaGraphVariant4ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { label: 'comment', resource: rowResource('wp_comments', shape.commentRowId), changeKind: 'create' },
    { label: 'commentmeta', resource: rowResource('wp_commentmeta', shape.commentmetaRowId), changeKind: 'create' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};
  const graphMutations = {};

  for (const { label, resource, changeKind } of expected) {
    const mutation = mutations.get(resource.key);
    const precondition = preconditions.get(resource.key);
    const localHash = resourceHash(testCase.local, resource);
    const appliedHash = resourceHash(applied.site, resource);

    assert.ok(mutation, `${testCase.id} should plan ${label} graph mutation for ${resource.key}`);
    assert.ok(precondition, `${testCase.id} should precondition ${label} graph mutation for ${resource.key}`);
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(appliedHash, localHash, `${testCase.id} did not apply local ${label} graph row`);
    incrementCount(plannedChangeKinds, changeKind);

    graphMutations[label] = {
      resourceKey: resource.key,
      action: mutation.action,
      changeKind: mutation.changeKind,
      localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      preconditionExpectedHash: precondition.expectedHash,
      appliedHash,
      plannedMutation: true,
      plannedPrecondition: true,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      })}`,
    };
  }

  return {
    plannedChangeKinds: sortStringObject(plannedChangeKinds),
    graphMutations,
  };
}

function wpCommentsCommentmetaGraphVariant4StaleBlockerEvidence({ testCase, plan, shape }) {
  const commentResourceKey = rowResourceKey('wp_comments', shape.commentRowId);
  const commentmetaResourceKey = rowResourceKey('wp_commentmeta', shape.commentmetaRowId);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === commentmetaResourceKey
    && entry.references?.some((reference) => reference.targetResourceKey === commentResourceKey));
  const commentDecision = plan.decisions.find((entry) => entry.resourceKey === commentResourceKey);
  const plannedMutation = plan.mutations.some((mutation) =>
    mutation.resourceKey === commentResourceKey || mutation.resourceKey === commentmetaResourceKey);

  assert.ok(blocker, `${testCase.id} should report a stale comment/commentmeta graph blocker`);
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.ok(commentDecision, `${testCase.id} should keep the stale remote comment`);
  assert.equal(commentDecision.decision, 'keep-remote');
  assert.equal(plannedMutation, false, `${testCase.id} should not plan stale comment/commentmeta graph mutations`);

  return {
    resourceKey: blocker.resourceKey,
    class: blocker.class,
    plannedMutation,
    relationshipKeys: blocker.references.map((reference) => reference.relationshipKey).sort(),
    targetResourceKey: commentResourceKey,
    targetChange: blocker.references.find((reference) =>
      reference.targetResourceKey === commentResourceKey).targetChange,
    blockerHash: `sha256:${digest(blocker)}`,
    decision: {
      resourceKey: commentDecision.resourceKey,
      decision: commentDecision.decision,
      decisionHash: `sha256:${digest(commentDecision)}`,
    },
  };
}

function wpCommentsCommentmetaGraphVariant4RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}


function generatedAtomicPluginInstallStackV1Evidence() {
  return generatedAtomicPluginInstallStackVariantEvidence({
    target: 'atomicPluginInstallStackV1',
    variantNumber: 1,
    variantTag: 'atomic-plugin-install-stack-v1',
  });
}

function generatedAtomicPluginInstallStackV2Evidence() {
  return generatedAtomicPluginInstallStackVariantEvidence({
    target: 'atomicPluginInstallStackV2',
    variantNumber: 2,
    variantTag: 'atomic-plugin-install-stack-v2',
  });
}

function generatedAtomicPluginInstallStackV4Evidence() {
  return generatedAtomicPluginInstallStackVariantEvidence({
    target: 'atomicPluginInstallStackV4',
    variantNumber: 4,
    variantTag: 'atomic-plugin-install-stack-v4',
  });
}

function generatedAtomicPluginInstallStackVariantEvidence({ target, variantNumber, variantTag }) {
  const targetCases = generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has(variantTag));
  const selectedCases = [
    targetCases.find((testCase) => testCase.family === 'atomic-plugin-stack-ready'),
    targetCases.find((testCase) => testCase.family === 'atomic-plugin-missing-dependency'),
  ];

  assert.equal(
    selectedCases.includes(undefined),
    false,
    `variant ${variantNumber} evidence needs ready and non-ready cases`,
  );

  const cases = selectedCases.map((testCase) => {
    const missingDependency = testCase.family === 'atomic-plugin-missing-dependency';
    const shape = assertAtomicPluginStackShape(testCase, { missingDependency });
    const plan = createPushPlan({
      base: testCase.base,
      local: testCase.local,
      remote: testCase.remote,
      now: fixedGeneratedHarnessNow,
    });
    const result = validateGeneratedCase(testCase);
    const group = plan.atomicGroups.find((candidate) => candidate.id === shape.intent.id);

    assert.ok(group, `${testCase.id} should emit an atomic group for variant ${variantNumber} evidence`);
    assert.equal(testCase.tags.has(variantTag), true);

    return {
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      status: result.status,
      applied: result.applied,
      summary: {
        mutations: plan.summary.mutations,
        blockers: plan.summary.blockers,
        conflicts: plan.summary.conflicts,
        atomicGroups: plan.summary.atomicGroups,
      },
      atomicGroup: {
        id: group.id,
        status: group.status,
        requireAtomic: group.requireAtomic,
        resources: [...group.resources].sort(),
        mutationResourceKeys: plan.mutations
          .filter((mutation) => mutation.atomicGroupId === group.id)
          .map((mutation) => mutation.resourceKey)
          .sort(),
        dependencySources: (group.dependencyRequirements || [])
          .map((requirement) => requirement.source)
          .sort(),
        dependencyRequirementHashes: (group.dependencyRequirements || [])
          .map((requirement) => ({
            plugin: requirement.plugin,
            expectedHash: requirement.expectedHash,
            plannedHash: requirement.plannedHash || null,
            remoteHash: requirement.remoteHash || null,
          }))
          .sort((left, right) => left.plugin.localeCompare(right.plugin)),
        blockers: group.blockers
          .map((blocker) => ({
            class: blocker.class,
            resourceKey: blocker.resourceKey || null,
            plugin: blocker.plugin || null,
            reason: blocker.reason || null,
          }))
          .sort((left, right) =>
            `${left.class}:${left.resourceKey || ''}:${left.plugin || ''}`
              .localeCompare(`${right.class}:${right.resourceKey || ''}:${right.plugin || ''}`)),
      },
      modelProofHash: digest({
        id: testCase.id,
        expectedResourceKeys: shape.expectedResourceKeys,
        status: result.status,
        applied: result.applied,
        groupStatus: group.status,
      }),
    };
  });

  return {
    target,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases: cases.length,
    readyCases: cases.filter((entry) => entry.status === 'ready').length,
    nonReadyCases: cases.filter((entry) => entry.status !== 'ready').length,
    cases,
  };
}

function assertAtomicPluginStackShape(testCase, { missingDependency }) {
  assert.ok(testCase.tags.has('atomic-plugin-install-stack-v1'));
  assert.ok(testCase.tags.has('atomic-plugin-install-stack-v3'));
  const intent = testCase.local.pushIntents?.[0];

  assert.ok(intent, `${testCase.id} should declare an atomic plugin install intent`);
  assert.equal(intent.kind, 'plugin-install');
  assert.equal(intent.requireAtomic, true);

  if (missingDependency) {
    assert.ok(testCase.tags.has('atomic-blocked'));
    assert.ok(testCase.tags.has('atomic-plugin-stack-missing-dependency-v3'));
    assert.equal(testCase.local.files[atomicDependencyPluginFile], undefined);
    assert.equal(testCase.local.plugins[atomicDependencyPlugin], undefined);
    assert.ok(testCase.local.files[atomicDependentPluginFile], `${testCase.id} should stage dependent plugin file`);
    assert.ok(testCase.local.plugins[atomicDependentPlugin], `${testCase.id} should stage dependent plugin metadata`);
    assert.deepEqual(intent.resources, [
      fileResourceKey(atomicDependentPluginFile),
      pluginResourceKey(atomicDependentPlugin),
    ]);
    assert.deepEqual(intent.dependencies.plugins, [atomicDependencyPlugin]);
    return {
      intent,
      expectedResourceKeys: [
        fileResourceKey(atomicDependentPluginFile),
        pluginResourceKey(atomicDependentPlugin),
      ],
      optionRow: null,
    };
  }

  assert.ok(testCase.tags.has('atomic-ready'));
  assert.ok(testCase.tags.has('atomic-plugin-stack-ready-v3'));
  assert.ok(testCase.local.files[atomicDependencyPluginFile], `${testCase.id} should stage dependency plugin file`);
  assert.ok(testCase.local.files[atomicDependentPluginFile], `${testCase.id} should stage dependent plugin file`);
  assert.deepEqual(testCase.local.plugins[atomicDependencyPlugin], { version: '2.1.0', active: true });
  assert.equal(testCase.local.plugins[atomicDependentPlugin].requires[0], atomicDependencyPlugin);

  const optionRow = testCase.local.db.wp_options[atomicFixtureOptionRowId];
  const optionResourceKey = rowResourceKey('wp_options', atomicFixtureOptionRowId);
  assert.ok(optionRow, `${testCase.id} should create plugin-owned fixture option`);
  assert.equal(optionRow.__pluginOwner, atomicDependentPlugin);
  assert.equal(optionRow.option_value.mode, 'generated-installed');
  assert.equal(optionRow.option_value.privateInstallToken, 'private-atomic-plugin-install-stack-v3');
  assert.ok(
    intent.resourcePolicy.pluginOwnedResources.allowedResources.some((entry) =>
      entry.resourceKey === optionResourceKey
        && entry.pluginOwner === atomicDependentPlugin
        && entry.driver === 'wp-option'),
    `${testCase.id} should include plugin-owned option driver policy in the atomic intent`,
  );
  assert.equal(intent.dependencies.plugins[0].name, atomicDependencyPlugin);
  assert.equal(intent.dependencies.plugins[0].version, '2.1.0');
  assert.match(intent.dependencies.plugins[0].hash, /^[a-f0-9]{64}$/);

  return {
    intent,
    expectedResourceKeys: [
      fileResourceKey(atomicDependencyPluginFile),
      fileResourceKey(atomicDependentPluginFile),
      pluginResourceKey(atomicDependencyPlugin),
      pluginResourceKey(atomicDependentPlugin),
      optionResourceKey,
    ],
    optionRow,
  };
}

function fileResourceKey(path) {
  return `file:${path}`;
}

function pluginResourceKey(name) {
  return `plugin:${name}`;
}

function assertAtomicPluginStackEvidenceRedacted(testCase, plan, shape) {
  const redacted = redactEvidence({
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    tags: [...testCase.tags].sort(),
    status: plan.status,
    summary: plan.summary,
    atomicGroups: plan.atomicGroups,
    mutations: plan.mutations,
    blockers: plan.blockers,
    rawAtomicInstallProbe: {
      value: {
        intent: shape.intent,
        optionRow: shape.optionRow,
        dependencyFile: testCase.local.files[atomicDependencyPluginFile],
        dependentFile: testCase.local.files[atomicDependentPluginFile],
      },
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), `${testCase.id} should redact raw atomic install evidence`);
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, `${testCase.id} evidence should keep hash-only values`);
  assert.equal(serialized.includes('private-atomic-plugin-install-stack-v3'), false, `${testCase.id} leaked private install token`);
}

function nonReadyTargetCount(coverage) {
  return Object.entries(coverage.statuses)
    .filter(([status]) => status !== 'ready')
    .reduce((sum, [, count]) => sum + count, 0);
}

function generatedIndependentLocalRemoteTargets(testCase) {
  const fileEntry = Object.entries(testCase.local.files)
    .find(([, value]) => typeof value === 'string' && value.startsWith('independent local '));
  const rowEntry = Object.entries(testCase.remote.db.wp_posts)
    .find(([, row]) => row.post_title?.startsWith('Independent remote '));

  assert.ok(fileEntry, `${testCase.id} missing generated independent local file`);
  assert.ok(rowEntry, `${testCase.id} missing generated independent remote row`);

  return {
    filePath: fileEntry[0],
    fileValue: fileEntry[1],
    rowId: rowEntry[0],
    rowTitle: rowEntry[1].post_title,
  };
}

function generatedIndependentRowRemoteFileTargets(testCase) {
  const rowEntry = Object.entries(testCase.local.db.wp_posts)
    .find(([, row]) => row.post_title?.startsWith('Independent local row '));
  const fileEntry = Object.entries(testCase.remote.files)
    .find(([, value]) => typeof value === 'string' && value.startsWith('independent remote file '));

  assert.ok(rowEntry, `${testCase.id} missing generated independent local row`);
  assert.ok(fileEntry, `${testCase.id} missing generated independent remote file`);

  return {
    rowId: rowEntry[0],
    rowTitle: rowEntry[1].post_title,
    filePath: fileEntry[0],
    fileValue: fileEntry[1],
  };
}

function generatedRemoteOnlyPostUpdateTargets(testCase) {
  const rowEntry = Object.entries(testCase.remote.db.wp_posts)
    .find(([id, row]) =>
      testCase.base.db.wp_posts[id]
      && testCase.local.db.wp_posts[id]
      && row.post_title?.startsWith('Remote editorial '));

  assert.ok(rowEntry, `${testCase.id} missing generated remote-only row update`);
  assert.deepEqual(
    testCase.local.db.wp_posts[rowEntry[0]],
    testCase.base.db.wp_posts[rowEntry[0]],
    `${testCase.id} remote-only row should be unchanged locally`,
  );
  assert.notDeepEqual(
    testCase.remote.db.wp_posts[rowEntry[0]],
    testCase.base.db.wp_posts[rowEntry[0]],
    `${testCase.id} remote-only row should drift remotely`,
  );

  return {
    rowId: rowEntry[0],
    remoteTitle: rowEntry[1].post_title,
  };
}

function generatedRemoteOnlyPreservationVariant2Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    if (testCase.family !== 'remote-only-post-update'
      || !testCase.tags.has('remote-preserve')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const targetMatch = result.status === 'ready'
      && result.unplannedRemotePreserved === true
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true;

    if (!targetMatch) {
      continue;
    }

    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    cases.push(generatedRemoteOnlyPreservationCaseEvidence(testCase, result));
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = Object.values(sortedPerTier).reduce((sum, count) => sum + count, 0);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 2 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 2 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 2 target recount should match summary total');

  return {
    target: 'remoteOnlyPreservation',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    cases: cases.sort((left, right) => left.tier - right.tier),
  };
}

function generatedRemoteOnlyPreservationCaseEvidence(testCase, result) {
  const { rowId } = generatedRemoteOnlyPostUpdateTargets(testCase);
  const rowResource = { type: 'row', table: 'wp_posts', id: rowId };
  const rowKey = generatedRowResourceKey('wp_posts', rowId);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const rowDecision = plan.decisions.find((decision) => decision.resourceKey === rowKey);
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const mutationIndex = plan.mutations.length - 1;
  const mutation = plan.mutations[mutationIndex];
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
  const staleRemote = cloneJson(testCase.remote);
  const stalePayload = `stale-private-rpp0139-${testCase.tier}-${mutation?.id}`;
  const plannedValue = deserializeResourceValue(mutation?.value);

  assert.equal(plan.status, 'ready', `${testCase.id} should be ready for remote-only preservation evidence`);
  assert.equal(result.status, 'ready');
  assert.equal(result.applied, true);
  assert.equal(result.unplannedRemotePreserved, true);
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true);
  assert.ok(rowDecision, `${testCase.id} should record the remote-only row decision`);
  assert.equal(rowDecision.decision, 'keep-remote');
  assert.equal(rowDecision.change.localChange, 'unchanged');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(plan.mutations.some((entry) => entry.resourceKey === rowKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === rowKey), false);
  assert.ok(mutation, `${testCase.id} should have a planned mutation to drift after dry-run`);
  assert.ok(mutationIndex > 0, `${testCase.id} should have a later planned mutation for pre-mutation replay proof`);
  assert.ok(precondition, `${testCase.id} should have a live-remote precondition for ${mutation.resourceKey}`);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(resourceHash(staleRemote, mutation.resource), precondition.expectedHash);

  setResource(
    staleRemote,
    mutation.resource,
    rpp0139StaleRemoteValue(mutation.resource, getResource(staleRemote, mutation.resource), stalePayload),
  );
  const staleResourceHash = resourceHash(staleRemote, mutation.resource);
  const remoteBeforeHash = digest(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, plan));
  const remoteAfterHash = digest(staleRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, mutation.resourceKey);
  assert.equal(error.details.expectedHash, precondition.expectedHash);
  assert.equal(error.details.actualHash, staleResourceHash);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale replay mutated remote before refusal`);

  const remoteOnly = {
    resourceKey: rowKey,
    decision: rowDecision.decision,
    change: rowDecision.change,
    baseHash: resourceHash(testCase.base, rowResource),
    localHash: resourceHash(testCase.local, rowResource),
    remoteHash: resourceHash(testCase.remote, rowResource),
    appliedHash: resourceHash(applied.site, rowResource),
    plannedMutation: false,
    plannedPrecondition: false,
    decisionHash: `sha256:${digest(rowDecision)}`,
  };
  const staleReplay = {
    mutationId: mutation.id,
    mutationIndex,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    code: error.code,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    mutationRemoteBeforeHash: mutation.remoteBeforeHash,
    plannedValueHash: `sha256:${digest(plannedValue)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    tags: [...testCase.tags].sort(),
    summary: plan.summary,
    applied: result.applied,
    unplannedRemotePreserved: result.unplannedRemotePreserved,
    remoteOnly,
    staleReplay,
    modelProofHash: `sha256:${digest({ remoteOnly, staleReplay })}`,
  };
}

function generatedRemoteOnlyPreservationVariant3Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const cases = [];

  for (const testCase of generatePushHarnessCases()) {
    if (testCase.family !== 'remote-only-post-update'
      || !testCase.tags.has('remote-preserve')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const targetMatch = result.status === 'ready'
      && result.unplannedRemotePreserved === true
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true;

    if (!targetMatch) {
      continue;
    }

    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    cases.push(generatedRemoteOnlyPreservationVariant3CaseEvidence(testCase, result));
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = Object.values(sortedPerTier).reduce((sum, count) => sum + count, 0);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 3 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 3 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 3 target recount should match summary total');

  return {
    target: 'remoteOnlyPreservationVariant3',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    cases: cases.sort((left, right) => left.tier - right.tier || left.id.localeCompare(right.id)),
  };
}

function generatedRemoteOnlyPreservationVariant3CaseEvidence(testCase, result) {
  const { rowId } = generatedRemoteOnlyPostUpdateTargets(testCase);
  const rowResource = { type: 'row', table: 'wp_posts', id: rowId };
  const rowKey = generatedRowResourceKey('wp_posts', rowId);
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const rowDecision = plan.decisions.find((decision) => decision.resourceKey === rowKey);
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const mutationIndex = plan.mutations.length - 1;
  const mutation = plan.mutations[mutationIndex];
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
  const staleRemote = cloneJson(testCase.remote);
  const stalePayload = `stale-private-rpp0159-${testCase.tier}-${mutation?.id}`;
  const plannedValue = deserializeResourceValue(mutation?.value);

  assert.equal(plan.status, 'ready', `${testCase.id} should be ready for remote-only preservation variant 3 evidence`);
  assertGeneratedMutationPreconditionOneToOne(testCase, plan);
  assert.equal(result.status, 'ready');
  assert.equal(result.applied, true);
  assert.equal(result.unplannedRemotePreserved, true);
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true);
  assert.ok(rowDecision, `${testCase.id} should record the remote-only row decision`);
  assert.equal(rowDecision.decision, 'keep-remote');
  assert.equal(rowDecision.change.localChange, 'unchanged');
  assert.equal(rowDecision.change.remoteChange, 'update');
  assert.equal(plan.mutations.some((entry) => entry.resourceKey === rowKey), false);
  assert.equal(plan.preconditions.some((entry) => entry.resourceKey === rowKey), false);
  assert.ok(mutation, `${testCase.id} should have a planned mutation to drift after dry-run`);
  assert.ok(mutationIndex > 0, `${testCase.id} should drift a non-leading mutation for pre-mutation proof`);
  assert.equal(mutationIndex, plan.mutations.length - 1, `${testCase.id} should drift the final planned mutation`);
  assert.ok(precondition, `${testCase.id} should have a live-remote precondition for ${mutation.resourceKey}`);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(resourceHash(staleRemote, mutation.resource), precondition.expectedHash);

  setResource(
    staleRemote,
    mutation.resource,
    rpp0159StaleRemoteValue(mutation.resource, getResource(staleRemote, mutation.resource), stalePayload),
  );
  const staleResourceHash = resourceHash(staleRemote, mutation.resource);
  const remoteBeforeHash = digest(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, plan));
  const remoteAfterHash = digest(staleRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, mutation.resourceKey);
  assert.equal(error.details.expectedHash, precondition.expectedHash);
  assert.equal(error.details.actualHash, staleResourceHash);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} variant 3 stale replay mutated remote before refusal`);

  const remoteOnly = {
    resourceKey: rowKey,
    decision: rowDecision.decision,
    change: rowDecision.change,
    baseHash: resourceHash(testCase.base, rowResource),
    localHash: resourceHash(testCase.local, rowResource),
    remoteHash: resourceHash(testCase.remote, rowResource),
    appliedHash: resourceHash(applied.site, rowResource),
    plannedMutation: false,
    plannedPrecondition: false,
    decisionHash: `sha256:${digest(rowDecision)}`,
  };
  const staleReplay = {
    mutationId: mutation.id,
    mutationIndex,
    mutationCount: plan.mutations.length,
    preconditionCount: plan.preconditions.length,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    code: error.code,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    mutationRemoteBeforeHash: mutation.remoteBeforeHash,
    plannedValueHash: `sha256:${digest(plannedValue)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    applied: result.applied,
    unplannedRemotePreserved: result.unplannedRemotePreserved,
    remoteOnly,
    staleReplay,
    modelProofHash: `sha256:${digest({ remoteOnly, staleReplay })}`,
  };
}

function rpp0159StaleRemoteValue(resource, currentValue, stalePayload) {
  if (resource.type === 'file') {
    return currentValue === ABSENT
      ? stalePayload
      : { type: 'file', content: stalePayload };
  }

  if (resource.type === 'plugin') {
    return {
      ...(currentValue === ABSENT ? {} : currentValue),
      version: stalePayload,
    };
  }

  if (currentValue && currentValue !== ABSENT && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    return {
      ...currentValue,
      __rpp0159RemoteOnlyPreservationStaleReplay: stalePayload,
    };
  }

  return {
    value: currentValue === ABSENT ? 'absent-before-remote-only-preservation-v3-replay' : currentValue,
    __rpp0159RemoteOnlyPreservationStaleReplay: stalePayload,
  };
}

function rpp0139StaleRemoteValue(resource, currentValue, stalePayload) {
  if (resource.type === 'file') {
    return { type: 'file', content: stalePayload };
  }

  if (resource.type === 'plugin') {
    return {
      ...(currentValue === ABSENT ? {} : currentValue),
      version: stalePayload,
    };
  }

  if (currentValue && currentValue !== ABSENT && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    return {
      ...currentValue,
      __rpp0139RemoteOnlyPreservationStaleReplay: stalePayload,
    };
  }

  return {
    value: currentValue === ABSENT ? 'absent-before-remote-only-preservation-replay' : currentValue,
    __rpp0139RemoteOnlyPreservationStaleReplay: stalePayload,
  };
}

function generatedDeleteEditTargets(testCase) {
  const rowEntry = Object.entries(testCase.remote.db.wp_posts)
    .find(([id, row]) =>
      testCase.base.db.wp_posts[id]
      && !testCase.local.db.wp_posts[id]
      && row.post_title?.startsWith('Remote edit while local deletes '));

  assert.ok(rowEntry, `${testCase.id} missing generated delete/edit row`);

  return {
    rowId: rowEntry[0],
    remoteTitle: rowEntry[1].post_title,
  };
}

function generatedStaleRemoteAfterDryRunVariant2Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedByTier = new Map();

  for (const testCase of generatePushHarnessCases()) {
    const result = validateGeneratedCase(testCase);
    const targetMatch = result.status === 'ready'
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true;

    if (!targetMatch) {
      continue;
    }

    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (!selectedByTier.has(testCase.tier)) {
      selectedByTier.set(
        testCase.tier,
        generatedStaleRemoteAfterDryRunCaseEvidence(testCase, result),
      );
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = Object.values(sortedPerTier).reduce((sum, count) => sum + count, 0);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 2 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 2 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 2 target recount should match summary total');

  return {
    target: 'staleRemoteAfterDryRun',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [...selectedByTier.values()].sort((left, right) => left.tier - right.tier),
  };
}

function generatedStaleRemoteAfterDryRunCaseEvidence(testCase, result) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutation = plan.mutations[0];
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
  const staleRemote = cloneJson(testCase.remote);
  const stalePayload = `stale-private-rpp0137-${testCase.tier}-${mutation.id}`;
  const plannedValue = deserializeResourceValue(mutation.value);

  assert.equal(plan.status, 'ready', `${testCase.id} should be ready for stale replay evidence`);
  assert.ok(mutation, `${testCase.id} should have a planned mutation to drift after dry-run`);
  assert.ok(precondition, `${testCase.id} should have a live-remote precondition for ${mutation.resourceKey}`);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(resourceHash(staleRemote, mutation.resource), precondition.expectedHash);

  setResource(
    staleRemote,
    mutation.resource,
    rpp0137StaleRemoteValue(mutation.resource, getResource(staleRemote, mutation.resource), stalePayload),
  );
  const staleResourceHash = resourceHash(staleRemote, mutation.resource);
  const remoteBeforeHash = digest(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, plan));
  const remoteAfterHash = digest(staleRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, mutation.resourceKey);
  assert.equal(error.details.expectedHash, precondition.expectedHash);
  assert.equal(error.details.actualHash, staleResourceHash);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} stale replay mutated remote before refusal`);
  assert.equal(result.status, 'ready');
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    tags: [...testCase.tags].sort(),
    summary: plan.summary,
    staleReplay: {
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      code: error.code,
      expectedHash: error.details.expectedHash,
      actualHash: error.details.actualHash,
      mutationRemoteBeforeHash: mutation.remoteBeforeHash,
      plannedValueHash: `sha256:${digest(plannedValue)}`,
      preconditionHash: `sha256:${digest(precondition)}`,
      detailsHash: `sha256:${digest(error.details)}`,
      remoteBeforeHash,
      remoteAfterHash,
    },
  };
}

function generatedStaleRemoteAfterDryRunVariant3Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedByTier = new Map();

  for (const testCase of generatePushHarnessCases()) {
    const result = validateGeneratedCase(testCase);
    const targetMatch = result.status === 'ready'
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true;

    if (!targetMatch) {
      continue;
    }

    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    if (!selectedByTier.has(testCase.tier)) {
      selectedByTier.set(
        testCase.tier,
        generatedStaleRemoteAfterDryRunVariant3CaseEvidence(testCase, result),
      );
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = Object.values(sortedPerTier).reduce((sum, count) => sum + count, 0);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 3 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 3 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 3 target recount should match summary total');

  return {
    target: 'staleRemoteAfterDryRunVariant3',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [...selectedByTier.values()].sort((left, right) => left.tier - right.tier),
  };
}

function generatedStaleRemoteAfterDryRunVariant3CaseEvidence(testCase, result) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutationIndex = plan.mutations.length - 1;
  const mutation = plan.mutations[mutationIndex];
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
  const staleRemote = cloneJson(testCase.remote);
  const stalePayload = `stale-private-rpp0157-${testCase.tier}-${mutation.id}`;
  const plannedValue = deserializeResourceValue(mutation.value);

  assert.equal(plan.status, 'ready', `${testCase.id} should be ready for variant 3 stale replay evidence`);
  assert.ok(plan.mutations.length > 1, `${testCase.id} should prove non-leading mutation precondition refusal`);
  assert.ok(mutation, `${testCase.id} should have a planned mutation to drift after dry-run`);
  assert.ok(precondition, `${testCase.id} should have a live-remote precondition for ${mutation.resourceKey}`);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(resourceHash(staleRemote, mutation.resource), precondition.expectedHash);

  setResource(
    staleRemote,
    mutation.resource,
    rpp0157StaleRemoteValue(mutation.resource, getResource(staleRemote, mutation.resource), stalePayload),
  );
  const staleResourceHash = resourceHash(staleRemote, mutation.resource);
  const remoteBeforeHash = digest(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, plan));
  const remoteAfterHash = digest(staleRemote);

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, mutation.resourceKey);
  assert.equal(error.details.expectedHash, precondition.expectedHash);
  assert.equal(error.details.actualHash, staleResourceHash);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} variant 3 stale replay mutated remote before refusal`);
  assert.equal(result.status, 'ready');
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    tags: [...testCase.tags].sort(),
    summary: plan.summary,
    staleReplay: {
      mutationId: mutation.id,
      mutationIndex,
      mutationCount: plan.mutations.length,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      code: error.code,
      expectedHash: error.details.expectedHash,
      actualHash: error.details.actualHash,
      mutationRemoteBeforeHash: mutation.remoteBeforeHash,
      plannedValueHash: `sha256:${digest(plannedValue)}`,
      preconditionHash: `sha256:${digest(precondition)}`,
      detailsHash: `sha256:${digest(error.details)}`,
      remoteBeforeHash,
      remoteAfterHash,
    },
  };
}

function generatedStaleRemoteAfterDryRunVariant4Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedByTier = new Map();

  for (const testCase of generatePushHarnessCases()) {
    const result = validateGeneratedCase(testCase);
    const targetMatch = result.status === 'ready'
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true;

    if (!targetMatch) {
      continue;
    }

    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);

    const selected = selectedByTier.get(testCase.tier);
    if (!selected
      || result.mutations > selected.result.mutations
      || (result.mutations === selected.result.mutations && testCase.id.localeCompare(selected.testCase.id) < 0)) {
      selectedByTier.set(testCase.tier, { testCase, result });
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);
  const totalCases = Object.values(sortedPerTier).reduce((sum, count) => sum + count, 0);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 4 target recount should match summary tiers');
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, 'variant 4 target recount should match summary statuses');
  assert.equal(totalCases, targetCoverage.total, 'variant 4 target recount should match summary total');

  return {
    target: 'staleRemoteAfterDryRunVariant4',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [...selectedByTier.values()]
      .map(({ testCase, result }) => generatedStaleRemoteAfterDryRunVariant4CaseEvidence(testCase, result))
      .sort((left, right) => left.tier - right.tier),
  };
}

function generatedStaleRemoteAfterDryRunVariant4CaseEvidence(testCase, result) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const mutationIndex = Math.floor((plan.mutations.length - 1) / 2);
  const mutation = plan.mutations[mutationIndex];
  const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation?.id);
  const staleRemote = cloneJson(testCase.remote);
  const stalePayload = `stale-private-rpp0177-${testCase.tier}-${mutation.id}`;
  const plannedValue = deserializeResourceValue(mutation.value);

  assert.equal(plan.status, 'ready', `${testCase.id} should be ready for variant 4 stale replay evidence`);
  assert.ok(plan.mutations.length > 2, `${testCase.id} should prove midpoint mutation precondition refusal`);
  assert.ok(mutationIndex > 0, `${testCase.id} midpoint stale replay mutation should not be first`);
  assert.ok(
    mutationIndex < plan.mutations.length - 1,
    `${testCase.id} midpoint stale replay mutation should not be last`,
  );
  assert.equal(plan.preconditions.length, plan.mutations.length);
  assert.ok(mutation, `${testCase.id} should have a planned mutation to drift after dry-run`);
  assert.ok(precondition, `${testCase.id} should have a live-remote precondition for ${mutation.resourceKey}`);
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(resourceHash(staleRemote, mutation.resource), precondition.expectedHash);

  setResource(
    staleRemote,
    mutation.resource,
    rpp0177StaleRemoteValue(mutation.resource, getResource(staleRemote, mutation.resource), stalePayload),
  );
  const staleResourceHash = resourceHash(staleRemote, mutation.resource);
  const remoteBeforeHash = digest(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, plan));
  const remoteAfterHash = digest(staleRemote);
  const proof = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    mutationIndex,
    mutationCount: plan.mutations.length,
    preconditionCount: plan.preconditions.length,
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    expectedHash: error.details.expectedHash,
    actualHash: error.details.actualHash,
    mutationRemoteBeforeHash: mutation.remoteBeforeHash,
    plannedValueHash: digest(plannedValue),
    preconditionHash: digest(precondition),
    detailsHash: digest(error.details),
    remoteBeforeHash,
    remoteAfterHash,
  };

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(error.details.resourceKey, mutation.resourceKey);
  assert.equal(error.details.expectedHash, precondition.expectedHash);
  assert.equal(error.details.actualHash, staleResourceHash);
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} variant 4 stale replay mutated remote before refusal`);
  assert.equal(result.status, 'ready');
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(result.staleReplayRemoteUnchanged, true);

  return {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: result.status,
    tags: [...testCase.tags].sort(),
    selection: 'highest-mutation-count-ready-case-per-tier',
    summary: plan.summary,
    staleReplay: {
      mutationId: mutation.id,
      mutationIndex,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      code: error.code,
      expectedHash: error.details.expectedHash,
      actualHash: error.details.actualHash,
      mutationRemoteBeforeHash: mutation.remoteBeforeHash,
      plannedValueHash: `sha256:${digest(plannedValue)}`,
      preconditionHash: `sha256:${digest(precondition)}`,
      detailsHash: `sha256:${digest(error.details)}`,
      remoteBeforeHash,
      remoteAfterHash,
    },
    modelProofHash: `sha256:${digest(proof)}`,
  };
}

function rpp0177StaleRemoteValue(resource, currentValue, stalePayload) {
  if (resource.type === 'file') {
    return { type: 'file', content: stalePayload };
  }

  if (resource.type === 'plugin') {
    return {
      ...(currentValue === ABSENT ? {} : currentValue),
      version: stalePayload,
    };
  }

  if (currentValue && currentValue !== ABSENT && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    return {
      ...currentValue,
      __rpp0177StaleRemoteAfterDryRun: stalePayload,
    };
  }

  return {
    value: currentValue === ABSENT ? 'absent-before-dry-run-v4' : currentValue,
    __rpp0177StaleRemoteAfterDryRun: stalePayload,
  };
}

function rpp0157StaleRemoteValue(resource, currentValue, stalePayload) {
  if (resource.type === 'file') {
    return currentValue === ABSENT
      ? stalePayload
      : { type: 'file', content: stalePayload };
  }

  if (resource.type === 'plugin') {
    return {
      ...(currentValue === ABSENT ? {} : currentValue),
      version: stalePayload,
    };
  }

  if (currentValue && currentValue !== ABSENT && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    return {
      ...currentValue,
      __rpp0157StaleRemoteAfterDryRun: stalePayload,
    };
  }

  return {
    value: currentValue === ABSENT ? 'absent-before-dry-run-v3' : currentValue,
    __rpp0157StaleRemoteAfterDryRun: stalePayload,
  };
}

function rpp0137StaleRemoteValue(resource, currentValue, stalePayload) {
  if (resource.type === 'file') {
    return { type: 'file', content: stalePayload };
  }

  if (resource.type === 'plugin') {
    return {
      ...(currentValue === ABSENT ? {} : currentValue),
      version: stalePayload,
    };
  }

  if (currentValue && currentValue !== ABSENT && typeof currentValue === 'object' && !Array.isArray(currentValue)) {
    return {
      ...currentValue,
      __rpp0137StaleRemoteAfterDryRun: stalePayload,
    };
  }

  return {
    value: currentValue === ABSENT ? 'absent-before-dry-run' : currentValue,
    __rpp0137StaleRemoteAfterDryRun: stalePayload,
  };
}

function hashOnlyGeneratedPlanEvidence(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    mutations: plan.mutations.map((mutation) => ({
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      changeKind: mutation.changeKind,
    })),
    preconditions: plan.preconditions.map((precondition) => ({
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      expectedHash: precondition.expectedHash,
      checkedAgainst: precondition.checkedAgainst,
    })),
    decisions: plan.decisions.map((decision) => ({
      id: decision.id,
      resourceKey: decision.resourceKey,
      decision: decision.decision,
      baseHash: decision.baseHash,
      localHash: decision.localHash || null,
      remoteHash: decision.remoteHash || null,
      change: decision.change,
    })),
    conflicts: plan.conflicts.map((conflict) => ({
      id: conflict.id,
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      resolutionPolicy: conflict.resolutionPolicy || null,
      change: conflict.change,
    })),
    blockers: plan.blockers.map((blocker) => ({
      id: blocker.id,
      resourceKey: blocker.resourceKey || null,
      class: blocker.class,
    })),
  };
}

function assertFileTypeSwapShape(testCase, { conflict }) {
  const swapEntries = Object.entries(testCase.base.files)
    .filter(([path, value]) => path.includes(conflict ? '/conflict-type-swap-' : '/ready-type-swap-')
      && value?.type === 'directory');

  assert.equal(swapEntries.length, 1, `${testCase.id} should start with one directory swap target`);

  const [path] = swapEntries[0];
  assert.deepEqual(testCase.base.files[path], { type: 'directory' });
  assert.deepEqual(testCase.remote.files[path], { type: 'directory' });
  assert.equal(testCase.local.files[path]?.type, 'file', `${testCase.id} local target should become a file`);
  assert.match(testCase.local.files[path]?.content, /^local type swap /);

  const remoteDescendants = Object.keys(testCase.remote.files)
    .filter((remotePath) => remotePath.startsWith(`${path}/`));
  assert.equal(remoteDescendants.length, conflict ? 1 : 0, `${testCase.id} remote descendant shape mismatch`);

  const remoteDescendantResource = remoteDescendants.length > 0
    ? { type: 'file', path: remoteDescendants[0] }
    : null;

  return {
    targetPath: path,
    targetResource: { type: 'file', path },
    targetResourceKey: `file:${path}`,
    remoteDescendants,
    remoteDescendantResource,
    remoteDescendantResourceKey: remoteDescendantResource ? `file:${remoteDescendantResource.path}` : null,
  };
}

function generatedFileTypeSwapConflictVariant4Evidence(targetCoverage) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has('file-type-swap-conflict-v4')) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedFileTypeSwapConflictVariant4CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (selectedKey === 'ready') {
      const selected = selectedCases.get('ready');
      if (!selected || !selected.remotePreservation) {
        selectedCases.set('ready', evidence);
      }
      continue;
    }
    if (!selectedCases.has('non-ready')) {
      selectedCases.set('non-ready', evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, 'variant 4 type-swap target recount should match summary tiers');
  assert.deepEqual(
    sortedStatuses,
    targetCoverage.statuses,
    'variant 4 type-swap target recount should match summary statuses',
  );
  assert.equal(totalCases, targetCoverage.total, 'variant 4 type-swap target recount should match summary total');
  assert.ok(selectedCases.has('ready'), 'variant 4 target should select one ready type-swap case');
  assert.ok(selectedCases.has('non-ready'), 'variant 4 target should select one descendant conflict case');
  assert.ok(
    selectedCases.get('ready').remotePreservation,
    'variant 4 ready evidence should include a concrete unplanned remote preservation proof',
  );

  return {
    target: 'fileTypeSwapConflictVariant4',
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

function generatedFileTypeSwapConflictVariant4CaseEvidence(testCase, result) {
  const conflict = testCase.family === 'file-type-swap-conflict';
  const shape = assertFileTypeSwapShape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = fileTypeSwapVariant4SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const typeSwap = fileTypeSwapVariant4ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });
    const remotePreservation = fileTypeSwapVariant4RemotePreservationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(conflict, false, `${testCase.id} ready evidence should come from ready type-swap family`);
    assert.equal(testCase.tags.has('file-type-swap-conflict-v4-ready'), true);
    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      typeSwap,
      remotePreservation,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        typeSwap,
        remotePreservation,
      })}`,
    };
  }

  assert.equal(conflict, true, `${testCase.id} non-ready evidence should come from type-swap conflict family`);
  assert.equal(testCase.tags.has('file-type-swap-conflict-v4-non-ready'), true);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const conflictEvidence = fileTypeSwapVariant4ConflictEvidence({ testCase, plan, shape });
  const remoteDescendant = fileTypeSwapVariant4RemoteDescendantEvidence({ testCase, plan, shape });
  const refusal = fileTypeSwapVariant4RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictEvidence,
    remoteDescendant,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictEvidence,
      remoteDescendant,
      refusal,
    })}`,
  };
}

function fileTypeSwapVariant4SurfaceEvidence(testCase, shape) {
  const target = {
    resourceKey: shape.targetResourceKey,
    baseHash: resourceHash(testCase.base, shape.targetResource),
    localHash: resourceHash(testCase.local, shape.targetResource),
    remoteHash: resourceHash(testCase.remote, shape.targetResource),
  };
  const remoteDescendant = shape.remoteDescendantResource
    ? {
        resourceKey: shape.remoteDescendantResourceKey,
        baseHash: resourceHash(testCase.base, shape.remoteDescendantResource),
        localHash: resourceHash(testCase.local, shape.remoteDescendantResource),
        remoteHash: resourceHash(testCase.remote, shape.remoteDescendantResource),
      }
    : null;

  return {
    target,
    remoteDescendant,
  };
}

function fileTypeSwapVariant4ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.targetResourceKey);
  const precondition = plan.preconditions.find((entry) => entry.resourceKey === shape.targetResourceKey);

  assert.ok(mutation, `${testCase.id} should plan the type-swap mutation`);
  assert.ok(precondition, `${testCase.id} should precondition the type-swap mutation`);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'type-change');
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(
    resourceHash(applied.site, shape.targetResource),
    resourceHash(testCase.local, shape.targetResource),
    `${testCase.id} applied type-swap hash should match local`,
  );

  const baseHash = resourceHash(testCase.base, shape.targetResource);
  const localHash = resourceHash(testCase.local, shape.targetResource);
  const remoteHash = resourceHash(testCase.remote, shape.targetResource);
  const appliedHash = resourceHash(applied.site, shape.targetResource);

  assert.equal(remoteHash, mutation.remoteBeforeHash, `${testCase.id} remote hash should match mutation preimage`);
  assert.equal(appliedHash, localHash, `${testCase.id} applied target hash should match local file`);

  return {
    resourceKey: shape.targetResourceKey,
    action: mutation.action,
    changeKind: mutation.changeKind,
    baseHash,
    localHash,
    remoteHash,
    appliedHash,
    mutationRemoteBeforeHash: mutation.remoteBeforeHash,
    preconditionExpectedHash: precondition.expectedHash,
    mutationHash: `sha256:${digest(mutation)}`,
    preconditionHash: `sha256:${digest(precondition)}`,
  };
}

function fileTypeSwapVariant4RemotePreservationEvidence({ testCase, plan, applied }) {
  const mutationResourceKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const preconditionResourceKeys = new Set(plan.preconditions.map((precondition) => precondition.resourceKey));
  const decisions = plan.decisions
    .filter((decision) => decision.decision === 'keep-remote'
      && !mutationResourceKeys.has(decision.resourceKey)
      && !preconditionResourceKeys.has(decision.resourceKey)
      && resourceHash(testCase.remote, decision.resource) !== resourceHash(testCase.base, decision.resource))
    .sort((left, right) => left.resourceKey.localeCompare(right.resourceKey));

  if (decisions.length === 0) {
    return null;
  }

  const decision = decisions[0];
  const baseHash = resourceHash(testCase.base, decision.resource);
  const localHash = resourceHash(testCase.local, decision.resource);
  const remoteHash = resourceHash(testCase.remote, decision.resource);
  const appliedHash = resourceHash(applied.site, decision.resource);

  assert.equal(localHash, baseHash, `${testCase.id} local should not change ${decision.resourceKey}`);
  assert.notEqual(remoteHash, baseHash, `${testCase.id} remote should drift ${decision.resourceKey}`);
  assert.equal(appliedHash, remoteHash, `${testCase.id} apply should preserve ${decision.resourceKey}`);

  return {
    resourceKey: decision.resourceKey,
    resourceType: decision.resource.type,
    decision: decision.decision,
    change: decision.change,
    baseHash,
    localHash,
    remoteHash,
    appliedHash,
    plannedMutation: false,
    plannedPrecondition: false,
    decisionHash: `sha256:${digest(decision)}`,
  };
}

function fileTypeSwapVariant4ConflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) =>
    entry.resourceKey === shape.targetResourceKey
      && entry.class === 'file-topology-conflict');
  const plannedMutation = plan.mutations.some((entry) => entry.resourceKey === shape.targetResourceKey);
  const plannedPrecondition = plan.preconditions.some((entry) => entry.resourceKey === shape.targetResourceKey);

  assert.ok(conflict, `${testCase.id} should report a topology conflict for ${shape.targetResourceKey}`);
  assert.equal(conflict.relatedResourceKey, shape.remoteDescendantResourceKey);
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted type-swap mutation`);
  assert.equal(plannedPrecondition, false, `${testCase.id} should not precondition the conflicted type-swap target`);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    relatedResourceKey: conflict.relatedResourceKey,
    plannedMutation,
    plannedPrecondition,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function fileTypeSwapVariant4RemoteDescendantEvidence({ testCase, plan, shape }) {
  assert.ok(shape.remoteDescendantResource, `${testCase.id} should include one remote descendant`);

  const decision = plan.decisions.find((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);
  const plannedMutation = plan.mutations.some((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);
  const plannedPrecondition = plan.preconditions.some((entry) => entry.resourceKey === shape.remoteDescendantResourceKey);

  assert.ok(decision, `${testCase.id} should record a keep-remote decision for the remote descendant`);
  assert.equal(decision.decision, 'keep-remote');
  assert.equal(plannedMutation, false);
  assert.equal(plannedPrecondition, false);

  return {
    resourceKey: shape.remoteDescendantResourceKey,
    decision: decision.decision,
    baseHash: resourceHash(testCase.base, shape.remoteDescendantResource),
    localHash: resourceHash(testCase.local, shape.remoteDescendantResource),
    remoteHash: resourceHash(testCase.remote, shape.remoteDescendantResource),
    plannedMutation,
    plannedPrecondition,
    decisionHash: `sha256:${digest(decision)}`,
  };
}

function fileTypeSwapVariant4RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
}

function assertFileCreateUpdateDeleteMixShape(testCase, { conflict } = {}) {
  const createFiles = Object.entries(testCase.local.files)
    .filter(([path, value]) => !hasGeneratedFile(testCase.base, path)
      && String(value).startsWith('generated file mix create '));
  const updateFiles = Object.entries(testCase.local.files)
    .filter(([path, value]) => hasGeneratedFile(testCase.base, path)
      && String(value).startsWith('generated file mix update '));
  const deleteFiles = Object.keys(testCase.base.files)
    .filter((path) => String(testCase.base.files[path]).startsWith('base shared ')
      && !hasGeneratedFile(testCase.local, path)
      && hasGeneratedFile(testCase.remote, path));
  const remoteOnlyFiles = Object.entries(testCase.remote.files)
    .filter(([path, value]) => !hasGeneratedFile(testCase.base, path)
      && !hasGeneratedFile(testCase.local, path)
      && String(value).startsWith('remote-only file mix preserve '));

  assert.equal(createFiles.length, 1, `${testCase.id} should create one file`);
  assert.equal(updateFiles.length, 1, `${testCase.id} should update one file`);
  assert.equal(deleteFiles.length, 1, `${testCase.id} should delete one file`);
  assert.equal(remoteOnlyFiles.length, 1, `${testCase.id} should include one remote-only preservation file`);

  const [createPath] = createFiles[0];
  const [updatePath] = updateFiles[0];
  const deletePath = deleteFiles[0];
  const [remoteOnlyPath] = remoteOnlyFiles[0];

  if (conflict === true) {
    assert.notEqual(
      testCase.remote.files[updatePath],
      testCase.base.files[updatePath],
      `${testCase.id} conflict case should drift the updated file remotely`,
    );
    assert.match(String(testCase.remote.files[updatePath]), /^remote concurrent file mix update /);
  } else if (conflict === false) {
    assert.equal(
      testCase.remote.files[updatePath],
      testCase.base.files[updatePath],
      `${testCase.id} ready case should leave the updated file unchanged remotely`,
    );
  }

  return {
    createPath,
    updatePath,
    deletePath,
    remoteOnlyPath,
    createResource: { type: 'file', path: createPath },
    updateResource: { type: 'file', path: updatePath },
    deleteResource: { type: 'file', path: deletePath },
    remoteOnlyResource: { type: 'file', path: remoteOnlyPath },
    createResourceKey: `file:${createPath}`,
    updateResourceKey: `file:${updatePath}`,
    deleteResourceKey: `file:${deletePath}`,
    remoteOnlyResourceKey: `file:${remoteOnlyPath}`,
  };
}

function hasGeneratedFile(site, path) {
  return Object.prototype.hasOwnProperty.call(site.files, path);
}

function generatedFileCreateUpdateDeleteMixVariant3Evidence(targetCoverage) {
  return generatedFileCreateUpdateDeleteMixVariantEvidence(targetCoverage, {
    target: 'fileCreateUpdateDeleteMixVariant3',
    tag: 'file-create-update-delete-mix-v3',
    label: 'variant 3',
  });
}

function generatedFileCreateUpdateDeleteMixVariant4Evidence(targetCoverage) {
  return generatedFileCreateUpdateDeleteMixVariantEvidence(targetCoverage, {
    target: 'fileCreateUpdateDeleteMixVariant4',
    tag: 'file-create-update-delete-mix-v4',
    label: 'variant 4',
  });
}

function generatedFileCreateUpdateDeleteMixVariantEvidence(targetCoverage, { target, tag, label }) {
  const perTier = {};
  const statuses = {};
  const selectedCases = new Map();
  let totalCases = 0;

  for (const testCase of generatePushHarnessCases()) {
    if (!testCase.tags.has(tag)) {
      continue;
    }

    const result = validateGeneratedCase(testCase);
    const evidence = generatedFileCreateUpdateDeleteMixVariant3CaseEvidence(testCase, result);
    const selectedKey = result.status === 'ready' ? 'ready' : 'non-ready';
    totalCases += 1;
    incrementCount(perTier, testCase.tier);
    incrementCount(statuses, result.status);
    if (!selectedCases.has(selectedKey)) {
      selectedCases.set(selectedKey, evidence);
    }
  }

  const sortedPerTier = sortNumericObject(perTier);
  const sortedStatuses = sortStringObject(statuses);

  assert.deepEqual(sortedPerTier, targetCoverage.perTier, `${label} target recount should match summary tiers`);
  assert.deepEqual(sortedStatuses, targetCoverage.statuses, `${label} target recount should match summary statuses`);
  assert.equal(totalCases, targetCoverage.total, `${label} target recount should match summary total`);
  assert.ok(selectedCases.has('ready'), `${label} target should select one ready file mix case`);
  assert.ok(selectedCases.has('non-ready'), `${label} target should select one non-ready file mix case`);

  return {
    target,
    family: targetCoverage.family,
    evidenceScope: 'local-generated-model',
    productionBacked: false,
    totalCases,
    readyCases: sortedStatuses.ready || 0,
    nonReadyCases: totalCases - (sortedStatuses.ready || 0),
    perTier: sortedPerTier,
    statuses: sortedStatuses,
    selectedCases: [
      selectedCases.get('ready'),
      selectedCases.get('non-ready'),
    ],
  };
}

function generatedFileCreateUpdateDeleteMixVariant3CaseEvidence(testCase, result) {
  const conflict = testCase.family === 'file-create-update-delete-mix-conflict';
  const shape = assertFileCreateUpdateDeleteMixShape(testCase, { conflict });
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const surface = fileMixVariant3SurfaceEvidence(testCase, shape);
  const commonEvidence = {
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    variant: result.status === 'ready' ? 'ready' : 'non-ready',
    status: result.status,
    tags: [...testCase.tags].sort(),
    planSummary: plan.summary,
    surface,
  };

  if (result.status === 'ready') {
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const plannedChangeKinds = fileMixVariant3ReadyMutationEvidence({
      testCase,
      plan,
      applied,
      shape,
    });
    const remoteOnly = fileMixVariant3RemoteOnlyEvidence({
      testCase,
      plan,
      applied,
      shape,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should plan as ready`);
    assert.equal(result.applied, true, `${testCase.id} should apply`);
    assert.equal(result.unplannedRemotePreserved, true, `${testCase.id} should preserve unplanned remote data`);
    assert.equal(result.staleReplayRejected, true, `${testCase.id} should reject stale replay`);
    assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
    assert.equal(result.staleReplayRemoteUnchanged, true, `${testCase.id} stale replay should not mutate remote`);

    return {
      ...commonEvidence,
      applied: result.applied,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
      plannedChangeKinds,
      remoteOnly,
      modelProofHash: `sha256:${digest({
        id: testCase.id,
        status: result.status,
        planSummary: plan.summary,
        surface,
        plannedChangeKinds,
        remoteOnly,
      })}`,
    };
  }

  assert.equal(conflict, true, `${testCase.id} non-ready file mix evidence should come from conflict family`);
  assert.notEqual(plan.status, 'ready', `${testCase.id} should plan as non-ready`);
  assert.notEqual(result.status, 'ready', `${testCase.id} should validate as non-ready`);
  assert.equal(result.applied, false, `${testCase.id} must not apply`);

  const conflictEvidence = fileMixVariant3ConflictEvidence({ testCase, plan, shape });
  const refusal = fileMixVariant3RefusalEvidence(testCase, plan);

  return {
    ...commonEvidence,
    applied: result.applied,
    conflict: conflictEvidence,
    refusal,
    modelProofHash: `sha256:${digest({
      id: testCase.id,
      status: result.status,
      planSummary: plan.summary,
      surface,
      conflict: conflictEvidence,
      refusal,
    })}`,
  };
}

function fileMixVariant3SurfaceEvidence(testCase, shape) {
  return Object.fromEntries([
    ['create', shape.createResource],
    ['update', shape.updateResource],
    ['delete', shape.deleteResource],
    ['remoteOnly', shape.remoteOnlyResource],
  ].map(([label, resource]) => [
    label,
    {
      resourceKey: `file:${resource.path}`,
      baseHash: resourceHash(testCase.base, resource),
      localHash: resourceHash(testCase.local, resource),
      remoteHash: resourceHash(testCase.remote, resource),
    },
  ]));
}

function fileMixVariant3ReadyMutationEvidence({ testCase, plan, applied, shape }) {
  const expected = [
    { resource: shape.createResource, resourceKey: shape.createResourceKey, changeKind: 'create' },
    { resource: shape.updateResource, resourceKey: shape.updateResourceKey, changeKind: 'update' },
    { resource: shape.deleteResource, resourceKey: shape.deleteResourceKey, changeKind: 'delete' },
  ];
  const mutations = new Map(plan.mutations.map((mutation) => [mutation.resourceKey, mutation]));
  const preconditions = new Map(plan.preconditions.map((precondition) => [precondition.resourceKey, precondition]));
  const plannedChangeKinds = {};

  for (const { resource, resourceKey, changeKind } of expected) {
    const mutation = mutations.get(resourceKey);
    const precondition = preconditions.get(resourceKey);
    assert.ok(mutation, `${testCase.id} should plan ${changeKind} mutation for ${resourceKey}`);
    assert.ok(precondition, `${testCase.id} should precondition ${resourceKey}`);
    assert.equal(mutation.changeKind, changeKind);
    assert.equal(precondition.mutationId, mutation.id);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(
      resourceHash(applied.site, resource),
      resourceHash(testCase.local, resource),
      `${testCase.id} did not apply local file mix value for ${resourceKey}`,
    );
    incrementCount(plannedChangeKinds, changeKind);
  }

  return sortStringObject(plannedChangeKinds);
}

function fileMixVariant3RemoteOnlyEvidence({ testCase, plan, applied, shape }) {
  const mutationResourceKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const preconditionResourceKeys = new Set(plan.preconditions.map((precondition) => precondition.resourceKey));
  const decision = plan.decisions.find((entry) => entry.resourceKey === shape.remoteOnlyResourceKey);

  assert.ok(decision, `${testCase.id} should record a keep-remote decision for ${shape.remoteOnlyResourceKey}`);
  assert.equal(decision.decision, 'keep-remote');
  assert.equal(mutationResourceKeys.has(shape.remoteOnlyResourceKey), false);
  assert.equal(preconditionResourceKeys.has(shape.remoteOnlyResourceKey), false);

  const baseHash = resourceHash(testCase.base, shape.remoteOnlyResource);
  const localHash = resourceHash(testCase.local, shape.remoteOnlyResource);
  const remoteHash = resourceHash(testCase.remote, shape.remoteOnlyResource);
  const appliedHash = resourceHash(applied.site, shape.remoteOnlyResource);

  assert.equal(localHash, baseHash, `${testCase.id} local should not create the remote-only file`);
  assert.notEqual(remoteHash, baseHash, `${testCase.id} remote should create the remote-only file`);
  assert.equal(appliedHash, remoteHash, `${testCase.id} apply should preserve the remote-only file`);

  return {
    resourceKey: shape.remoteOnlyResourceKey,
    decision: decision.decision,
    change: decision.change,
    baseHash,
    localHash,
    remoteHash,
    appliedHash,
    plannedMutation: false,
    plannedPrecondition: false,
    decisionHash: `sha256:${digest(decision)}`,
  };
}

function fileMixVariant3ConflictEvidence({ testCase, plan, shape }) {
  const conflict = plan.conflicts.find((entry) => entry.resourceKey === shape.updateResourceKey);
  const plannedMutation = plan.mutations.some((mutation) => mutation.resourceKey === shape.updateResourceKey);

  assert.ok(conflict, `${testCase.id} should report a conflict for ${shape.updateResourceKey}`);
  assert.equal(plannedMutation, false, `${testCase.id} should not plan the conflicted update file mutation`);

  return {
    resourceKey: conflict.resourceKey,
    class: conflict.class,
    change: conflict.change,
    plannedMutation,
    conflictHash: `sha256:${digest(conflict)}`,
  };
}

function fileMixVariant3RefusalEvidence(testCase, plan) {
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);

  assert.ok(error instanceof PushPlanError, `${testCase.id} non-ready plan should refuse apply`);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, `${testCase.id} non-ready refusal mutated remote`);

  return {
    code: error.code,
    detailsHash: `sha256:${digest(error.details)}`,
    remoteBeforeHash,
    remoteAfterHash,
  };
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
