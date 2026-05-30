import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../../src/apply.js';
import { createPushPlan } from '../../src/planner.js';
import { ABSENT, deepClone, digest } from '../../src/stable-json.js';
import {
  deserializeResourceValue,
  enumerateResources,
  getResource,
  resourceHash,
  serializeResourceValue,
  setResource,
} from '../../src/resources.js';

export const MIN_GENERATED_PUSH_CASES = 300;
export const DEFAULT_GENERATED_PUSH_CASES = 620;
export const DEFAULT_GENERATED_PUSH_SEED = 0x52706e74;

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const atomicDependencyPlugin = 'reprint-push-atomic-dependency-fixture';
const atomicDependentPlugin = 'reprint-push-atomic-dependent-fixture';

const scenarioFamilies = Object.freeze([
  'large-ready-plan-tier',
  'local-file-update',
  'remote-only-post-update',
  'remote-only-plugin-metadata',
  'independent-local-and-remote',
  'independent-local-row-remote-file',
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
  'same-plan-post-author-graph',
  'stale-post-author-graph',
  'stale-graph-reference',
  'same-plan-taxonomy-graph',
  'same-plan-comment-graph',
  'stale-comment-parent-graph',
  'plugin-owned-custom-table-changes',
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
  'file-type-swap-ready',
  'file-type-swap-conflict',
  'row-create-update-delete-mix-ready',
  'row-create-update-delete-mix-conflict',
  'wp-options-scalar-ready',
  'wp-options-scalar-conflict',
  'wp-options-serialized-ready',
  'wp-options-serialized-conflict',
  'wp-posts-create-update-delete-ready',
  'wp-posts-create-update-delete-conflict',
  'wp-postmeta-create-update-delete-ready',
  'wp-postmeta-create-update-delete-conflict',
  'wp-comments-commentmeta-graph-ready',
  'wp-comments-commentmeta-graph-stale',
  'wp-terms-termmeta-graph-ready',
  'wp-terms-termmeta-graph-stale',
  'wp-users-usermeta-graph-ready',
  'wp-users-usermeta-graph-stale',
  'wp-term-taxonomy-graph-ready',
  'wp-term-taxonomy-graph-stale',
  'plugin-owned-option-change-ready',
  'plugin-owned-option-change-conflict',
  'same-plan-user-meta-graph',
  'comment-user-graph-ready',
  'comment-user-graph-stale',
  'featured-image-attachment-ready',
  'featured-image-attachment-stale',
]);

const readyPreservingFamilies = new Set([
  'large-ready-plan-tier',
  'local-file-update',
  'remote-only-post-update',
  'remote-only-plugin-metadata',
  'independent-local-and-remote',
  'independent-local-row-remote-file',
  'local-delete',
  'same-independent-content',
  'supported-plugin-option',
  'supported-plugin-usermeta',
  'unsupported-plugin-usermeta',
  'same-plan-post-parent-graph',
  'same-plan-post-author-graph',
  'stale-post-author-graph',
  'same-plan-taxonomy-graph',
  'same-plan-comment-graph',
  'plugin-owned-custom-table-changes',
  'supported-forms-lab-table',
  'atomic-plugin-stack-ready',
  'plugin-file-update',
  'remote-delete-local-unchanged',
  'local-create',
  'file-create-update-delete-mix-ready',
  'file-type-swap-ready',
  'row-create-update-delete-mix-ready',
  'wp-options-scalar-ready',
  'wp-options-serialized-ready',
  'wp-posts-create-update-delete-ready',
  'wp-postmeta-create-update-delete-ready',
  'wp-comments-commentmeta-graph-ready',
  'wp-terms-termmeta-graph-ready',
  'wp-users-usermeta-graph-ready',
  'wp-term-taxonomy-graph-ready',
  'plugin-owned-option-change-ready',
  'same-plan-user-meta-graph',
  'comment-user-graph-ready',
  'comment-user-graph-stale',
  'featured-image-attachment-ready',
  'featured-image-attachment-stale',
]);

const skipSeededComplexityFamilies = new Set([
  'large-ready-plan-tier',
  'plugin-owned-custom-table-changes',
]);

const targetCoverageDefinitions = Object.freeze({
  independentLocalFileRemoteRow: {
    family: 'independent-local-and-remote',
    tag: 'independent-file-remote-row',
  },
  independentLocalRowRemoteFile: {
    family: 'independent-local-row-remote-file',
    tag: 'independent-row-remote-file',
  },
  localDeleteRemoteEdit: {
    family: 'delete-edit-conflict',
    tag: 'delete-edit',
  },
  directoryDescendantConflict: {
    family: 'directory-descendant-conflict',
    tag: 'directory-descendant',
  },
  directoryDescendantConflictVariant3: {
    family: 'directory-descendant-conflict-variant3',
    tag: 'directory-descendant-v3',
  },
  directoryDescendantConflictVariant4: {
    family: 'directory-descendant-conflict-variant4',
    tag: 'directory-descendant-v4',
  },
  fileCreateUpdateDeleteMix: {
    family: 'file-create-update-delete-mix-ready',
    tag: 'file-create-update-delete-mix',
  },
  largeReadyPlanTier: {
    family: 'large-ready-plan-tier',
    tag: 'large-ready-plan-target',
  },
  largeReadyPlanTierVariant3: {
    family: 'large-ready-plan-tier-variant3',
    tag: 'large-ready-plan-v3',
  },
  sameIndependentContent: {
    family: 'same-independent-content',
    tag: 'same-independent-content-target',
  },
  sameIndependentContentVariant3: {
    family: 'same-independent-content-variant3',
    matches: (testCase, result) => testCase.family === 'same-independent-content'
      && testCase.tags.has('same-independent-content-target')
      && result.status === 'ready'
      && result.applied === true
      && result.unplannedRemotePreserved === true,
  },
  remoteOnlyPreservation: {
    family: 'remote-only-post-update',
    matches: (testCase, result) => testCase.family === 'remote-only-post-update'
      && testCase.tags.has('remote-preserve')
      && result.status === 'ready'
      && result.unplannedRemotePreserved === true
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true,
  },
  remoteOnlyPreservationVariant3: {
    family: 'remote-only-preservation-variant3',
    matches: (testCase, result) => testCase.family === 'remote-only-post-update'
      && testCase.tags.has('remote-preserve')
      && result.status === 'ready'
      && result.unplannedRemotePreserved === true
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true,
  },
  fileTypeSwap: {
    family: 'file-type-swap-ready',
    tag: 'file-type-swap',
  },
  rowCreateUpdateDeleteMix: {
    family: 'row-create-update-delete-mix-ready',
    tag: 'row-create-update-delete-mix',
  },
  wpOptionsScalarChanges: {
    family: 'wp-options-scalar-ready',
    tag: 'wp-options-scalar',
  },
  wpOptionsScalarChangesVariant3: {
    family: 'wp-options-scalar-variant3',
    tag: 'wp-options-scalar-v3',
  },
  wpOptionsScalarChangesVariant4: {
    family: 'wp-options-scalar-variant4',
    tag: 'wp-options-scalar-v4',
  },
  wpOptionsSerializedChanges: {
    family: 'wp-options-serialized-ready',
    tag: 'wp-options-serialized-change',
  },
  wpOptionsSerializedChangesVariant3: {
    family: 'wp-options-serialized-variant3',
    tag: 'wp-options-serialized-v3',
  },
  wpOptionsSerializedChangesVariant4: {
    family: 'wp-options-serialized-variant4',
    tag: 'wp-options-serialized-v4',
  },
  sameIndependentContent: {
    family: 'same-independent-content',
    tag: 'same-independent-content-target',
  },
  fileTypeSwap: {
    family: 'file-type-swap-ready',
    tag: 'file-type-swap',
  },
  fileTypeSwapConflictVariant4: {
    family: 'file-type-swap-conflict-variant4',
    tag: 'file-type-swap-conflict-v4',
  },
  fileCreateUpdateDeleteMix: {
    family: 'file-create-update-delete-mix-ready',
    tag: 'file-create-update-delete-mix',
  },
  fileCreateUpdateDeleteMixVariant3: {
    family: 'file-create-update-delete-mix-variant3',
    tag: 'file-create-update-delete-mix-v3',
  },
  fileCreateUpdateDeleteMixVariant4: {
    family: 'file-create-update-delete-mix-variant4',
    tag: 'file-create-update-delete-mix-v4',
  },
  rowCreateUpdateDeleteMix: {
    family: 'row-create-update-delete-mix-ready',
    tag: 'row-create-update-delete-mix',
  },
  rowCreateUpdateDeleteMixVariant3: {
    family: 'row-create-update-delete-mix-variant3',
    tag: 'row-create-update-delete-mix-v3',
  },
  rowCreateUpdateDeleteMixVariant4: {
    family: 'row-create-update-delete-mix-variant4',
    tag: 'row-create-update-delete-mix-v4',
  },
  wpPostsCreateUpdateDelete: {
    family: 'wp-posts-create-update-delete-ready',
    tag: 'wp-posts-create-update-delete',
  },
  wpPostsCreateUpdateDeleteVariant3: {
    family: 'wp-posts-create-update-delete-variant3',
    tag: 'wp-posts-create-update-delete-v3',
  },
  wpPostsCreateUpdateDeleteVariant4: {
    family: 'wp-posts-create-update-delete-variant4',
    tag: 'wp-posts-create-update-delete-v4',
  },
  wpPostmetaCreateUpdateDelete: {
    family: 'wp-postmeta-create-update-delete-ready',
    tag: 'wp-postmeta-create-update-delete',
  },
  wpPostmetaCreateUpdateDeleteVariant3: {
    family: 'wp-postmeta-create-update-delete-variant3',
    tag: 'wp-postmeta-create-update-delete-v3',
  },
  wpPostmetaCreateUpdateDeleteVariant4: {
    family: 'wp-postmeta-create-update-delete-variant4',
    tag: 'wp-postmeta-create-update-delete-v4',
  },
  wpCommentsCommentmetaGraph: {
    family: 'wp-comments-commentmeta-graph-ready',
    tag: 'wp-comments-commentmeta-graph',
  },
  wpCommentsCommentmetaGraphVariant4: {
    family: 'wp-comments-commentmeta-graph-variant4',
    tag: 'wp-comments-commentmeta-graph-v4',
  },
  commentmetaCommentGraph: {
    family: 'wp-comments-commentmeta-graph-ready',
    tag: 'commentmeta-comment-graph',
  },
  wpTermsTermmetaGraph: {
    family: 'wp-terms-termmeta-graph-ready',
    tag: 'wp-terms-termmeta-graph',
  },
  wpTermsTermmetaGraphVariant3: {
    family: 'wp-terms-termmeta-graph-variant3',
    tag: 'wp-terms-termmeta-graph-v3',
  },
  wpTermsTermmetaGraphVariant4: {
    family: 'wp-terms-termmeta-graph-variant4',
    tag: 'wp-terms-termmeta-graph-v4',
  },
  wpUsersUsermetaGraph: {
    family: 'wp-users-usermeta-graph-ready',
    tag: 'wp-users-usermeta-graph',
  },
  wpUsersUsermetaGraphVariant3: {
    family: 'wp-users-usermeta-graph-variant3',
    tag: 'wp-users-usermeta-graph-v3',
  },
  wpUsersUsermetaGraphVariant4: {
    family: 'wp-users-usermeta-graph-variant4',
    tag: 'wp-users-usermeta-graph-v4',
  },
  wpTermTaxonomyGraph: {
    family: 'wp-term-taxonomy-graph-ready',
    tag: 'wp-term-taxonomy-graph',
  },
  wpTermTaxonomyGraphVariant3: {
    family: 'wp-term-taxonomy-graph-variant3',
    tag: 'wp-term-taxonomy-graph-v3',
  },
  wpTermTaxonomyGraphVariant4: {
    family: 'wp-term-taxonomy-graph-variant4',
    tag: 'wp-term-taxonomy-graph-v4',
  },
  wpTermRelationshipsGraph: {
    family: 'wp-term-relationships-graph',
    tag: 'wp-term-relationships-graph-target',
  },
  wpTermRelationshipsGraphVariant3: {
    family: 'wp-term-relationships-graph-variant3',
    tag: 'wp-term-relationships-graph-v3',
  },
  atomicPluginInstallStack: {
    family: 'atomic-plugin-stack-ready',
    tag: 'atomic-plugin-install-stack-v3',
  },
  atomicPluginInstallStackV1: {
    family: 'atomic-plugin-stack-ready',
    tag: 'atomic-plugin-install-stack-v1',
  },
  atomicPluginInstallStackV2: {
    family: 'atomic-plugin-stack-ready',
    tag: 'atomic-plugin-install-stack-v2',
  },
  pluginOwnedOptionChange: {
    family: 'plugin-owned-option-change-ready',
    tag: 'plugin-owned-option-change',
  },
  pluginOwnedOptionChangeVariant3: {
    family: 'plugin-owned-option-change-variant3',
    tag: 'plugin-owned-option-change-v3',
  },
  pluginOwnedCustomTableChanges: {
    family: 'plugin-owned-custom-table-changes',
    tag: 'plugin-owned-custom-table-target',
  },
  pluginOwnedCustomTableVariant1: {
    family: 'plugin-owned-custom-table-variant1',
    tag: 'plugin-owned-custom-table-variant1',
  },
  pluginOwnedCustomTableChangesVariant3: {
    family: 'plugin-owned-custom-table-changes-variant3',
    tag: 'plugin-owned-custom-table-variant3',
  },
  pluginOwnedResourceRefusalVariant3: {
    family: 'plugin-owned-resource-refusal-variant3',
    tag: 'plugin-owned-resource-refusal-v3',
  },
  staleRemoteAfterDryRun: {
    family: 'ready-plan-stale-remote-after-dry-run',
    matches: (_testCase, result) => result.status === 'ready'
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true,
  },
  staleRemoteAfterDryRunVariant3: {
    family: 'ready-plan-stale-remote-after-dry-run-variant3',
    matches: (_testCase, result) => result.status === 'ready'
      && result.staleReplayRejected === true
      && result.staleReplayRejectionCode === 'PRECONDITION_FAILED'
      && result.staleReplayRemoteUnchanged === true,
  },
  postAuthorGraph: {
    family: 'same-plan-post-author-graph',
    tag: 'post-author-graph',
  },
  commentUserGraph: {
    family: 'comment-user-graph-ready',
    tag: 'comment-user-graph',
  },
  featuredImageAttachmentGraph: {
    family: 'featured-image-attachment-ready',
    tag: 'featured-image-attachment',
  },
  usermetaDriverSupported: {
    family: 'supported-plugin-usermeta',
    tag: 'plugin-usermeta-driver-supported',
  },
  usermetaDriverUnsupported: {
    family: 'unsupported-plugin-usermeta',
    tag: 'plugin-usermeta-driver-unsupported',
  },
});

export function generatePushHarnessCases({
  count = DEFAULT_GENERATED_PUSH_CASES,
  seed = DEFAULT_GENERATED_PUSH_SEED,
} = {}) {
  assert.ok(
    Number.isInteger(count) && count >= MIN_GENERATED_PUSH_CASES,
    `generated push harness needs at least ${MIN_GENERATED_PUSH_CASES} cases`,
  );

  return Array.from({ length: count }, (_, index) => {
    const tier = Math.min(9, Math.floor((index * 10) / count));
    const rng = mulberry32((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    return buildGeneratedCase({ index, tier, rng });
  });
}

export function generateDriverOwnerIdentityBindingCases() {
  return [
    'supported-exact-owner-policy',
    'unsupported-wrong-policy-owner',
    'unsupported-missing-owner-policy',
    'unsupported-local-owner-drift',
    'unsupported-stale-owner-context',
  ].map((variant, index) => buildDriverOwnerIdentityBindingCase({ variant, index }));
}

export function generateDriverDeleteSupportFlagCases() {
  return [
    'delete-supported-applies',
    'delete-unsupported-blocked',
    'forged-delete-support-flag-rejected',
  ].map((variant, index) => buildDriverDeleteSupportFlagCase({ variant, index }));
}

export function generateDriverDryRunValidationHookCases() {
  return [
    'supported-dry-run-hook-applies',
    'unsupported-dry-run-hook-blocked',
  ].map((variant, index) => buildDriverDryRunValidationHookCase({ variant, index }));
}

export function generateDirectActivePluginsMutationRefusalCases() {
  return [
    'supported-plugin-managed-option-applies',
    'unsupported-direct-active-plugins-blocked',
    'forged-ready-active-plugins-rejected-before-mutation',
  ].map((variant, index) => buildDirectActivePluginsMutationRefusalCase({ variant, index }));
}

export function runGeneratedPushHarness(options = {}) {
  const cases = generatePushHarnessCases(options);
  const summary = emptySummary();

  for (const testCase of cases) {
    const result = validateGeneratedCase(testCase);
    recordSummary(summary, testCase, result);
  }

  summary.totalCases = cases.length;
  summary.featureFamilies = Object.fromEntries(
    Object.entries(summary.featureFamilies).sort(([left], [right]) => left.localeCompare(right)),
  );
  summary.statuses = Object.fromEntries(
    Object.entries(summary.statuses).sort(([left], [right]) => left.localeCompare(right)),
  );
  summary.statusByTier = Object.fromEntries(
    Object.entries(summary.statusByTier)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, tiers]) => [
        status,
        Object.fromEntries(Object.entries(tiers).sort(([left], [right]) => Number(left) - Number(right))),
      ]),
  );
  summary.statusByFeatureFamily = sortNestedStatusCounts(summary.statusByFeatureFamily);
  summary.tiers = Object.fromEntries(
    Object.entries(summary.tiers).sort(([left], [right]) => Number(left) - Number(right)),
  );
  summary.targetCoverage = Object.fromEntries(
    Object.entries(summary.targetCoverage)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([target, coverage]) => [
        target,
        {
          ...coverage,
          perTier: sortNumericObject(coverage.perTier),
          statuses: sortStringObject(coverage.statuses),
        },
      ]),
  );

  return {
    summary,
    cases: cases.map((testCase) => ({
      id: testCase.id,
      tier: testCase.tier,
      family: testCase.family,
      tags: [...testCase.tags].sort(),
      complexityScore: testCase.complexityScore,
    })),
  };
}

export function validateDriverOwnerIdentityBindingCase(testCase) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });
  const result = {
    id: testCase.id,
    variant: testCase.variant,
    status: plan.status,
    mutations: plan.mutations.length,
    blockers: plan.blockers.length,
    proofHash: digest({
      id: testCase.id,
      status: plan.status,
      mutations: plan.mutations.map((mutation) => ({
        resourceKey: mutation.resourceKey,
        pluginOwnedResource: mutation.pluginOwnedResource,
      })),
      blockers: plan.blockers.map((blocker) => ({
        class: blocker.class,
        resourceKey: blocker.resourceKey,
        pluginOwner: blocker.pluginOwner,
        driver: blocker.driver,
        reason: blocker.reason,
        ownerMetadataRefusalEvidence: blocker.ownerMetadataRefusalEvidence || null,
        change: blocker.change,
      })),
    }),
  };

  assertGeneratedOwnerBindingRedacted(testCase, result);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === testCase.resourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === testCase.resourceKey);

  if (testCase.expected.outcome === 'ready') {
    assert.equal(plan.status, 'ready', `${testCase.id} should be ready`);
    assert.equal(plan.blockers.length, 0, `${testCase.id} should not produce blockers`);
    assert.ok(mutation, `${testCase.id} should plan the plugin-owned mutation`);
    assert.equal(mutation.pluginOwnedResource.pluginOwner, testCase.expected.owner);
    assert.equal(mutation.pluginOwnedResource.driver, testCase.expected.driver);
    assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
    const applied = applyPlan(deepClone(testCase.remote), plan);
    assert.equal(applied.appliedMutations, 1);
    assert.equal(
      applied.site.db.wp_options[testCase.rowId].option_value.mode,
      testCase.expected.appliedMode,
    );
    assertGeneratedOwnerBindingRedacted(testCase, applied.journal);
    result.applied = true;
    result.outcome = 'ready';
    return result;
  }

  if (testCase.expected.outcome === 'planner-blocked') {
    assert.equal(plan.status, 'blocked', `${testCase.id} should be blocked`);
    assert.equal(mutation, undefined, `${testCase.id} should not plan a mutation`);
    assert.ok(blocker, `${testCase.id} should expose a blocker`);
    assert.equal(blocker.class, testCase.expected.blockerClass);
    assert.equal(blocker.pluginOwner, testCase.expected.owner);
    assert.equal(blocker.driver || null, testCase.expected.driver || null);
    if (testCase.expected.reasonCode) {
      assert.equal(blocker.ownerMetadataRefusalEvidence.reasonCode, testCase.expected.reasonCode);
      assert.equal(blocker.ownerMetadataRefusalEvidence.pluginOwner, testCase.expected.owner);
      assert.deepEqual(blocker.ownerMetadataRefusalEvidence.stalePluginMetadataResourceKeys, [
        `plugin:${testCase.expected.owner}`,
      ]);
    }
    const remoteBefore = digest(testCase.remote);
    const error = captureError(() => applyPlan(testCase.remote, plan));
    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'PLAN_NOT_READY');
    assert.equal(digest(testCase.remote), remoteBefore, `${testCase.id} mutated a blocked remote`);
    assertGeneratedOwnerBindingRedacted(testCase, blocker);
    assertGeneratedOwnerBindingRedacted(testCase, error.details);
    result.applied = false;
    result.outcome = 'planner-blocked';
    return result;
  }

  assert.equal(testCase.expected.outcome, 'apply-refused');
  assert.equal(plan.status, 'ready', `${testCase.id} should reach apply validation`);
  assert.ok(mutation, `${testCase.id} should plan a mutation before apply refuses it`);
  assert.equal(mutation.pluginOwnedResource.pluginOwner, testCase.expected.plannedOwner);
  assert.equal(mutation.pluginOwnedResource.driver, testCase.expected.driver);
  const remote = deepClone(testCase.remote);
  const remoteBefore = digest(remote);
  const error = captureError(() => applyPlan(remote, plan));
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(error.details.resourceKey, testCase.resourceKey);
  assert.equal(error.details.pluginOwner, testCase.expected.applyOwner);
  assert.equal(error.details.driver, testCase.expected.driver);
  assert.equal(digest(remote), remoteBefore, `${testCase.id} mutated a refused remote`);
  assertGeneratedOwnerBindingRedacted(testCase, error.details);
  result.applied = false;
  result.outcome = 'apply-refused';
  return result;
}

export function validateDriverDryRunValidationHookCase(testCase) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });
  const mutation = plan.mutations.find((entry) => entry.resourceKey === testCase.dataResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === testCase.dataResourceKey);
  const result = {
    id: testCase.id,
    variant: testCase.variant,
    status: plan.status,
    mutations: plan.mutations.length,
    blockers: plan.blockers.length,
    evidenceScope: 'local-generated',
    productionBacked: false,
    releaseGate: 'NO-GO',
    proofHash: digest({
      id: testCase.id,
      variant: testCase.variant,
      evidenceScope: 'local-generated',
      productionBacked: false,
      releaseGate: 'NO-GO',
      status: plan.status,
      mutation: mutation ? driverDryRunValidationMutationSummary(mutation) : null,
      blocker: blocker ? driverDryRunValidationBlockerSummary(blocker) : null,
    }),
  };

  assertDriverDryRunValidationRedacted(testCase, result);

  if (testCase.expected.outcome === 'applied-supported-hook') {
    assert.equal(plan.status, 'ready');
    assert.equal(plan.mutations.length, 1);
    assert.equal(plan.blockers.length, 0);
    assert.ok(mutation, `${testCase.id} should emit a supported dry-run validation mutation`);
    assert.equal(mutation.action, 'put');
    assert.equal(mutation.resourceKey, testCase.dataResourceKey);
    assert.equal(mutation.pluginOwnedResource.pluginOwner, testCase.plugin);
    assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
    assert.deepEqual(mutation.pluginOwnedResource.dryRunValidationEvidence, {
      reasonCode: 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_PASSED',
      operation: 'dry-run-validation',
      resourceKey: testCase.dataResourceKey,
      pluginOwner: testCase.plugin,
      driver: 'wp-option',
      policySource: 'local-snapshot',
      hook: 'wp-option:validate-row',
      supportedHook: true,
      status: 'passed',
    });
    assertDriverDryRunValidationChangeHashEvidence(mutation.change);
    assertDriverDryRunValidationRedacted(testCase, mutation.pluginOwnedResource.dryRunValidationEvidence);

    const applied = applyPlan(deepClone(testCase.remote), plan);
    assert.equal(applied.appliedMutations, 1);
    assert.equal(
      applied.site.db.wp_options[testCase.dataRowId].option_value.mode,
      testCase.expected.appliedMode,
    );
    assert.deepEqual(applied.site.plugins[testCase.plugin], testCase.expected.plugin);
    result.outcome = 'applied-supported-hook';
    result.applied = true;
    result.appliedMutations = applied.appliedMutations;
    return result;
  }

  assert.equal(testCase.expected.outcome, 'blocked-unsupported-hook');
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.mutations.length, 0);
  assert.ok(blocker, `${testCase.id} should expose an unsupported dry-run validation hook blocker`);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.driver, 'wp-option');
  assert.equal(blocker.pluginOwner, testCase.plugin);
  assert.equal(blocker.reason, 'Plugin-owned resource driver dry-run validation hook is not supported.');
  assert.deepEqual(blocker.dryRunValidationEvidence, {
    reasonCode: 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_UNSUPPORTED',
    operation: 'refuse-before-mutation',
    resourceKey: testCase.dataResourceKey,
    pluginOwner: testCase.plugin,
    driver: 'wp-option',
    policySource: 'local-snapshot',
    hook: 'wp-option:unsupported-dry-run',
    supportedHook: false,
    status: 'passed',
  });
  assert.equal(blocker.change.localChange, 'update');
  assert.equal(blocker.change.remoteChange, 'unchanged');
  assertDriverDryRunValidationChangeHashEvidence(blocker.change);
  assertDriverDryRunValidationRedacted(testCase, blocker);

  const remote = deepClone(testCase.remote);
  const remoteBefore = digest(remote);
  const error = captureError(() => applyPlan(remote, plan));
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(remote), remoteBefore, `${testCase.id} mutated a blocked unsupported dry-run hook`);
  assert.equal(
    remote.db.wp_options[testCase.dataRowId].option_value.token,
    testCase.expected.remoteToken,
  );
  assertDriverDryRunValidationRedacted(testCase, error.details);
  result.outcome = 'blocked-unsupported-hook';
  result.applied = false;
  result.remotePreserved = true;
  return result;
}

export function validateDriverDeleteSupportFlagCase(testCase) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });
  const mutation = plan.mutations.find((entry) => entry.resourceKey === testCase.dataResourceKey);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === testCase.dataResourceKey);
  const result = {
    id: testCase.id,
    variant: testCase.variant,
    status: plan.status,
    mutations: plan.mutations.length,
    blockers: plan.blockers.length,
    evidenceScope: 'local-generated',
    productionBacked: false,
    releaseGate: 'NO-GO',
    proofHash: digest({
      id: testCase.id,
      variant: testCase.variant,
      evidenceScope: 'local-generated',
      productionBacked: false,
      releaseGate: 'NO-GO',
      status: plan.status,
      mutation: mutation ? driverDeleteSupportMutationSummary(mutation) : null,
      blocker: blocker ? driverDeleteSupportBlockerSummary(blocker) : null,
    }),
  };

  assertDriverDeleteSupportRedacted(testCase, result);

  if (testCase.expected.outcome === 'applied-delete') {
    assert.equal(plan.status, 'ready');
    assert.equal(plan.mutations.length, 1);
    assert.equal(plan.blockers.length, 0);
    assert.ok(mutation, `${testCase.id} should emit a delete mutation`);
    assert.equal(mutation.action, 'delete');
    assert.equal(mutation.resourceKey, testCase.dataResourceKey);
    assert.equal(mutation.pluginOwnedResource.pluginOwner, testCase.plugin);
    assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
    assert.equal(mutation.pluginOwnedResource.supportsDelete, true);
    assertDriverDeleteSupportAuditEvidence(mutation.pluginOwnedResource.auditEvidence, true);
    assertDriverDeleteSupportChangeHashEvidence(mutation.change);
    assertDriverDeleteSupportRedacted(testCase, mutation.pluginOwnedResource.auditEvidence);

    const applied = applyPlan(deepClone(testCase.remote), plan);
    assert.equal(applied.appliedMutations, 1);
    assert.equal(Object.hasOwn(applied.site.db.wp_options, testCase.dataRowId), false);
    assert.deepEqual(applied.site.plugins[testCase.plugin], testCase.expected.plugin);
    result.outcome = 'applied-delete';
    result.applied = true;
    result.appliedMutations = applied.appliedMutations;
    return result;
  }

  if (testCase.expected.outcome === 'blocked-unsupported-delete') {
    assert.equal(plan.status, 'blocked');
    assert.equal(plan.mutations.length, 0);
    assert.ok(blocker, `${testCase.id} should expose an unsupported delete-support blocker`);
    assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
    assert.equal(blocker.driver, 'wp-option');
    assert.equal(blocker.pluginOwner, testCase.plugin);
    assert.equal(blocker.reason, 'Plugin-owned resource driver does not support delete mutations.');
    assert.equal(blocker.change.localChange, 'delete');
    assert.equal(blocker.change.remoteChange, 'unchanged');
    assertDriverDeleteSupportChangeHashEvidence(blocker.change);
    assertDriverDeleteSupportRedacted(testCase, blocker);

    const remote = deepClone(testCase.remote);
    const remoteBefore = digest(remote);
    const error = captureError(() => applyPlan(remote, plan));
    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'PLAN_NOT_READY');
    assert.equal(digest(remote), remoteBefore, `${testCase.id} mutated a blocked unsupported delete`);
    assert.equal(
      remote.db.wp_options[testCase.dataRowId].option_value.token,
      testCase.expected.remoteToken,
    );
    assertDriverDeleteSupportRedacted(testCase, error.details);
    result.outcome = 'blocked-unsupported-delete';
    result.applied = false;
    result.remotePreserved = true;
    return result;
  }

  assert.equal(testCase.expected.outcome, 'rejected-forged-unsupported-delete');
  assert.equal(plan.status, 'ready');
  assert.ok(mutation, `${testCase.id} should start from a valid delete-support plan`);
  assert.equal(mutation.pluginOwnedResource.supportsDelete, true);
  const forgedPlan = driverDeleteSupportForgedUnsupportedPlan(plan, mutation.id);
  const forgedMutation = forgedPlan.mutations.find((entry) => entry.id === mutation.id);
  assert.equal(forgedMutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(forgedMutation.pluginOwnedResource.auditEvidence.supportsDelete, false);
  const remote = deepClone(testCase.remote);
  const remoteBefore = digest(remote);
  const error = captureError(() => applyPlan(remote, forgedPlan));
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(error.details.resourceKey, testCase.dataResourceKey);
  assert.equal(error.details.pluginOwner, testCase.plugin);
  assert.equal(error.details.driver, 'wp-option');
  assert.equal(error.details.applyValidationEvidence.action, 'delete');
  assert.equal(error.details.applyValidationEvidence.supportsDelete, false);
  assert.equal(digest(remote), remoteBefore, `${testCase.id} mutated a forged unsupported delete`);
  assert.equal(
    remote.db.wp_options[testCase.dataRowId].option_value.token,
    testCase.expected.remoteToken,
  );
  assertDriverDeleteSupportRedacted(testCase, error.details);
  result.outcome = 'rejected-forged-unsupported-delete';
  result.applied = false;
  result.rejectionCode = error.code;
  return result;
}

export function validateDirectActivePluginsMutationRefusalCase(testCase) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });
  const activePluginsMutation = plan.mutations.find((entry) =>
    entry.resourceKey === testCase.activePluginsResourceKey);
  const activePluginsBlocker = plan.blockers.find((entry) =>
    entry.resourceKey === testCase.activePluginsResourceKey);
  const managedMutation = plan.mutations.find((entry) =>
    entry.resourceKey === testCase.dataResourceKey);
  const result = {
    id: testCase.id,
    variant: testCase.variant,
    status: plan.status,
    mutations: plan.mutations.length,
    blockers: plan.blockers.length,
    preconditions: plan.preconditions.length,
    evidenceScope: 'local-generated',
    productionBacked: false,
    releaseGate: 'NO-GO',
  };

  if (testCase.expected.outcome === 'applied-supported-plugin-managed-path') {
    assert.equal(plan.status, 'ready');
    assert.equal(plan.mutations.length, 1);
    assert.equal(plan.blockers.length, 0);
    assert.equal(activePluginsMutation, undefined);
    assert.ok(managedMutation, `${testCase.id} should emit a plugin-managed option mutation`);
    assert.equal(managedMutation.action, 'put');
    assert.equal(managedMutation.resourceKey, testCase.dataResourceKey);
    assert.equal(managedMutation.pluginOwnedResource.pluginOwner, testCase.plugin);
    assert.equal(managedMutation.pluginOwnedResource.driver, 'wp-option');
    assert.equal(managedMutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
    assertDirectActivePluginsChangeHashEvidence(managedMutation.change);

    const applied = applyPlan(deepClone(testCase.remote), plan);
    assert.equal(applied.appliedMutations, 1);
    assert.equal(
      applied.site.db.wp_options[testCase.dataRowId].option_value.mode,
      testCase.expected.appliedMode,
    );
    assert.equal(
      resourceHash(applied.site, directActivePluginsResource()),
      resourceHash(testCase.remote, directActivePluginsResource()),
    );
    assertDirectActivePluginsRedacted(testCase, managedMutation.pluginOwnedResource.auditEvidence);
    assertDirectActivePluginsRedacted(testCase, applied.journal);

    result.outcome = 'applied-supported-plugin-managed-path';
    result.applied = true;
    result.appliedMutations = applied.appliedMutations;
    result.activePluginsPreserved = true;
    result.proofHash = digest({
      id: testCase.id,
      variant: testCase.variant,
      outcome: result.outcome,
      status: plan.status,
      mutation: directActivePluginsMutationSummary(managedMutation),
      activePluginsHash: resourceHash(applied.site, directActivePluginsResource()),
      journalHash: digest(applied.journal),
    });
    assertDirectActivePluginsRedacted(testCase, result);
    return result;
  }

  if (testCase.expected.outcome === 'blocked-direct-active-plugins') {
    assert.equal(plan.status, 'blocked');
    assert.equal(plan.mutations.length, 0);
    assert.equal(plan.preconditions.length, 0);
    assert.equal(activePluginsMutation, undefined);
    assert.ok(activePluginsBlocker, `${testCase.id} should expose an active_plugins blocker`);
    assertDirectActivePluginsBlocker(testCase, activePluginsBlocker);

    const remote = deepClone(testCase.remote);
    const before = digest(remote);
    let beforeMutationCalls = 0;
    const error = captureError(() => applyPlan(remote, plan, {
      beforeMutation() {
        beforeMutationCalls += 1;
      },
    }));

    assert.ok(error instanceof PushPlanError);
    assert.equal(error.code, 'PLAN_NOT_READY');
    assert.equal(beforeMutationCalls, 0);
    assert.equal(digest(remote), before, `${testCase.id} mutated a blocked active_plugins remote`);
    assert.equal(
      resourceHash(remote, directActivePluginsResource()),
      resourceHash(testCase.remote, directActivePluginsResource()),
    );
    assertDirectActivePluginsRedacted(testCase, activePluginsBlocker);
    assertDirectActivePluginsRedacted(testCase, error.details);

    result.outcome = 'blocked-direct-active-plugins';
    result.applied = false;
    result.remotePreserved = true;
    result.proofHash = digest({
      id: testCase.id,
      variant: testCase.variant,
      outcome: result.outcome,
      status: plan.status,
      blocker: directActivePluginsBlockerSummary(activePluginsBlocker),
      errorDetailsHash: digest(error.details),
      activePluginsHash: resourceHash(remote, directActivePluginsResource()),
    });
    assertDirectActivePluginsRedacted(testCase, result);
    return result;
  }

  assert.equal(testCase.expected.outcome, 'rejected-forged-direct-active-plugins');
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.mutations.length, 0);
  assert.ok(activePluginsBlocker, `${testCase.id} should first prove planner refusal`);
  assertDirectActivePluginsBlocker(testCase, activePluginsBlocker);

  const forgedPlan = directActivePluginsForgedReadyPlan(testCase);
  const forgedMutation = forgedPlan.mutations[0];
  const remote = deepClone(testCase.remote);
  const before = digest(remote);
  let beforeMutationCalls = 0;
  const error = captureError(() => applyPlan(remote, forgedPlan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'UNSUPPORTED_ACTIVE_PLUGINS_MUTATION');
  assert.equal(error.details.resourceKey, testCase.activePluginsResourceKey);
  assert.equal(error.details.reasonCode, 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED');
  assert.equal(error.details.requiredDriver, 'plugin-activation-driver');
  assert.equal(beforeMutationCalls, 0);
  assert.equal(digest(remote), before, `${testCase.id} mutated a forged active_plugins remote`);
  assert.equal(
    resourceHash(remote, directActivePluginsResource()),
    resourceHash(testCase.remote, directActivePluginsResource()),
  );
  assertDirectActivePluginsRedacted(testCase, directActivePluginsMutationSummary(forgedMutation));
  assertDirectActivePluginsRedacted(testCase, error.details);

  result.outcome = 'rejected-forged-direct-active-plugins';
  result.applied = false;
  result.remotePreserved = true;
  result.rejectionCode = error.code;
  result.beforeMutationCalls = beforeMutationCalls;
  result.proofHash = digest({
    id: testCase.id,
    variant: testCase.variant,
    outcome: result.outcome,
    plannerBlocker: directActivePluginsBlockerSummary(activePluginsBlocker),
    forgedMutation: directActivePluginsMutationSummary(forgedMutation),
    errorDetailsHash: digest(error.details),
    activePluginsHash: resourceHash(remote, directActivePluginsResource()),
  });
  assertDirectActivePluginsRedacted(testCase, result);
  return result;
}

export function validateGeneratedCase(testCase) {
  const plan = createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });

  assertPlanContract(testCase, plan);

  const mutationKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const resourceCount = enumerateResources(testCase.base, testCase.local, testCase.remote).length;
  const result = {
    status: plan.status,
    mutations: plan.mutations.length,
    preconditions: plan.preconditions.length,
    conflicts: plan.conflicts.length,
    blockers: plan.blockers.length,
    decisions: plan.decisions.length,
    atomicGroups: plan.atomicGroups.length,
    resourceCount,
  };

  if (plan.status === 'ready') {
    const applied = applyPlan(deepClone(testCase.remote), plan);
    assertMergedResultPreservesRemoteUnlessPlanned(testCase, plan, applied.site, mutationKeys);
    result.unplannedRemotePreserved = true;
    const staleReplay = assertReadyPlanRejectsStaleRemote(testCase, plan);
    result.staleReplayRejected = staleReplay.rejected;
    result.staleReplayRejectionCode = staleReplay.code;
    result.staleReplayRemoteUnchanged = staleReplay.remoteUnchanged;
    result.applied = true;
    return result;
  }

  const before = digest(testCase.remote);
  const error = captureError(() => applyPlan(testCase.remote, plan));
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(digest(testCase.remote), before, `${testCase.id} mutated a non-ready remote`);
  result.nonReadyRemoteUnchanged = true;
  result.applied = false;
  return result;
}

function buildDriverOwnerIdentityBindingCase({ variant, index }) {
  const base = buildBaseSite(4400 + index, 4);
  const local = deepClone(base);
  const remote = deepClone(base);
  const optionName = `rpp_owner_identity_${index + 1}`;
  const rowId = `option_name:${optionName}`;
  const resourceKey = rowKey('wp_options', rowId);
  const secretTokens = {
    base: `rpp0442-base-secret-${index + 1}`,
    local: `rpp0442-local-secret-${index + 1}`,
    remote: `rpp0442-remote-secret-${index + 1}`,
  };
  const baseRow = {
    option_name: optionName,
    option_value: { mode: 'base', token: secretTokens.base },
    __pluginOwner: 'forms',
  };

  setRow(base, 'wp_options', rowId, baseRow);
  setRow(remote, 'wp_options', rowId, baseRow);
  setRow(local, 'wp_options', rowId, {
    ...baseRow,
    option_value: { mode: `local-${variant}`, token: secretTokens.local },
  });

  const testCase = {
    id: `rpp-0442-driver-owner-identity-${String(index + 1).padStart(2, '0')}`,
    variant,
    tier: index,
    family: 'driver-owner-identity-binding',
    tags: new Set(['driver-owner-identity-binding', 'plugin-owned-generated']),
    resourceKey,
    rowId,
    secretTokens: Object.values(secretTokens),
    base,
    local,
    remote,
    expected: null,
  };

  if (variant === 'supported-exact-owner-policy') {
    allowPluginOwned(local, resourceKey, 'forms', 'wp-option');
    testCase.tags.add('driver-owner-identity-supported');
    testCase.expected = {
      outcome: 'ready',
      owner: 'forms',
      driver: 'wp-option',
      appliedMode: `local-${variant}`,
    };
    return testCase;
  }

  if (variant === 'unsupported-wrong-policy-owner') {
    allowPluginOwned(local, resourceKey, 'forms-impostor', 'wp-option');
    testCase.tags.add('driver-owner-identity-unsupported');
    testCase.expected = {
      outcome: 'planner-blocked',
      blockerClass: 'unsupported-plugin-owned-resource',
      owner: 'forms',
      driver: null,
    };
    return testCase;
  }

  if (variant === 'unsupported-missing-owner-policy') {
    testCase.tags.add('driver-owner-identity-unsupported');
    testCase.expected = {
      outcome: 'planner-blocked',
      blockerClass: 'unsupported-plugin-owned-resource',
      owner: 'forms',
      driver: null,
    };
    return testCase;
  }

  if (variant === 'unsupported-local-owner-drift') {
    allowPluginOwned(local, resourceKey, 'forms', 'wp-option');
    local.db.wp_options[rowId].__pluginOwner = 'forms-impostor';
    testCase.tags.add('driver-owner-identity-unsupported');
    testCase.expected = {
      outcome: 'apply-refused',
      plannedOwner: 'forms',
      applyOwner: 'forms-impostor',
      driver: 'wp-option',
    };
    return testCase;
  }

  assert.equal(variant, 'unsupported-stale-owner-context');
  allowPluginOwned(local, resourceKey, 'forms', 'wp-option');
  remote.plugins.forms = { version: '9.9.9', active: false };
  testCase.tags.add('driver-owner-identity-unsupported');
  testCase.expected = {
    outcome: 'planner-blocked',
    blockerClass: 'stale-plugin-owner-context',
    owner: 'forms',
    driver: 'wp-option',
    reasonCode: 'STALE_PLUGIN_METADATA_OWNER_CONTEXT',
  };
  return testCase;
}

function buildDriverDryRunValidationHookCase({ variant, index }) {
  const base = buildBaseSite(4170 + index, 4);
  const plugin = 'forms';
  const optionName = `rpp_0417_driver_dry_run_validation_${index + 1}`;
  const dataRowId = `option_name:${optionName}`;
  const dataResourceKey = rowKey('wp_options', dataRowId);
  const secrets = {
    pluginVersion: `rpp0417-plugin-version-secret-${index + 1}`,
    baseOption: `rpp0417-base-dry-run-token-secret-${index + 1}`,
    localOption: `rpp0417-local-dry-run-token-secret-${index + 1}`,
  };
  const supportedHook = variant === 'supported-dry-run-hook-applies';
  const dryRunValidation = supportedHook
    ? { hook: 'wp-option:validate-row', status: 'passed' }
    : { hook: 'wp-option:unsupported-dry-run', status: 'passed' };
  const baseRow = {
    option_name: optionName,
    option_value: { mode: 'base-dry-run-validation-target', token: secrets.baseOption },
    __pluginOwner: plugin,
  };

  base.plugins[plugin] = { version: secrets.pluginVersion, active: true };
  setRow(base, 'wp_options', dataRowId, baseRow);

  const local = deepClone(base);
  const remote = deepClone(base);
  setRow(local, 'wp_options', dataRowId, {
    ...baseRow,
    option_value: { mode: `local-${variant}`, token: secrets.localOption },
  });
  allowPluginOwned(local, dataResourceKey, plugin, 'wp-option', { dryRunValidation });

  const testCase = {
    id: `rpp-0417-driver-dry-run-validation-${String(index + 1).padStart(2, '0')}`,
    variant,
    tier: index,
    family: 'driver-dry-run-validation-hook',
    tags: new Set(['driver-dry-run-validation-hook', 'plugin-owned-generated']),
    plugin,
    dataResourceKey,
    dataRowId,
    secretTokens: Object.values(secrets),
    base,
    local,
    remote,
    expected: {
      remoteToken: secrets.baseOption,
      plugin: base.plugins[plugin],
    },
  };

  if (supportedHook) {
    testCase.tags.add('driver-dry-run-validation-supported');
    testCase.expected.outcome = 'applied-supported-hook';
    testCase.expected.appliedMode = `local-${variant}`;
    return testCase;
  }

  assert.equal(variant, 'unsupported-dry-run-hook-blocked');
  testCase.tags.add('driver-dry-run-validation-unsupported');
  testCase.expected.outcome = 'blocked-unsupported-hook';
  return testCase;
}

function buildDriverDeleteSupportFlagCase({ variant, index }) {
  const base = buildBaseSite(4560 + index, 4);
  const plugin = 'forms';
  const optionName = `rpp_0456_driver_delete_support_${index + 1}`;
  const dataRowId = `option_name:${optionName}`;
  const dataResourceKey = rowKey('wp_options', dataRowId);
  const secrets = {
    pluginVersion: `rpp0456-plugin-version-secret-${index + 1}`,
    baseOption: `rpp0456-base-delete-token-secret-${index + 1}`,
  };
  const supportsDelete = variant !== 'delete-unsupported-blocked';
  const baseRow = {
    option_name: optionName,
    option_value: { mode: 'base-delete-target', token: secrets.baseOption },
    __pluginOwner: plugin,
  };

  base.plugins[plugin] = { version: secrets.pluginVersion, active: true };
  setRow(base, 'wp_options', dataRowId, baseRow);
  allowPluginOwned(base, dataResourceKey, plugin, 'wp-option', { supportsDelete });

  const local = deepClone(base);
  const remote = deepClone(base);
  deleteRow(local, 'wp_options', dataRowId);
  allowPluginOwned(local, dataResourceKey, plugin, 'wp-option', { supportsDelete });
  allowPluginOwned(remote, dataResourceKey, plugin, 'wp-option', { supportsDelete });

  const testCase = {
    id: `rpp-0456-driver-delete-support-${String(index + 1).padStart(2, '0')}`,
    variant,
    tier: index,
    family: 'driver-delete-support-flag',
    tags: new Set(['driver-delete-support-flag', 'plugin-owned-generated']),
    plugin,
    dataResourceKey,
    dataRowId,
    secretTokens: Object.values(secrets),
    base,
    local,
    remote,
    expected: {
      remoteToken: secrets.baseOption,
      plugin: base.plugins[plugin],
    },
  };

  if (variant === 'delete-supported-applies') {
    testCase.tags.add('delete-support-true-applies');
    testCase.expected.outcome = 'applied-delete';
    return testCase;
  }

  if (variant === 'forged-delete-support-flag-rejected') {
    testCase.tags.add('delete-support-forged-fail-closed');
    testCase.expected.outcome = 'rejected-forged-unsupported-delete';
    return testCase;
  }

  assert.equal(variant, 'delete-unsupported-blocked');
  testCase.tags.add('delete-support-false-blocked');
  testCase.expected.outcome = 'blocked-unsupported-delete';
  return testCase;
}

function buildDirectActivePluginsMutationRefusalCase({ variant, index }) {
  const base = buildBaseSite(4720 + index, 4);
  const plugin = 'forms';
  const activePluginsRowId = 'option_name:active_plugins';
  const activePluginsResourceKey = rowKey('wp_options', activePluginsRowId);
  const optionName = `rpp_0472_managed_option_${index + 1}`;
  const dataRowId = `option_name:${optionName}`;
  const dataResourceKey = rowKey('wp_options', dataRowId);
  const secrets = {
    baseActivePlugin: `rpp0472-base-active-plugin-secret-${index + 1}/rpp0472-base-active-plugin-secret.php`,
    localActivePlugin: `rpp0472-local-active-plugin-secret-${index + 1}/rpp0472-local-active-plugin-secret.php`,
    baseOption: `rpp0472-base-managed-option-secret-${index + 1}`,
    localOption: `rpp0472-local-managed-option-secret-${index + 1}`,
  };
  const baseDataRow = {
    option_name: optionName,
    option_value: {
      mode: 'base-managed-option',
      token: secrets.baseOption,
    },
    __pluginOwner: plugin,
  };

  setRow(base, 'wp_options', activePluginsRowId, activePluginsOptionRow([secrets.baseActivePlugin]));
  setRow(base, 'wp_options', dataRowId, baseDataRow);

  const local = deepClone(base);
  const remote = deepClone(base);
  const testCase = {
    id: `rpp-0472-direct-active-plugins-${String(index + 1).padStart(2, '0')}`,
    variant,
    tier: index,
    family: 'direct-active-plugins-mutation-refusal',
    tags: new Set(['direct-active-plugins-mutation-refusal', 'plugin-owned-generated']),
    plugin,
    activePluginsResourceKey,
    activePluginsRowId,
    dataResourceKey,
    dataRowId,
    secretTokens: Object.values(secrets),
    base,
    local,
    remote,
    expected: {
      remoteActivePluginsHash: resourceHash(remote, directActivePluginsResource()),
    },
  };

  if (variant === 'supported-plugin-managed-option-applies') {
    setRow(local, 'wp_options', dataRowId, {
      ...baseDataRow,
      option_value: {
        mode: `local-${variant}`,
        token: secrets.localOption,
      },
    });
    allowPluginOwned(local, dataResourceKey, plugin, 'wp-option');
    testCase.tags.add('direct-active-plugins-supported-managed-path');
    testCase.expected.outcome = 'applied-supported-plugin-managed-path';
    testCase.expected.appliedMode = `local-${variant}`;
    return testCase;
  }

  setRow(local, 'wp_options', activePluginsRowId, activePluginsOptionRow([
    secrets.baseActivePlugin,
    secrets.localActivePlugin,
  ]));
  testCase.tags.add('direct-active-plugins-unsupported');

  if (variant === 'unsupported-direct-active-plugins-blocked') {
    testCase.expected.outcome = 'blocked-direct-active-plugins';
    return testCase;
  }

  assert.equal(variant, 'forged-ready-active-plugins-rejected-before-mutation');
  testCase.tags.add('direct-active-plugins-forged-ready-plan');
  testCase.expected.outcome = 'rejected-forged-direct-active-plugins';
  return testCase;
}

function buildGeneratedCase({ index, tier, rng }) {
  const id = `generated-push-${String(index + 1).padStart(3, '0')}`;
  const family = scenarioFamilies[index % scenarioFamilies.length];
  const base = buildBaseSite(index, tier);
  const local = deepClone(base);
  const remote = deepClone(base);
  const allocator = createAllocator(index, tier);
  const tags = new Set([`tier-${tier}`]);

  scenarioFamilyBuilders[family]({
    id,
    family,
    tier,
    rng,
    base,
    local,
    remote,
    allocator,
    tags,
  });

  addWpTermRelationshipsGraphTarget({
    family,
    tier,
    base,
    local,
    remote,
    allocator,
    tags,
  });

  addPluginOwnedResourceRefusalVariant3Target({
    family,
    tier,
    base,
    local,
    remote,
    allocator,
    tags,
  });

  addGeneratedComplexity({
    id,
    family,
    tier,
    rng,
    base,
    local,
    remote,
    allocator,
    tags,
  });

  const complexityScore = enumerateResources(base, local, remote).length
    + (local.pushIntents?.length || 0) * 10
    + tags.size;

  return {
    id,
    index,
    tier,
    family,
    tags,
    complexityScore,
    base,
    local,
    remote,
  };
}

function addPluginOwnedResourceRefusalVariant3Target({
  family,
  tier,
  base,
  local,
  remote,
  allocator,
  tags,
}) {
  const variantsByFamily = {
    'supported-plugin-option': 'ready',
    'unsupported-plugin-usermeta': 'changed',
    'plugin-owned-option-change-conflict': 'stale',
  };
  const variant = variantsByFamily[family];
  if (!variant) {
    return;
  }

  const optionName = `rpp0143_plugin_owned_refusal_v3_${variant}_${tier}_${allocator.next()}`;
  const rowId = `option_name:${optionName}`;
  const resourceKey = rowKey('wp_options', rowId);
  const baseRow = {
    option_name: optionName,
    option_value: {
      mode: 'base',
      privateToken: `rpp0143-${variant}-base-private-token-${tier}`,
    },
    __pluginOwner: 'forms',
  };

  setRow(base, 'wp_options', rowId, baseRow);
  setRow(local, 'wp_options', rowId, {
    ...baseRow,
    option_value: {
      mode: `local-${variant}`,
      privateToken: `rpp0143-${variant}-local-private-token-${tier}`,
    },
  });
  setRow(remote, 'wp_options', rowId, baseRow);

  if (variant === 'ready') {
    allowPluginOwned(local, resourceKey, 'forms', 'wp-option');
  }

  if (variant === 'stale') {
    setRow(remote, 'wp_options', rowId, {
      ...baseRow,
      option_value: {
        mode: 'remote-stale',
        privateToken: `rpp0143-${variant}-remote-private-token-${tier}`,
      },
    });
  }

  tags.add('plugin-owned-resource-refusal-v3');
  tags.add(`plugin-owned-resource-refusal-v3-${variant}`);
}

function addWpTermRelationshipsGraphTarget({
  family,
  tier,
  base,
  local,
  remote,
  allocator,
  tags,
}) {
  const readyTarget = family === 'supported-plugin-option' && tier % 2 === 0;
  const staleTarget = family === 'comment-user-graph-stale' && tier % 2 === 1;
  if (!readyTarget && !staleTarget) {
    return;
  }

  addWpTermRelationshipsGraph(base, local, remote, allocator, tags, {
    staleTarget,
    prefix: staleTarget ? 'stale-wp-term-relationships' : 'ready-wp-term-relationships',
  });
  tags.add(staleTarget ? 'expected-blocked' : 'ready-candidate');
}

const scenarioFamilyBuilders = {
  'large-ready-plan-tier': ({ tier, base, local, remote, allocator, tags }) => {
    addLargeReadyPlanTier(tier, base, local, remote, allocator, tags);
  },
  'local-file-update': ({ local, allocator, tags }) => {
    const path = allocator.filePath('local');
    local.files[path] = `local file update ${allocator.next()}`;
    tags.add('ready-candidate');
  },
  'remote-only-post-update': ({ remote, allocator, tags }) => {
    const postId = allocator.postId();
    ensurePostExists(remote, postId);
    remote.db.wp_posts[`ID:${postId}`].post_title = `Remote editorial ${allocator.next()}`;
    tags.add('remote-preserve');
  },
  'remote-only-plugin-metadata': ({ remote, allocator, tags }) => {
    remote.plugins['reprint-push-forms-fixture'] = {
      version: `1.${allocator.next()}.0`,
      active: false,
      channel: `remote-metadata-${allocator.next()}`,
    };
    tags.add('remote-preserve');
    tags.add('plugin-metadata-preserve');
  },
  'independent-local-and-remote': ({ local, remote, allocator, tags }) => {
    const localPath = allocator.filePath('independent-local');
    const remotePostId = allocator.postId();
    local.files[localPath] = `independent local ${allocator.next()}`;
    ensurePostExists(remote, remotePostId);
    remote.db.wp_posts[`ID:${remotePostId}`].post_title = `Independent remote ${allocator.next()}`;
    tags.add('independent-merge');
    tags.add('independent-file-remote-row');
  },
  'independent-local-row-remote-file': ({ base, local, remote, allocator, tags }) => {
    const localPostId = allocator.graphId();
    const rowId = `ID:${localPostId}`;
    const remotePath = allocator.existingUploadPath();
    const baseRow = makePost(localPostId, `Base independent local row ${localPostId}`);
    setRow(base, 'wp_posts', rowId, baseRow);
    setRow(local, 'wp_posts', rowId, baseRow);
    setRow(remote, 'wp_posts', rowId, baseRow);
    local.db.wp_posts[rowId].post_title = `Independent local row ${allocator.next()}`;
    remote.files[remotePath] = `independent remote file ${allocator.next()}`;
    tags.add('independent-merge');
    tags.add('independent-row-remote-file');
  },
  'direct-row-conflict': ({ local, remote, allocator, tags }) => {
    const postId = allocator.postId();
    ensurePostExists(local, postId);
    ensurePostExists(remote, postId);
    local.db.wp_posts[`ID:${postId}`].post_title = `Local conflict ${allocator.next()}`;
    remote.db.wp_posts[`ID:${postId}`].post_title = `Remote conflict ${allocator.next()}`;
    tags.add('expected-conflict');
  },
  'local-delete': ({ base, local, remote, allocator, tags }) => {
    const path = allocator.existingUploadPath();
    delete local.files[path];

    const directory = `wp-content/uploads/descendant-ready-${allocator.next()}`;
    base.files[directory] = { type: 'directory' };
    local.files[directory] = { type: 'directory' };
    remote.files[directory] = { type: 'directory' };
    delete local.files[directory];

    tags.add('delete');
    tags.add('file-topology');
    tags.add('directory-descendant');
    tags.add('directory-descendant-ready');
    tags.add('directory-descendant-v3');
    tags.add('directory-descendant-v3-ready');
    tags.add('directory-descendant-v4');
    tags.add('directory-descendant-v4-ready');
    tags.add('directory-delete-no-remote-descendant');
  },
  'same-independent-content': ({ local, remote, allocator, tags }) => {
    const postId = allocator.postId();
    ensurePostExists(local, postId);
    ensurePostExists(remote, postId);
    const title = `Shared independent ${allocator.next()}`;
    local.db.wp_posts[`ID:${postId}`].post_title = title;
    remote.db.wp_posts[`ID:${postId}`].post_title = title;
    tags.add('already-in-sync');
    tags.add('same-independent-content-target');
  },
  'supported-plugin-option': ({ base, local, remote, allocator, tags }) => {
    const optionName = `forms_generated_${allocator.next()}`;
    const resourceKey = rowKey('wp_options', `option_name:${optionName}`);
    const row = {
      option_name: optionName,
      option_value: { mode: 'base', ordinal: allocator.next() },
      __pluginOwner: 'forms',
    };
    setRow(base, 'wp_options', `option_name:${optionName}`, row);
    setRow(remote, 'wp_options', `option_name:${optionName}`, row);
    setRow(local, 'wp_options', `option_name:${optionName}`, {
      ...row,
      option_value: { mode: 'local', ordinal: allocator.next() },
    });
    allowPluginOwned(local, resourceKey, 'forms', 'wp-option');
    tags.add('plugin-owned-supported');
  },
  'supported-plugin-usermeta': ({ base, local, remote, allocator, tags }) => {
    const usermetaId = allocator.graphId();
    const rowId = `umeta_id:${usermetaId}`;
    const resourceKey = rowKey('wp_usermeta', rowId);
    const row = {
      umeta_id: usermetaId,
      user_id: 1,
      meta_key: `_forms_generated_user_flag_${usermetaId}`,
      meta_value: { mode: 'base', usermetaId },
      __pluginOwner: 'forms',
    };
    setRow(base, 'wp_usermeta', rowId, row);
    setRow(remote, 'wp_usermeta', rowId, row);
    setRow(local, 'wp_usermeta', rowId, {
      ...row,
      meta_value: { mode: 'local', usermetaId, ordinal: allocator.next() },
    });
    allowPluginOwned(local, resourceKey, 'forms', 'wp-usermeta');
    tags.add('plugin-owned-supported');
    tags.add('plugin-usermeta-driver-supported');
  },
  'unsupported-plugin-usermeta': ({ base, local, remote, allocator, tags }) => {
    const usermetaId = allocator.graphId();
    const rowId = `umeta_id:${usermetaId}`;
    const resourceKey = rowKey('wp_usermeta', rowId);
    const row = {
      umeta_id: usermetaId,
      user_id: 1,
      meta_key: `_forms_generated_user_flag_${usermetaId}`,
      meta_value: { mode: 'base', usermetaId },
      __pluginOwner: 'forms',
    };
    setRow(base, 'wp_usermeta', rowId, row);
    setRow(remote, 'wp_usermeta', rowId, row);
    setRow(local, 'wp_usermeta', rowId, {
      ...row,
      umeta_id: usermetaId + 1,
      meta_value: { mode: 'local-invalid', usermetaId },
    });
    allowPluginOwned(local, resourceKey, 'forms', 'wp-usermeta');
    tags.add('plugin-owned-unsupported');
    tags.add('plugin-usermeta-driver-unsupported');
  },
  'unsupported-plugin-owned-row': ({ local, allocator, tags }) => {
    const optionName = `unsafe_generated_${allocator.next()}`;
    setRow(local, 'wp_options', `option_name:${optionName}`, {
      option_name: optionName,
      option_value: { mode: 'local-unsafe' },
      __pluginOwner: 'unknown-owner',
    });
    tags.add('plugin-owned-unsupported');
  },
  'plugin-owner-context-drift': ({ base, local, remote, allocator, tags }) => {
    local.db.wp_options['option_name:forms_settings'].option_value.mode = `local-${allocator.next()}`;
    remote.files['wp-content/plugins/forms/forms.php'] = `<?php /* remote forms ${allocator.next()} */`;
    allowPluginOwned(base, rowKey('wp_options', 'option_name:forms_settings'), 'forms', 'wp-option');
    allowPluginOwned(local, rowKey('wp_options', 'option_name:forms_settings'), 'forms', 'wp-option');
    tags.add('plugin-context-drift');
  },
  'file-topology-conflict': ({ base, local, remote, allocator, tags }) => {
    const directory = `wp-content/uploads/topology-${allocator.next()}`;
    base.files[directory] = { type: 'directory' };
    local.files[directory] = { type: 'directory' };
    remote.files[directory] = { type: 'directory' };
    delete local.files[directory];
    remote.files[`${directory}/remote-child.txt`] = `remote child ${allocator.next()}`;
    tags.add('file-topology');
  },
  'directory-descendant-conflict': ({ base, local, remote, allocator, tags }) => {
    const directory = `wp-content/uploads/descendant-${allocator.next()}`;
    const descendant = `${directory}/remote-child-${allocator.next()}.txt`;
    base.files[directory] = { type: 'directory' };
    local.files[directory] = { type: 'directory' };
    remote.files[directory] = { type: 'directory' };
    delete local.files[directory];
    remote.files[descendant] = `remote descendant ${allocator.next()}`;
    tags.add('file-topology');
    tags.add('directory-descendant');
    tags.add('directory-descendant-v3');
    tags.add('directory-descendant-v3-non-ready');
    tags.add('directory-descendant-v4');
    tags.add('directory-descendant-v4-non-ready');
    tags.add('directory-delete-with-remote-descendant');
  },
  'same-plan-post-parent-graph': ({ local, allocator, tags }) => {
    const parentId = allocator.graphId();
    const childId = allocator.graphId();
    setRow(local, 'wp_posts', `ID:${parentId}`, makePost(parentId, `Parent ${parentId}`));
    setRow(local, 'wp_posts', `ID:${childId}`, makePost(childId, `Child ${childId}`, {
      post_type: 'page',
      post_parent: parentId,
    }));
    tags.add('same-plan-graph');
    tags.add('post-parent-graph');
  },
  'stale-graph-reference': ({ local, remote, allocator, tags }) => {
    const remotePostId = allocator.graphId();
    const metaId = allocator.graphId();
    setRow(remote, 'wp_posts', `ID:${remotePostId}`, makePost(remotePostId, `Remote graph target ${remotePostId}`));
    setRow(local, 'wp_postmeta', `post_id:${remotePostId}:meta_key:_generated_graph_ref_${metaId}`, {
      post_id: remotePostId,
      meta_key: `_generated_graph_ref_${metaId}`,
      meta_value: 'local-stale-reference',
    });
    tags.add('stale-graph');
  },
  'same-plan-post-author-graph': ({ base, local, remote, allocator, tags }) => {
    addPostAuthorGraph(base, local, remote, allocator, tags, { staleTarget: false });
  },
  'stale-post-author-graph': ({ base, local, remote, allocator, tags }) => {
    addPostAuthorGraph(base, local, remote, allocator, tags, { staleTarget: true });
  },
  'same-plan-taxonomy-graph': ({ local, allocator, tags }) => {
    const termId = allocator.graphId();
    const taxonomyId = allocator.graphId();
    const metaId = allocator.graphId();
    setRow(local, 'wp_terms', `term_id:${termId}`, {
      term_id: termId,
      name: `Generated term ${termId}`,
      slug: `generated-term-${termId}`,
      term_group: 0,
    });
    setRow(local, 'wp_term_taxonomy', `term_taxonomy_id:${taxonomyId}`, {
      term_taxonomy_id: taxonomyId,
      term_id: termId,
      taxonomy: 'category',
      parent: 0,
      count: 1,
    });
    setRow(local, 'wp_term_relationships', `object_id:1|term_taxonomy_id:${taxonomyId}`, {
      object_id: 1,
      term_taxonomy_id: taxonomyId,
      term_order: 0,
    });
    setRow(local, 'wp_termmeta', `meta_id:${metaId}`, {
      meta_id: metaId,
      term_id: termId,
      meta_key: '_generated_taxonomy_marker',
      meta_value: `marker-${metaId}`,
    });
    tags.add('same-plan-graph');
    tags.add('taxonomy-graph');
  },
  'same-plan-comment-graph': ({ local, allocator, tags }) => {
    const parentId = allocator.graphId();
    const childId = allocator.graphId();
    const metaId = allocator.graphId();
    setRow(local, 'wp_comments', `comment_ID:${parentId}`, makeComment(parentId, {
      comment_post_ID: 1,
      comment_parent: 0,
      user_id: 1,
    }));
    setRow(local, 'wp_comments', `comment_ID:${childId}`, makeComment(childId, {
      comment_post_ID: 1,
      comment_parent: parentId,
      user_id: 1,
    }));
    setRow(local, 'wp_commentmeta', `meta_id:${metaId}`, {
      meta_id: metaId,
      comment_id: childId,
      meta_key: '_generated_comment_marker',
      meta_value: `comment-marker-${metaId}`,
    });
    tags.add('same-plan-graph');
    tags.add('comment-graph');
    tags.add('comment-parent-graph');
    tags.add('comment-parent-ready');
  },
  'stale-comment-parent-graph': ({ base, local, remote, allocator, tags }) => {
    const parentId = allocator.graphId();
    const childId = allocator.graphId();
    const parentRowId = `comment_ID:${parentId}`;
    const parentComment = makeComment(parentId, {
      comment_post_ID: 1,
      comment_parent: 0,
      user_id: 1,
      comment_content: `Generated thread parent ${parentId}`,
    });
    setRow(base, 'wp_comments', parentRowId, parentComment);
    setRow(local, 'wp_comments', parentRowId, parentComment);
    setRow(remote, 'wp_comments', parentRowId, {
      ...parentComment,
      comment_content: `Remote edited thread parent ${parentId}`,
    });
    setRow(local, 'wp_comments', `comment_ID:${childId}`, makeComment(childId, {
      comment_post_ID: 1,
      comment_parent: parentId,
      user_id: 1,
      comment_content: `Generated child reply ${childId}`,
    }));
    tags.add('stale-graph');
    tags.add('comment-graph');
    tags.add('comment-parent-graph');
    tags.add('comment-parent-stale');
  },
  'plugin-owned-custom-table-changes': ({ base, local, remote, allocator, tags, tier }) => {
    const staleTarget = tier % 2 === 1;
    addPluginOwnedCustomTableChanges(base, local, remote, allocator, tags, {
      staleTarget,
      prefix: staleTarget ? 'stale-forms-lab' : 'ready-forms-lab',
    });
    if (staleTarget) {
      tags.add('expected-conflict');
    } else {
      tags.add('ready-candidate');
    }
  },
  'supported-forms-lab-table': ({ base, local, remote, allocator, tags }) => {
    const id = allocator.formsLabId();
    const rowId = `id:${id}`;
    const row = {
      id,
      form_slug: `generated-forms-lab-${id}`,
      payload: { owner: 'forms', mode: 'base', token: `forms-lab-${id}` },
      __pluginOwner: 'forms',
    };
    setRow(base, 'wp_reprint_push_forms_lab', rowId, row);
    setRow(remote, 'wp_reprint_push_forms_lab', rowId, row);
    setRow(local, 'wp_reprint_push_forms_lab', rowId, {
      ...row,
      payload: { owner: 'forms', mode: 'local', token: `forms-lab-${id}` },
    });
    allowPluginOwned(local, rowKey('wp_reprint_push_forms_lab', rowId), 'forms', 'fixture-forms-lab-table', {
      table: 'wp_reprint_push_forms_lab',
    });
    tags.add('forms-lab-supported');
    tags.add('plugin-owned-custom-table-change');
  },
  'forms-lab-delete-blocked': ({ base, local, remote, allocator, tags }) => {
    const id = allocator.formsLabId();
    const rowId = `id:${id}`;
    const row = {
      id,
      form_slug: `generated-delete-blocked-${id}`,
      payload: { owner: 'forms', mode: 'base', token: `delete-blocked-${id}` },
      __pluginOwner: 'forms',
    };
    setRow(base, 'wp_reprint_push_forms_lab', rowId, row);
    setRow(remote, 'wp_reprint_push_forms_lab', rowId, row);
    deleteRow(local, 'wp_reprint_push_forms_lab', rowId);
    allowPluginOwned(local, rowKey('wp_reprint_push_forms_lab', rowId), 'forms', 'fixture-forms-lab-table', {
      table: 'wp_reprint_push_forms_lab',
    });
    tags.add('forms-lab-delete-blocked');
    tags.add('plugin-owned-custom-table-change');
  },
  'atomic-plugin-stack-ready': ({ local, tags }) => {
    installAtomicStack(local);
    tags.add('atomic-ready');
    tags.add('atomic-plugin-install-stack-v1');
    tags.add('atomic-plugin-stack-ready-v1');
    tags.add('atomic-plugin-install-stack-v2');
    tags.add('atomic-plugin-stack-ready-v2');
    tags.add('atomic-plugin-install-stack-v3');
    tags.add('atomic-plugin-stack-ready-v3');
  },
  'atomic-plugin-missing-dependency': ({ local, tags }) => {
    local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* generated dependent */';
    local.plugins[atomicDependentPlugin] = {
      version: '1.0.0',
      active: true,
      requires: [atomicDependencyPlugin],
    };
    local.pushIntents = [
      {
        id: 'install-generated-dependent-without-dependency',
        kind: 'plugin-install',
        requireAtomic: true,
        resources: [
          `file:${pluginMainFile(atomicDependentPlugin)}`,
          `plugin:${atomicDependentPlugin}`,
        ],
        dependencies: { plugins: [atomicDependencyPlugin] },
      },
    ];
    tags.add('atomic-blocked');
    tags.add('atomic-plugin-install-stack-v1');
    tags.add('atomic-plugin-stack-missing-dependency-v1');
    tags.add('atomic-plugin-install-stack-v2');
    tags.add('atomic-plugin-stack-missing-dependency-v2');
    tags.add('atomic-plugin-install-stack-v3');
    tags.add('atomic-plugin-stack-missing-dependency-v3');
  },
  'plugin-file-update': ({ local, allocator, tags }) => {
    local.files['wp-content/plugins/forms/forms.php'] = `<?php /* local forms ${allocator.next()} */`;
    tags.add('plugin-context-ready');
  },
  'plugin-context-metadata-drift': ({ local, remote, allocator, tags }) => {
    local.files['wp-content/plugins/forms/forms.php'] = `<?php /* local forms ${allocator.next()} */`;
    remote.plugins.forms.version = `1.${allocator.next()}.0`;
    tags.add('plugin-context-drift');
  },
  'remote-delete-local-unchanged': ({ remote, allocator, tags }) => {
    delete remote.files[allocator.existingUploadPath()];
    deleteRow(remote, 'wp_posts', 'ID:2');
    tags.add('remote-preserve');
    tags.add('remote-delete');
  },
  'local-create': ({ local, allocator, tags }) => {
    const postId = allocator.graphId();
    setRow(local, 'wp_posts', `ID:${postId}`, makePost(postId, `Generated post ${postId}`));
    local.files[allocator.filePath('create')] = `created ${allocator.next()}`;
    tags.add('local-create');
  },
  'delete-edit-conflict': ({ base, local, remote, allocator, tags }) => {
    const postId = allocator.graphId();
    const rowId = `ID:${postId}`;
    const row = makePost(postId, `Base delete/edit ${postId}`);
    setRow(base, 'wp_posts', rowId, row);
    setRow(local, 'wp_posts', rowId, row);
    setRow(remote, 'wp_posts', rowId, row);
    deleteRow(local, 'wp_posts', rowId);
    remote.db.wp_posts[rowId].post_title = `Remote edit while local deletes ${allocator.next()}`;
    tags.add('expected-conflict');
    tags.add('delete-edit');
  },
  'file-create-update-delete-mix-ready': ({ local, remote, allocator, tags }) => {
    addFileCreateUpdateDeleteMix(local, remote, allocator, tags, {
      conflict: false,
      prefix: 'ready-file-mix',
    });
    tags.add('ready-candidate');
  },
  'file-create-update-delete-mix-conflict': ({ local, remote, allocator, tags }) => {
    addFileCreateUpdateDeleteMix(local, remote, allocator, tags, {
      conflict: true,
      prefix: 'conflict-file-mix',
    });
    tags.add('expected-conflict');
  },
  'file-type-swap-ready': ({ base, local, remote, allocator, tags }) => {
    addFileTypeSwap(base, local, remote, allocator, tags, {
      conflict: false,
      prefix: 'ready-type-swap',
    });
    tags.add('ready-candidate');
  },
  'file-type-swap-conflict': ({ base, local, remote, allocator, tags }) => {
    addFileTypeSwap(base, local, remote, allocator, tags, {
      conflict: true,
      prefix: 'conflict-type-swap',
    });
    tags.add('expected-conflict');
  },
  'row-create-update-delete-mix-ready': ({ base, local, remote, allocator, tags }) => {
    addRowCreateUpdateDeleteMix(base, local, remote, allocator, tags, {
      conflict: false,
      prefix: 'ready-row-mix',
    });
    tags.add('ready-candidate');
  },
  'row-create-update-delete-mix-conflict': ({ base, local, remote, allocator, tags }) => {
    addRowCreateUpdateDeleteMix(base, local, remote, allocator, tags, {
      conflict: true,
      prefix: 'conflict-row-mix',
    });
    tags.add('expected-conflict');
  },
  'wp-options-scalar-ready': ({ tier, base, local, remote, allocator, tags }) => {
    addWpOptionsScalarChange(base, local, remote, allocator, tags, { conflict: false, tier });
    tags.add('ready-candidate');
  },
  'wp-options-scalar-conflict': ({ tier, base, local, remote, allocator, tags }) => {
    addWpOptionsScalarChange(base, local, remote, allocator, tags, { conflict: true, tier });
    tags.add('expected-conflict');
  },
  'wp-options-serialized-ready': ({ tier, base, local, remote, allocator, tags }) => {
    addWpOptionsSerializedChange(base, local, remote, allocator, tags, { conflict: false, tier });
    tags.add('ready-candidate');
  },
  'wp-options-serialized-conflict': ({ tier, base, local, remote, allocator, tags }) => {
    addWpOptionsSerializedChange(base, local, remote, allocator, tags, { conflict: true, tier });
    tags.add('expected-conflict');
  },
  'wp-posts-create-update-delete-ready': ({ base, local, remote, allocator, tags }) => {
    addWpPostsCreateUpdateDelete(base, local, remote, allocator, tags, {
      conflict: false,
      prefix: 'ready-wp-posts',
    });
    tags.add('ready-candidate');
  },
  'wp-posts-create-update-delete-conflict': ({ base, local, remote, allocator, tags }) => {
    addWpPostsCreateUpdateDelete(base, local, remote, allocator, tags, {
      conflict: true,
      prefix: 'conflict-wp-posts',
    });
    tags.add('expected-conflict');
  },
  'wp-postmeta-create-update-delete-ready': ({ base, local, remote, allocator, tags }) => {
    addWpPostmetaCreateUpdateDelete(base, local, remote, allocator, tags, {
      conflict: false,
      prefix: 'ready-wp-postmeta',
    });
    tags.add('ready-candidate');
  },
  'wp-postmeta-create-update-delete-conflict': ({ base, local, remote, allocator, tags }) => {
    addWpPostmetaCreateUpdateDelete(base, local, remote, allocator, tags, {
      conflict: true,
      prefix: 'conflict-wp-postmeta',
    });
    tags.add('expected-conflict');
  },
  'wp-comments-commentmeta-graph-ready': ({ local, allocator, tags }) => {
    addWpCommentsCommentmetaGraph(local, null, allocator, tags, { staleTarget: false });
    tags.add('ready-candidate');
  },
  'wp-comments-commentmeta-graph-stale': ({ base, local, remote, allocator, tags }) => {
    addWpCommentsCommentmetaGraph(local, remote, allocator, tags, { staleTarget: true, base });
    tags.add('expected-blocked');
  },
  'wp-terms-termmeta-graph-ready': ({ local, allocator, tags }) => {
    addWpTermsTermmetaGraph(local, null, allocator, tags, { staleTarget: false });
    tags.add('ready-candidate');
  },
  'wp-terms-termmeta-graph-stale': ({ base, local, remote, allocator, tags }) => {
    addWpTermsTermmetaGraph(local, remote, allocator, tags, { staleTarget: true, base });
    tags.add('expected-blocked');
  },
  'wp-users-usermeta-graph-ready': ({ local, allocator, tags }) => {
    addWpUsersUsermetaGraph(local, null, allocator, tags, { staleTarget: false });
    tags.add('ready-candidate');
  },
  'wp-users-usermeta-graph-stale': ({ base, local, remote, allocator, tags }) => {
    addWpUsersUsermetaGraph(local, remote, allocator, tags, { staleTarget: true, base });
    tags.add('expected-blocked');
  },
  'wp-term-taxonomy-graph-ready': ({ local, allocator, tags }) => {
    addWpTermTaxonomyGraph(local, null, allocator, tags, { staleTarget: false });
    tags.add('ready-candidate');
  },
  'wp-term-taxonomy-graph-stale': ({ base, local, remote, allocator, tags }) => {
    addWpTermTaxonomyGraph(local, remote, allocator, tags, { staleTarget: true, base });
    tags.add('expected-blocked');
  },
  'plugin-owned-option-change-ready': ({ base, local, remote, allocator, tags }) => {
    addPluginOwnedOptionChange(base, local, remote, allocator, tags, {
      conflict: false,
      prefix: 'ready-plugin-owned-option',
    });
    tags.add('ready-candidate');
  },
  'plugin-owned-option-change-conflict': ({ base, local, remote, allocator, tags }) => {
    addPluginOwnedOptionChange(base, local, remote, allocator, tags, {
      conflict: true,
      prefix: 'conflict-plugin-owned-option',
    });
    tags.add('expected-conflict');
  },
  'same-plan-user-meta-graph': ({ local, allocator, tags }) => {
    const userId = allocator.graphId();
    const metaId = allocator.graphId();
    setRow(local, 'wp_users', `ID:${userId}`, makeUser(userId));
    setRow(local, 'wp_usermeta', `umeta_id:${metaId}`, {
      umeta_id: metaId,
      user_id: userId,
      meta_key: '_generated_user_marker',
      meta_value: `user-marker-${metaId}`,
    });
    tags.add('same-plan-graph');
    tags.add('user-meta-graph');
  },
  'comment-user-graph-ready': ({ local, allocator, tags }) => {
    addCommentUserGraph(null, local, null, allocator, tags, { staleTarget: false });
    tags.add('ready-candidate');
  },
  'comment-user-graph-stale': ({ base, local, remote, allocator, tags }) => {
    addCommentUserGraph(base, local, remote, allocator, tags, { staleTarget: true });
    tags.add('expected-blocked');
  },
  'featured-image-attachment-ready': ({ local, allocator, tags }) => {
    addFeaturedImageAttachmentGraph(null, local, null, allocator, tags, { staleTarget: false });
    tags.add('ready-candidate');
  },
  'featured-image-attachment-stale': ({ base, local, remote, allocator, tags }) => {
    addFeaturedImageAttachmentGraph(base, local, remote, allocator, tags, { staleTarget: true });
    tags.add('expected-blocked');
  },
};

function buildBaseSite(index, tier) {
  const files = {
    'index.php': '<?php echo "base";',
    'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    'wp-content/uploads/shared-1.txt': 'base shared 1',
    'wp-content/uploads/shared-2.txt': 'base shared 2',
  };
  for (let i = 0; i < Math.max(1, Math.floor(tier / 2)); i++) {
    files[`wp-content/uploads/base-${index}-${i}.txt`] = `base file ${index}:${i}`;
  }

  const posts = {};
  const postCount = 3 + tier;
  for (let id = 1; id <= postCount; id++) {
    posts[`ID:${id}`] = makePost(id, `Base post ${id}`);
  }

  return {
    files,
    plugins: {
      forms: { version: '1.0.0', active: true },
      'reprint-push-forms-fixture': { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': { option_name: 'blogname', option_value: 'Generated Base Site' },
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'base', index },
          __pluginOwner: 'forms',
        },
      },
      wp_users: {
        'ID:1': makeUser(1),
      },
      wp_posts: posts,
      wp_postmeta: {},
      wp_comments: {},
      wp_commentmeta: {},
      wp_terms: {},
      wp_term_taxonomy: {},
      wp_term_relationships: {},
      wp_termmeta: {},
      wp_usermeta: {},
      wp_reprint_push_forms_lab: {},
    },
    meta: {
      pluginOwnedResources: {
        allowedResources: [
          allowedPluginOwnedResource(
            rowKey('wp_options', 'option_name:forms_settings'),
            'forms',
            'wp-option',
          ),
        ],
      },
    },
  };
}

function addGeneratedComplexity({
  family,
  tier,
  rng,
  base,
  local,
  remote,
  allocator,
  tags,
}) {
  if (skipSeededComplexityFamilies.has(family)) {
    return;
  }

  const operationCount = Math.max(0, tier * 2 + randomInt(rng, 0, tier + 2));
  const preserveReady = readyPreservingFamilies.has(family);
  for (let i = 0; i < operationCount; i++) {
    if (preserveReady) {
      addReadyPreservingComplexityOperation({ tier, rng, base, local, remote, allocator, tags, index: i });
      continue;
    }
    const choice = randomInt(rng, 0, tier >= 7 ? 12 : 9);
    if (choice === 0) {
      const path = allocator.filePath(`bulk-${i}`);
      base.files[path] = `base bulk ${i}`;
      local.files[path] = `local bulk ${i}-${allocator.next()}`;
      remote.files[path] = base.files[path];
      tags.add('bulk-local-update');
    } else if (choice === 1) {
      const postId = allocator.postId();
      ensurePostExists(base, postId);
      ensurePostExists(local, postId);
      ensurePostExists(remote, postId);
      remote.db.wp_posts[`ID:${postId}`].post_title = `Remote bulk ${allocator.next()}`;
      tags.add('bulk-remote-preserve');
    } else if (choice === 2) {
      const postId = allocator.postId();
      ensurePostExists(base, postId);
      ensurePostExists(local, postId);
      ensurePostExists(remote, postId);
      local.db.wp_posts[`ID:${postId}`].post_title = `Local bulk conflict ${allocator.next()}`;
      remote.db.wp_posts[`ID:${postId}`].post_title = `Remote bulk conflict ${allocator.next()}`;
      tags.add('expected-conflict');
    } else if (choice === 3) {
      const optionName = `forms_bulk_${allocator.next()}`;
      const resourceKey = rowKey('wp_options', `option_name:${optionName}`);
      const row = {
        option_name: optionName,
        option_value: { mode: 'base' },
        __pluginOwner: 'forms',
      };
      setRow(base, 'wp_options', `option_name:${optionName}`, row);
      setRow(local, 'wp_options', `option_name:${optionName}`, {
        ...row,
        option_value: { mode: 'local', bulk: i },
      });
      setRow(remote, 'wp_options', `option_name:${optionName}`, row);
      allowPluginOwned(local, resourceKey, 'forms', 'wp-option');
      tags.add('plugin-owned-supported');
    } else if (choice === 4) {
      const postId = allocator.graphId();
      const metaId = allocator.graphId();
      setRow(local, 'wp_posts', `ID:${postId}`, makePost(postId, `Bulk graph post ${postId}`));
      setRow(local, 'wp_postmeta', `post_id:${postId}:meta_key:_bulk_graph_${metaId}`, {
        post_id: postId,
        meta_key: `_bulk_graph_${metaId}`,
        meta_value: `bulk-graph-${metaId}`,
      });
      tags.add('same-plan-graph');
    } else if (choice === 5 && tier >= 4) {
      const remotePostId = allocator.graphId();
      setRow(remote, 'wp_posts', `ID:${remotePostId}`, makePost(remotePostId, `Remote bulk graph ${remotePostId}`));
      setRow(local, 'wp_postmeta', `post_id:${remotePostId}:meta_key:_bulk_stale_graph`, {
        post_id: remotePostId,
        meta_key: '_bulk_stale_graph',
        meta_value: `stale-${remotePostId}`,
      });
      tags.add('stale-graph');
    } else if (choice === 6 && tier >= 5) {
      const directory = `wp-content/uploads/bulk-topology-${allocator.next()}`;
      base.files[directory] = { type: 'directory' };
      local.files[directory] = { type: 'file', content: `local type swap ${i}` };
      remote.files[directory] = { type: 'directory' };
      remote.files[`${directory}/remote-only.txt`] = `remote only ${i}`;
      tags.add('file-topology');
    } else if (choice === 7 && tier >= 6) {
      const optionName = `unsafe_bulk_${allocator.next()}`;
      setRow(local, 'wp_options', `option_name:${optionName}`, {
        option_name: optionName,
        option_value: { mode: 'unsafe-bulk' },
        __pluginOwner: 'unsafe-bulk-owner',
      });
      tags.add('plugin-owned-unsupported');
    } else if (choice === 8 && tier >= 7) {
      addCommentGraph(local, allocator);
      tags.add('same-plan-graph');
      tags.add('comment-graph');
      tags.add('comment-parent-graph');
    } else if (choice === 9 && tier >= 8) {
      addTaxonomyGraph(local, allocator);
      tags.add('same-plan-graph');
      tags.add('taxonomy-graph');
    } else if (choice === 10 && tier >= 8) {
      const postId = allocator.postId();
      ensurePostExists(base, postId);
      ensurePostExists(local, postId);
      ensurePostExists(remote, postId);
      deleteRow(local, 'wp_posts', `ID:${postId}`);
      tags.add('delete');
    } else if (choice === 11 && tier >= 9) {
      const id = allocator.formsLabId();
      const rowId = `id:${id}`;
      const row = {
        id,
        payload: { mode: 'base', generated: i },
        __pluginOwner: 'forms',
      };
      setRow(base, 'wp_reprint_push_forms_lab', rowId, row);
      setRow(local, 'wp_reprint_push_forms_lab', rowId, {
        ...row,
        payload: { mode: 'local', generated: i },
      });
      setRow(remote, 'wp_reprint_push_forms_lab', rowId, row);
      allowPluginOwned(local, rowKey('wp_reprint_push_forms_lab', rowId), 'forms', 'fixture-forms-lab-table', {
        table: 'wp_reprint_push_forms_lab',
      });
      tags.add('forms-lab-supported');
    }
  }
}

function addReadyPreservingComplexityOperation({
  tier,
  rng,
  base,
  local,
  remote,
  allocator,
  tags,
  index,
}) {
  const choice = randomInt(rng, 0, tier >= 8 ? 8 : 6);
  if (choice === 0) {
    const path = allocator.filePath(`ready-bulk-${index}`);
    base.files[path] = `base ready bulk ${index}`;
    local.files[path] = `local ready bulk ${index}-${allocator.next()}`;
    remote.files[path] = base.files[path];
    tags.add('bulk-local-update');
    return;
  }
  if (choice === 1) {
    const postId = allocator.graphId();
    const rowId = `ID:${postId}`;
    const row = makePost(postId, `Ready remote preserve base ${postId}`);
    setRow(base, 'wp_posts', rowId, row);
    setRow(local, 'wp_posts', rowId, row);
    setRow(remote, 'wp_posts', rowId, row);
    remote.db.wp_posts[`ID:${postId}`].post_title = `Remote ready preserve ${allocator.next()}`;
    tags.add('bulk-remote-preserve');
    return;
  }
  if (choice === 2) {
    const optionName = `forms_ready_bulk_${allocator.next()}`;
    const resourceKey = rowKey('wp_options', `option_name:${optionName}`);
    const row = {
      option_name: optionName,
      option_value: { mode: 'base', ready: true },
      __pluginOwner: 'forms',
    };
    setRow(base, 'wp_options', `option_name:${optionName}`, row);
    setRow(local, 'wp_options', `option_name:${optionName}`, {
      ...row,
      option_value: { mode: 'local-ready', index },
    });
    setRow(remote, 'wp_options', `option_name:${optionName}`, row);
    allowPluginOwned(local, resourceKey, 'forms', 'wp-option');
    tags.add('plugin-owned-supported');
    return;
  }
  if (choice === 3) {
    const postId = allocator.graphId();
    const metaId = allocator.graphId();
    setRow(local, 'wp_posts', `ID:${postId}`, makePost(postId, `Ready graph post ${postId}`));
    setRow(local, 'wp_postmeta', `post_id:${postId}:meta_key:_ready_graph_${metaId}`, {
      post_id: postId,
      meta_key: `_ready_graph_${metaId}`,
      meta_value: `ready-graph-${metaId}`,
    });
    tags.add('same-plan-graph');
    return;
  }
  if (choice === 4) {
    addCommentGraph(local, allocator);
    tags.add('same-plan-graph');
    tags.add('comment-graph');
    tags.add('comment-parent-graph');
    return;
  }
  if (choice === 5) {
    addTaxonomyGraph(local, allocator);
    tags.add('same-plan-graph');
    tags.add('taxonomy-graph');
    return;
  }
  if (choice === 6) {
    const path = allocator.filePath(`ready-create-${index}`);
    local.files[path] = `ready create ${index}-${allocator.next()}`;
    tags.add('local-create');
    return;
  }
  const postId = allocator.graphId();
  const rowId = `ID:${postId}`;
  const row = makePost(postId, `Ready same content base ${postId}`);
  setRow(base, 'wp_posts', rowId, row);
  setRow(local, 'wp_posts', rowId, row);
  setRow(remote, 'wp_posts', rowId, row);
  const title = `Ready same content ${allocator.next()}`;
  local.db.wp_posts[`ID:${postId}`].post_title = title;
  remote.db.wp_posts[`ID:${postId}`].post_title = title;
  tags.add('already-in-sync');
}

function assertGeneratedOwnerBindingRedacted(testCase, evidence) {
  const serialized = JSON.stringify(evidence);
  for (const token of testCase.secretTokens) {
    assert.equal(
      serialized.includes(token),
      false,
      `${testCase.id} leaked generated owner identity token ${token}`,
    );
  }
}

function driverDryRunValidationMutationSummary(mutation) {
  return {
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    pluginOwner: mutation.pluginOwnedResource?.pluginOwner,
    driver: mutation.pluginOwnedResource?.driver,
    dryRunValidationEvidence: mutation.pluginOwnedResource?.dryRunValidationEvidence || null,
    change: {
      localChange: mutation.change.localChange,
      remoteChange: mutation.change.remoteChange,
      baseHash: mutation.change.base.hash,
      localHash: mutation.change.local.hash,
      remoteHash: mutation.change.remote.hash,
    },
  };
}

function driverDryRunValidationBlockerSummary(blocker) {
  return {
    class: blocker.class,
    resourceKey: blocker.resourceKey,
    pluginOwner: blocker.pluginOwner,
    driver: blocker.driver || null,
    policySource: blocker.policySource || null,
    dryRunValidationEvidence: blocker.dryRunValidationEvidence || null,
    localChange: blocker.change.localChange,
    remoteChange: blocker.change.remoteChange,
    baseHash: blocker.change.base.hash,
    localHash: blocker.change.local.hash,
    remoteHash: blocker.change.remote.hash,
  };
}

function assertDriverDryRunValidationChangeHashEvidence(change) {
  assert.ok(change);
  for (const side of ['base', 'local', 'remote']) {
    assert.ok(['present', 'absent'].includes(change[side].state));
    assert.match(change[side].hash, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(change[side], 'value'), false);
  }
}

function assertDriverDryRunValidationRedacted(testCase, evidence) {
  const json = JSON.stringify(evidence);
  for (const token of testCase.secretTokens) {
    assert.equal(json.includes(token), false, `${testCase.id} leaked ${token}`);
  }
}

function driverDeleteSupportMutationSummary(mutation) {
  return {
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    pluginOwner: mutation.pluginOwnedResource?.pluginOwner,
    driver: mutation.pluginOwnedResource?.driver,
    supportsDelete: mutation.pluginOwnedResource?.supportsDelete === true,
    auditEvidenceHash: mutation.pluginOwnedResource?.auditEvidence
      ? digest(mutation.pluginOwnedResource.auditEvidence)
      : null,
    change: {
      localChange: mutation.change.localChange,
      remoteChange: mutation.change.remoteChange,
      baseHash: mutation.change.base.hash,
      localHash: mutation.change.local.hash,
      remoteHash: mutation.change.remote.hash,
    },
  };
}

function driverDeleteSupportBlockerSummary(blocker) {
  return {
    class: blocker.class,
    resourceKey: blocker.resourceKey,
    pluginOwner: blocker.pluginOwner,
    driver: blocker.driver || null,
    policySource: blocker.policySource || null,
    localChange: blocker.change.localChange,
    remoteChange: blocker.change.remoteChange,
    baseHash: blocker.change.base.hash,
    localHash: blocker.change.local.hash,
    remoteHash: blocker.change.remote.hash,
  };
}

function driverDeleteSupportForgedUnsupportedPlan(plan, mutationId) {
  const forged = deepClone(plan);
  const mutation = forged.mutations.find((entry) => entry.id === mutationId);
  mutation.pluginOwnedResource.supportsDelete = false;
  mutation.pluginOwnedResource.auditEvidence = {
    ...mutation.pluginOwnedResource.auditEvidence,
    supportsDelete: false,
  };
  return forged;
}

function assertDriverDeleteSupportAuditEvidence(evidence, supportsDelete) {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.evidenceSource, 'planner-plugin-driver-audit');
  assert.equal(evidence.format, 'hash-only');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'wp-option');
  assert.equal(evidence.supportsDelete, supportsDelete);
  for (const key of ['baseHash', 'localHash', 'remoteHash', 'ownerContextHash']) {
    assert.match(evidence[key], /^[a-f0-9]{64}$/);
  }
}

function assertDriverDeleteSupportChangeHashEvidence(change) {
  assert.ok(change);
  for (const side of ['base', 'local', 'remote']) {
    assert.ok(['present', 'absent'].includes(change[side].state));
    assert.match(change[side].hash, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(change[side], 'value'), false);
  }
}

function assertDriverDeleteSupportRedacted(testCase, evidence) {
  const json = JSON.stringify(evidence);
  for (const token of testCase.secretTokens) {
    assert.equal(json.includes(token), false, `${testCase.id} leaked ${token}`);
  }
}

function activePluginsOptionRow(optionValue) {
  return {
    option_name: 'active_plugins',
    option_value: [...optionValue],
    autoload: 'yes',
  };
}

function directActivePluginsResource() {
  return {
    type: 'row',
    table: 'wp_options',
    id: 'option_name:active_plugins',
    key: rowKey('wp_options', 'option_name:active_plugins'),
  };
}

function directActivePluginsForgedReadyPlan(testCase) {
  const resource = directActivePluginsResource();
  const baseValue = getResource(testCase.base, resource);
  const localValue = getResource(testCase.local, resource);
  const remoteValue = getResource(testCase.remote, resource);
  const baseHash = resourceHash(testCase.base, resource);
  const localHash = resourceHash(testCase.local, resource);
  const remoteHash = resourceHash(testCase.remote, resource);
  const mutationId = 'mutation-rpp-0472-forged-active-plugins';

  return {
    schemaVersion: 1,
    id: `plan-${fixedNow.toISOString()}-rpp-0472-forged-active-plugins`,
    generatedAt: fixedNow.toISOString(),
    status: 'ready',
    summary: {
      mutations: 1,
      decisions: 0,
      conflicts: 0,
      blockers: 0,
      atomicGroups: 0,
    },
    mutations: [
      {
        id: mutationId,
        resource,
        resourceKey: resource.key,
        action: 'put',
        value: serializeResourceValue(localValue),
        remoteBeforeHash: remoteHash,
        baseHash,
        localHash,
        changeKind: 'update',
        change: directActivePluginsChangeEvidence({
          baseValue,
          localValue,
          remoteValue,
          baseHash,
          localHash,
          remoteHash,
        }),
        atomicGroupId: null,
      },
    ],
    preconditions: [
      {
        mutationId,
        resource,
        resourceKey: resource.key,
        expectedHash: remoteHash,
        checkedAgainst: 'live-remote',
      },
    ],
    decisions: [],
    conflicts: [],
    blockers: [],
    atomicGroups: [],
  };
}

function directActivePluginsChangeEvidence({
  baseValue,
  localValue,
  remoteValue,
  baseHash,
  localHash,
  remoteHash,
}) {
  return {
    localChange: changeKindFromHashes(baseValue, localValue, baseHash, localHash),
    remoteChange: changeKindFromHashes(baseValue, remoteValue, baseHash, remoteHash),
    base: directActivePluginsChangeSide(baseValue, baseHash),
    local: directActivePluginsChangeSide(localValue, localHash),
    remote: directActivePluginsChangeSide(remoteValue, remoteHash),
  };
}

function changeKindFromHashes(baseValue, candidateValue, baseHash, candidateHash) {
  if (candidateHash === baseHash) {
    return 'unchanged';
  }
  if (baseValue === ABSENT) {
    return 'create';
  }
  if (candidateValue === ABSENT) {
    return 'delete';
  }
  return 'update';
}

function directActivePluginsChangeSide(value, hash) {
  return {
    state: value === ABSENT ? 'absent' : 'present',
    hash,
  };
}

function directActivePluginsMutationSummary(mutation) {
  return {
    resourceKey: mutation.resourceKey,
    action: mutation.action,
    pluginOwner: mutation.pluginOwnedResource?.pluginOwner || null,
    driver: mutation.pluginOwnedResource?.driver || null,
    change: mutation.change
      ? {
          localChange: mutation.change.localChange,
          remoteChange: mutation.change.remoteChange,
          baseHash: mutation.change.base.hash,
          localHash: mutation.change.local.hash,
          remoteHash: mutation.change.remote.hash,
        }
      : null,
  };
}

function directActivePluginsBlockerSummary(blocker) {
  return {
    class: blocker.class,
    reasonCode: blocker.reasonCode,
    requiredDriver: blocker.requiredDriver,
    resourceKey: blocker.resourceKey,
    resolutionPolicy: blocker.resolutionPolicy,
    localChange: blocker.change.localChange,
    remoteChange: blocker.change.remoteChange,
    baseHash: blocker.change.base.hash,
    localHash: blocker.change.local.hash,
    remoteHash: blocker.change.remote.hash,
  };
}

function assertDirectActivePluginsBlocker(testCase, blocker) {
  assert.equal(blocker.class, 'unsupported-active-plugins-direct-mutation');
  assert.equal(blocker.reasonCode, 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED');
  assert.equal(blocker.requiredDriver, 'plugin-activation-driver');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-active-plugins-and-stop');
  assert.equal(blocker.resourceKey, testCase.activePluginsResourceKey);
  assert.equal(blocker.change.localChange, 'update');
  assert.equal(blocker.change.remoteChange, 'unchanged');
  assertDirectActivePluginsChangeHashEvidence(blocker.change);
}

function assertDirectActivePluginsChangeHashEvidence(change) {
  assert.ok(change);
  for (const side of ['base', 'local', 'remote']) {
    assert.ok(['present', 'absent'].includes(change[side].state));
    assert.match(change[side].hash, /^[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(change[side], 'value'), false);
  }
}

function assertDirectActivePluginsRedacted(testCase, evidence) {
  const json = JSON.stringify(evidence);
  for (const token of testCase.secretTokens) {
    assert.equal(json.includes(token), false, `${testCase.id} leaked ${token}`);
  }
}

function assertPlanContract(testCase, plan) {
  assert.equal(plan.summary.mutations, plan.mutations.length, `${testCase.id} mutation summary mismatch`);
  assert.equal(plan.summary.decisions, plan.decisions.length, `${testCase.id} decision summary mismatch`);
  assert.equal(plan.summary.conflicts, plan.conflicts.length, `${testCase.id} conflict summary mismatch`);
  assert.equal(plan.summary.blockers, plan.blockers.length, `${testCase.id} blocker summary mismatch`);
  assert.equal(plan.summary.atomicGroups, plan.atomicGroups.length, `${testCase.id} atomic summary mismatch`);
  assertMutationPreconditionOneToOne(testCase, plan);
  assert.equal(
    plan.status,
    plan.conflicts.length > 0 ? 'conflict' : plan.blockers.length > 0 ? 'blocked' : 'ready',
    `${testCase.id} status does not match conflicts/blockers`,
  );

  assertUniqueIds(testCase.id, 'mutation', plan.mutations.map((entry) => entry.id));
  assertUniqueIds(testCase.id, 'precondition', plan.preconditions.map((entry) => entry.mutationId));
  assertUniqueIds(testCase.id, 'decision', plan.decisions.map((entry) => entry.id));
  assertUniqueIds(testCase.id, 'conflict', plan.conflicts.map((entry) => entry.id));
  assertUniqueIds(testCase.id, 'blocker', plan.blockers.map((entry) => entry.id));

  for (const mutation of plan.mutations) {
    const plannedValue = deserializeResourceValue(mutation.value);
    assert.equal(
      mutation.localHash,
      digest(plannedValue),
      `${testCase.id} localHash does not match planned local payload for ${mutation.resourceKey}`,
    );
    const precondition = plan.preconditions.find((entry) => entry.mutationId === mutation.id);
    assert.ok(precondition, `${testCase.id} missing precondition for ${mutation.id}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.equal(precondition.expectedHash, resourceHash(testCase.remote, mutation.resource));
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.match(mutation.localHash, /^[a-f0-9]{64}$/);
    assert.equal(
      mutation.localHash,
      digest(deserializeResourceValue(mutation.value)),
      `${testCase.id} localHash should match planned value for ${mutation.resourceKey}`,
    );
    if (mutation.pluginOwnedResource) {
      assert.ok(mutation.pluginOwnedResource.pluginOwner, `${testCase.id} plugin mutation missing owner`);
      assert.ok(mutation.pluginOwnedResource.driver, `${testCase.id} plugin mutation missing driver`);
    }
  }

  const mutationKeys = new Set(plan.mutations.map((mutation) => mutation.resourceKey));
  const mutationById = new Map(plan.mutations.map((mutation) => [mutation.id, mutation]));
  for (const conflict of plan.conflicts) {
    assert.equal(
      mutationKeys.has(conflict.resourceKey),
      false,
      `${testCase.id} has mutation for conflicted resource ${conflict.resourceKey}`,
    );
    assert.ok(conflict.resolutionPolicy?.startsWith('preserve-remote'), `${testCase.id} conflict lacks preserve policy`);
  }

  for (const blocker of plan.blockers) {
    if (blocker.resourceKey) {
      const matchingMutation = blocker.mutationId ? mutationById.get(blocker.mutationId) : null;
      if (blocker.class === 'atomic-group-blocker-propagation') {
        assert.ok(
          matchingMutation,
          `${testCase.id} propagation blocker should reference an emitted grouped mutation id ${blocker.mutationId}`,
        );
        assert.equal(
          matchingMutation.resourceKey,
          blocker.resourceKey,
          `${testCase.id} propagation blocker mutation id should match resource ${blocker.resourceKey}`,
        );
        assert.equal(
          mutationKeys.has(blocker.resourceKey),
          true,
          `${testCase.id} propagation blocker should reference an emitted grouped mutation ${blocker.resourceKey}`,
        );
        continue;
      }
      assert.equal(
        mutationKeys.has(blocker.resourceKey),
        false,
        `${testCase.id} has mutation for blocked resource ${blocker.resourceKey}`,
      );
    }
  }
}

function assertMutationPreconditionOneToOne(testCase, plan) {
  assert.equal(
    plan.preconditions.length,
    plan.mutations.length,
    `${testCase.id} precondition count must match mutation count`,
  );
  const mutationById = new Map();
  for (const mutation of plan.mutations) {
    assert.equal(
      mutationById.has(mutation.id),
      false,
      `${testCase.id} duplicate mutation id ${mutation.id}`,
    );
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

function assertMergedResultPreservesRemoteUnlessPlanned(testCase, plan, resultSite, mutationKeys) {
  for (const resource of enumerateResources(testCase.base, testCase.local, testCase.remote, resultSite)) {
    const resultHash = resourceHash(resultSite, resource);
    if (mutationKeys.has(resource.key)) {
      assert.equal(
        resultHash,
        resourceHash(testCase.local, resource),
        `${testCase.id} did not apply planned local value for ${resource.key}`,
      );
    } else {
      assert.equal(
        resultHash,
        resourceHash(testCase.remote, resource),
        `${testCase.id} changed unplanned remote resource ${resource.key}`,
      );
    }
  }

  for (const mutation of plan.mutations) {
    const plannedValue = deserializeResourceValue(mutation.value);
    assert.equal(
      digest(plannedValue),
      resourceHash(resultSite, mutation.resource),
      `${testCase.id} planned mutation payload hash mismatch for ${mutation.resourceKey}`,
    );
  }
}

function assertReadyPlanRejectsStaleRemote(testCase, plan) {
  if (plan.mutations.length === 0) {
    return { rejected: false, code: null, remoteUnchanged: true };
  }
  const mutation = plan.mutations[0];
  const driftedRemote = deepClone(testCase.remote);
  setResource(driftedRemote, mutation.resource, staleValueFor(mutation.resource, getResource(driftedRemote, mutation.resource)));
  const before = digest(driftedRemote);
  const error = captureError(() => applyPlan(driftedRemote, plan));
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PRECONDITION_FAILED');
  assert.equal(digest(driftedRemote), before, `${testCase.id} stale apply changed remote state`);
  return { rejected: true, code: error.code, remoteUnchanged: true };
}

function recordSummary(summary, testCase, result) {
  increment(summary.tiers, testCase.tier);
  increment(summary.statuses, result.status);
  summary.statusByTier[result.status] ||= {};
  increment(summary.statusByTier[result.status], testCase.tier);
  increment(summary.featureFamilies, testCase.family);
  incrementStatus(summary.statusByFeatureFamily, testCase.family, result.status);
  for (const tag of testCase.tags) {
    increment(summary.featureFamilies, tag);
    incrementStatus(summary.statusByFeatureFamily, tag, result.status);
  }
  recordTargetCoverage(summary, testCase, result);
  summary.maxResourceCount = Math.max(summary.maxResourceCount, result.resourceCount);
  summary.maxMutationCount = Math.max(summary.maxMutationCount, result.mutations);
  if (result.status === 'ready') {
    summary.maxReadyResourceCount = Math.max(summary.maxReadyResourceCount, result.resourceCount);
    summary.maxReadyMutationCount = Math.max(summary.maxReadyMutationCount, result.mutations);
  }
  summary.maxComplexityScore = Math.max(summary.maxComplexityScore, testCase.complexityScore);
  summary.totalMutations += result.mutations;
  summary.totalConflicts += result.conflicts;
  summary.totalBlockers += result.blockers;
  summary.totalDecisions += result.decisions;
  summary.totalPreconditions += result.preconditions;
}

function emptySummary() {
  return {
    totalCases: 0,
    minCasesRequired: MIN_GENERATED_PUSH_CASES,
    statuses: {},
    statusByTier: {},
    statusByFeatureFamily: {},
    tiers: {},
    featureFamilies: {},
    targetCoverage: {},
    maxResourceCount: 0,
    maxMutationCount: 0,
    maxReadyResourceCount: 0,
    maxReadyMutationCount: 0,
    maxComplexityScore: 0,
    totalMutations: 0,
    totalConflicts: 0,
    totalBlockers: 0,
    totalDecisions: 0,
    totalPreconditions: 0,
  };
}

function recordTargetCoverage(summary, testCase, result) {
  for (const [target, definition] of Object.entries(targetCoverageDefinitions)) {
    const matchesTarget = typeof definition.matches === 'function'
      ? definition.matches(testCase, result)
      : testCase.family === definition.family || testCase.tags.has(definition.tag);
    if (!matchesTarget) {
      continue;
    }
    const coverage = summary.targetCoverage[target] ||= {
      family: definition.family,
      total: 0,
      perTier: {},
      statuses: {},
    };
    coverage.total += 1;
    increment(coverage.perTier, testCase.tier);
    increment(coverage.statuses, result.status);
  }
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

function installAtomicStack(local) {
  local.files[pluginMainFile(atomicDependencyPlugin)] = '<?php /* generated dependency */';
  local.files[pluginMainFile(atomicDependentPlugin)] = '<?php /* generated dependent */';
  local.plugins[atomicDependencyPlugin] = { version: '2.1.0', active: true };
  local.plugins[atomicDependentPlugin] = {
    version: '1.0.0',
    active: true,
    requires: [atomicDependencyPlugin],
  };
  local.db.wp_options['option_name:reprint_push_atomic_fixture_data'] = {
    option_name: 'reprint_push_atomic_fixture_data',
    option_value: {
      mode: 'generated-installed',
      privateInstallToken: 'private-atomic-plugin-install-stack-v3',
    },
    __pluginOwner: atomicDependentPlugin,
  };
  local.pushIntents = [
    {
      id: 'install-generated-atomic-fixture-stack',
      kind: 'plugin-install',
      requireAtomic: true,
      resources: [
        `file:${pluginMainFile(atomicDependencyPlugin)}`,
        `file:${pluginMainFile(atomicDependentPlugin)}`,
        `plugin:${atomicDependencyPlugin}`,
        `plugin:${atomicDependentPlugin}`,
        rowKey('wp_options', 'option_name:reprint_push_atomic_fixture_data'),
      ],
      dependencies: {
        plugins: [
          {
            name: atomicDependencyPlugin,
            version: '2.1.0',
            hash: resourceHash(local, pluginResource(atomicDependencyPlugin)),
          },
        ],
      },
      resourcePolicy: {
        pluginOwnedResources: {
          allowedResources: [
            allowedPluginOwnedResource(
              rowKey('wp_options', 'option_name:reprint_push_atomic_fixture_data'),
              atomicDependentPlugin,
              'wp-option',
            ),
          ],
        },
      },
    },
  ];
}

function addFileCreateUpdateDeleteMix(local, remote, allocator, tags, { conflict, prefix }) {
  const createPath = allocator.filePath(`${prefix}-create`);
  const updatePath = allocator.existingUploadPath();
  const deletePath = updatePath.endsWith('shared-1.txt')
    ? 'wp-content/uploads/shared-2.txt'
    : 'wp-content/uploads/shared-1.txt';
  const remoteOnlyPath = allocator.filePath(`${prefix}-remote-only`);

  local.files[createPath] = `generated file mix create ${allocator.next()}`;
  local.files[updatePath] = `generated file mix update ${allocator.next()}`;
  delete local.files[deletePath];
  if (remote) {
    remote.files[remoteOnlyPath] = `remote-only file mix preserve ${allocator.next()}`;
    tags.add('remote-preserve');
  }

  tags.add('file-create-update-delete-mix');
  tags.add('file-create-update-delete-mix-v3');
  tags.add('file-create-update-delete-mix-v4');
  tags.add('file-create');
  tags.add('file-update');
  tags.add('file-delete');

  if (conflict && remote) {
    remote.files[updatePath] = `remote concurrent file mix update ${allocator.next()}`;
    tags.add('file-create-update-delete-mix-v3-non-ready');
    tags.add('file-create-update-delete-mix-v4-non-ready');
  } else {
    tags.add('file-create-update-delete-mix-v3-ready');
    tags.add('file-create-update-delete-mix-v4-ready');
  }
}

function addFileTypeSwap(base, local, remote, allocator, tags, { conflict, prefix }) {
  const path = `wp-content/uploads/${prefix}-${allocator.next()}`;
  base.files[path] = { type: 'directory' };
  local.files[path] = { type: 'file', content: `local type swap ${allocator.next()}` };
  remote.files[path] = { type: 'directory' };

  tags.add('file-type-swap');
  tags.add('file-type-swap-conflict-v4');
  tags.add('file-topology');
  tags.add('type-change');

  if (conflict) {
    remote.files[`${path}/remote-descendant.txt`] = `remote descendant for type swap ${allocator.next()}`;
    tags.add('type-swap-conflict');
    tags.add('file-type-swap-conflict-v4-non-ready');
  } else {
    tags.add('type-swap-ready');
    tags.add('file-type-swap-conflict-v4-ready');
  }
}

function addRowCreateUpdateDeleteMix(base, local, remote, allocator, tags, { conflict, prefix }) {
  const createId = allocator.graphId();
  const updateId = allocator.graphId();
  const deleteId = allocator.graphId();
  const remoteOnlyId = allocator.graphId();
  const updateRowId = `ID:${updateId}`;
  const deleteRowId = `ID:${deleteId}`;
  const remoteOnlyRowId = `ID:${remoteOnlyId}`;
  const updateBase = makePost(updateId, `Base row mix update ${updateId}`);
  const deleteBase = makePost(deleteId, `Base row mix delete ${deleteId}`);

  setRow(base, 'wp_posts', updateRowId, updateBase);
  setRow(local, 'wp_posts', updateRowId, updateBase);
  setRow(remote, 'wp_posts', updateRowId, updateBase);
  setRow(base, 'wp_posts', deleteRowId, deleteBase);
  setRow(local, 'wp_posts', deleteRowId, deleteBase);
  setRow(remote, 'wp_posts', deleteRowId, deleteBase);

  setRow(local, 'wp_posts', `ID:${createId}`, makePost(createId, `Generated row mix create ${createId}`));
  setRow(local, 'wp_posts', updateRowId, {
    ...updateBase,
    post_title: `Generated row mix update ${prefix} ${allocator.next()}`,
  });
  deleteRow(local, 'wp_posts', deleteRowId);
  setRow(remote, 'wp_posts', remoteOnlyRowId, makePost(
    remoteOnlyId,
    `Remote-only row mix preserve ${remoteOnlyId}`,
  ));

  tags.add('row-create-update-delete-mix');
  tags.add('row-create-update-delete-mix-v3');
  tags.add('row-create-update-delete-mix-v4');
  tags.add('row-create');
  tags.add('row-update');
  tags.add('row-delete');
  tags.add('remote-preserve');

  if (conflict) {
    remote.db.wp_posts[updateRowId].post_title = `Remote concurrent row mix update ${allocator.next()}`;
    tags.add('row-create-update-delete-mix-v3-non-ready');
    tags.add('row-create-update-delete-mix-v4-non-ready');
  } else {
    tags.add('row-create-update-delete-mix-v3-ready');
    tags.add('row-create-update-delete-mix-v4-ready');
  }
}

function addWpOptionsScalarChange(base, local, remote, allocator, tags, { conflict, tier }) {
  const ordinal = allocator.next();
  const optionName = `scalar_generated_${ordinal}`;
  const rowId = `option_name:${optionName}`;
  const valueKind = tier % 2 === 0 ? 'string' : 'number';
  const baseValue = scalarOptionValue(valueKind, 'base', ordinal);
  const localValue = scalarOptionValue(valueKind, 'local', ordinal);
  const remoteValue = scalarOptionValue(valueKind, 'remote', ordinal);
  const row = {
    option_name: optionName,
    option_value: baseValue,
    autoload: 'no',
  };

  setRow(base, 'wp_options', rowId, row);
  setRow(local, 'wp_options', rowId, { ...row, option_value: localValue });
  setRow(remote, 'wp_options', rowId, row);

  tags.add('wp-options-scalar');
  tags.add('scalar-option-update');
  tags.add(`scalar-option-${valueKind}`);
  tags.add('wp-options-scalar-v3');
  tags.add(conflict ? 'wp-options-scalar-v3-non-ready' : 'wp-options-scalar-v3-ready');
  tags.add('wp-options-scalar-v4');
  tags.add(conflict ? 'wp-options-scalar-v4-non-ready' : 'wp-options-scalar-v4-ready');

  if (conflict) {
    setRow(remote, 'wp_options', rowId, { ...row, option_value: remoteValue });
  }
}

function scalarOptionValue(kind, source, ordinal) {
  if (kind === 'number') {
    const offsets = { base: 0, local: 1000, remote: 2000 };
    return ordinal + offsets[source];
  }
  return `${source}-scalar-option-${ordinal}`;
}

function addWpOptionsSerializedChange(base, local, remote, allocator, tags, { conflict, tier }) {
  const optionOrdinal = allocator.next();
  const optionName = `generated_serialized_${optionOrdinal}`;
  const rowId = `option_name:${optionName}`;
  const valueKind = tier % 2 === 0 ? 'object' : 'array';
  const prefix = conflict ? 'conflict-wp-options-serialized' : 'ready-wp-options-serialized';
  const baseRow = {
    option_name: optionName,
    option_value: phpSerializeStringMap({
      shape: valueKind,
      mode: 'base',
      public_label: `${prefix}-base-${optionOrdinal}`,
      private_notes: `base-private-serialized-${allocator.next()}`,
      auth_token: `base-token-${allocator.next()}`,
    }),
    autoload: 'no',
  };

  setRow(base, 'wp_options', rowId, baseRow);
  setRow(remote, 'wp_options', rowId, baseRow);
  setRow(local, 'wp_options', rowId, {
    ...baseRow,
    option_value: phpSerializeStringMap({
      shape: valueKind,
      mode: 'local',
      public_label: `${prefix}-local-${optionOrdinal}`,
      private_notes: `local-private-serialized-${allocator.next()}`,
      auth_token: `local-token-${allocator.next()}`,
    }),
  });

  tags.add('wp-options-serialized-change');
  tags.add('wp-options-serialized');
  tags.add('wp-options-update');
  tags.add('serialized-option');
  tags.add('serialized-option-update');
  tags.add(`serialized-option-${valueKind}`);
  tags.add('wp-options-serialized-v3');
  tags.add(conflict ? 'wp-options-serialized-v3-non-ready' : 'wp-options-serialized-v3-ready');
  tags.add('wp-options-serialized-v4');
  tags.add(conflict ? 'wp-options-serialized-v4-non-ready' : 'wp-options-serialized-v4-ready');

  if (conflict) {
    setRow(remote, 'wp_options', rowId, {
      ...baseRow,
      option_value: phpSerializeStringMap({
        shape: valueKind,
        mode: 'remote',
        public_label: `${prefix}-remote-${optionOrdinal}`,
        private_notes: `remote-private-serialized-${allocator.next()}`,
        auth_token: `remote-token-${allocator.next()}`,
      }),
    });
  }
}

function phpSerializeStringMap(entries) {
  const fields = Object.entries(entries);
  return `a:${fields.length}:{${
    fields
      .map(([key, value]) => {
        const stringValue = String(value);
        return `s:${key.length}:"${key}";s:${stringValue.length}:"${stringValue}";`;
      })
      .join('')
  }}`;
}

function addWpPostsCreateUpdateDelete(base, local, remote, allocator, tags, { conflict, prefix }) {
  const createId = allocator.graphId();
  const updateId = allocator.graphId();
  const deleteId = allocator.graphId();
  const updateRowId = `ID:${updateId}`;
  const deleteRowId = `ID:${deleteId}`;
  const updateBase = makePost(updateId, `Base wp_posts update ${updateId}`, {
    post_content: `base update content ${updateId}`,
    post_type: 'page',
  });
  const deleteBase = makePost(deleteId, `Base wp_posts delete ${deleteId}`, {
    post_content: `base delete content ${deleteId}`,
    post_type: 'post',
  });

  setRow(base, 'wp_posts', updateRowId, updateBase);
  setRow(local, 'wp_posts', updateRowId, updateBase);
  setRow(remote, 'wp_posts', updateRowId, updateBase);
  setRow(base, 'wp_posts', deleteRowId, deleteBase);
  setRow(local, 'wp_posts', deleteRowId, deleteBase);
  setRow(remote, 'wp_posts', deleteRowId, deleteBase);

  setRow(local, 'wp_posts', `ID:${createId}`, makePost(createId, `Generated wp_posts create ${createId}`, {
    post_content: `generated create content ${prefix} ${allocator.next()}`,
    post_type: 'post',
  }));
  setRow(local, 'wp_posts', updateRowId, {
    ...updateBase,
    post_title: `Generated wp_posts update ${prefix} ${allocator.next()}`,
    post_content: `generated update content ${prefix} ${allocator.next()}`,
  });
  deleteRow(local, 'wp_posts', deleteRowId);

  tags.add('wp-posts-create-update-delete');
  tags.add('wp-posts-create');
  tags.add('wp-posts-update');
  tags.add('wp-posts-delete');
  tags.add('wp-posts-create-update-delete-v3');
  tags.add(conflict ? 'wp-posts-create-update-delete-v3-non-ready' : 'wp-posts-create-update-delete-v3-ready');
  tags.add('wp-posts-create-update-delete-v4');
  tags.add(conflict ? 'wp-posts-create-update-delete-v4-non-ready' : 'wp-posts-create-update-delete-v4-ready');

  if (conflict) {
    remote.db.wp_posts[updateRowId].post_title = `Remote concurrent wp_posts update ${allocator.next()}`;
    remote.db.wp_posts[updateRowId].post_content = `remote concurrent wp_posts content ${allocator.next()}`;
  }
}


function addWpPostmetaCreateUpdateDelete(base, local, remote, allocator, tags, { conflict, prefix }) {
  const createId = allocator.graphId();
  const updateId = allocator.graphId();
  const deleteId = allocator.graphId();
  const updateRowId = `meta_id:${updateId}`;
  const deleteRowId = `meta_id:${deleteId}`;
  const updateBase = {
    meta_id: updateId,
    post_id: 1,
    meta_key: `_generated_postmeta_update_${updateId}`,
    meta_value: `base postmeta update ${updateId}`,
  };
  const deleteBase = {
    meta_id: deleteId,
    post_id: 1,
    meta_key: `_generated_postmeta_delete_${deleteId}`,
    meta_value: `base postmeta delete ${deleteId}`,
  };

  setRow(base, 'wp_postmeta', updateRowId, updateBase);
  setRow(local, 'wp_postmeta', updateRowId, updateBase);
  setRow(remote, 'wp_postmeta', updateRowId, updateBase);
  setRow(base, 'wp_postmeta', deleteRowId, deleteBase);
  setRow(local, 'wp_postmeta', deleteRowId, deleteBase);
  setRow(remote, 'wp_postmeta', deleteRowId, deleteBase);

  setRow(local, 'wp_postmeta', `meta_id:${createId}`, {
    meta_id: createId,
    post_id: 1,
    meta_key: `_generated_postmeta_create_${createId}`,
    meta_value: `generated wp_postmeta create ${prefix} ${allocator.next()}`,
  });
  setRow(local, 'wp_postmeta', updateRowId, {
    ...updateBase,
    meta_value: `generated wp_postmeta update ${prefix} ${allocator.next()}`,
  });
  deleteRow(local, 'wp_postmeta', deleteRowId);

  tags.add('wp-postmeta-create-update-delete');
  tags.add('wp-postmeta-create');
  tags.add('wp-postmeta-update');
  tags.add('wp-postmeta-delete');
  tags.add('wp-postmeta-create-update-delete-v3');
  tags.add(conflict ? 'wp-postmeta-create-update-delete-v3-non-ready' : 'wp-postmeta-create-update-delete-v3-ready');
  tags.add('wp-postmeta-create-update-delete-v4');
  tags.add(conflict ? 'wp-postmeta-create-update-delete-v4-non-ready' : 'wp-postmeta-create-update-delete-v4-ready');

  if (conflict) {
    remote.db.wp_postmeta[updateRowId].meta_value = `remote concurrent wp_postmeta update ${allocator.next()}`;
  }
}




function addPluginOwnedOptionChange(base, local, remote, allocator, tags, { conflict, prefix }) {
  const optionName = `generated_plugin_owned_option_${allocator.next()}`;
  const rowId = `option_name:${optionName}`;
  const resourceKey = rowKey('wp_options', rowId);
  const row = {
    option_name: optionName,
    option_value: {
      mode: 'base',
      token: `plugin-owned-option-${allocator.next()}`,
      private_token: `base-private-plugin-owned-option-token-${allocator.next()}`,
      private_notes: `base-private-plugin-owned-option-notes-${allocator.next()}`,
    },
    __pluginOwner: 'forms',
  };

  setRow(base, 'wp_options', rowId, row);
  setRow(remote, 'wp_options', rowId, row);
  setRow(local, 'wp_options', rowId, {
    ...row,
    option_value: {
      mode: 'local',
      token: `plugin-owned-option-local-${prefix}-${allocator.next()}`,
      private_token: `local-private-plugin-owned-option-token-${prefix}-${allocator.next()}`,
      private_notes: `local-private-plugin-owned-option-notes-${prefix}-${allocator.next()}`,
    },
  });
  allowPluginOwned(local, resourceKey, 'forms', 'wp-option');

  tags.add('plugin-owned-option-change');
  tags.add('plugin-owned-option-update');
  tags.add('plugin-owned-option-change-v3');
  tags.add(conflict ? 'plugin-owned-option-change-v3-non-ready' : 'plugin-owned-option-change-v3-ready');
  tags.add('plugin-owned-supported');

  if (conflict) {
    remote.db.wp_options[rowId].option_value = {
      mode: 'remote',
      token: `plugin-owned-option-remote-${prefix}-${allocator.next()}`,
      private_token: `remote-private-plugin-owned-option-token-${prefix}-${allocator.next()}`,
      private_notes: `remote-private-plugin-owned-option-notes-${prefix}-${allocator.next()}`,
    };
  }
}

function addPluginOwnedCustomTableChanges(base, local, remote, allocator, tags, { staleTarget, prefix }) {
  const id = allocator.formsLabId();
  const rowId = `id:${id}`;
  const resourceKey = rowKey('wp_reprint_push_forms_lab', rowId);
  const row = {
    id,
    form_slug: `generated-rpp-0135-${id}`,
    payload: {
      owner: 'forms',
      scenario: 'rpp-0135-plugin-owned-custom-table',
      generatedHarnessVariant: 'rpp-0115-variant1',
      mode: 'base',
      privateToken: `rpp0135-private-base-${prefix}-${id}`,
    },
    updated_marker: `base-${id}`,
    __pluginOwner: 'forms',
  };

  setRow(base, 'wp_reprint_push_forms_lab', rowId, row);
  setRow(remote, 'wp_reprint_push_forms_lab', rowId, row);
  setRow(local, 'wp_reprint_push_forms_lab', rowId, {
    ...row,
    payload: {
      ...row.payload,
      owner: 'forms',
      generatedHarnessVariant: 'rpp-0115-variant1',
      mode: 'local',
      privateToken: `rpp0135-private-local-${prefix}-${allocator.next()}`,
    },
    updated_marker: `local-${allocator.next()}`,
  });
  allowPluginOwned(local, resourceKey, 'forms', 'fixture-forms-lab-table', {
    table: 'wp_reprint_push_forms_lab',
  });
  remote.files[`wp-content/uploads/${prefix}-custom-table-remote-only-${allocator.next()}.txt`] =
    `Remote preserved custom table note ${allocator.next()}`;

  if (staleTarget) {
    setRow(remote, 'wp_reprint_push_forms_lab', rowId, {
      ...row,
      payload: {
        ...row.payload,
        owner: 'forms',
        generatedHarnessVariant: 'rpp-0115-variant1',
        mode: 'remote-stale',
        privateToken: `rpp0135-private-remote-${prefix}-${allocator.next()}`,
      },
      updated_marker: `remote-${allocator.next()}`,
    });
    tags.add('forms-lab-custom-table-stale');
    tags.add('forms-lab-remote-drift');
    tags.add('plugin-owned-custom-table-variant3-stale');
    tags.add('plugin-owned-custom-table-variant3-non-ready');
  } else {
    tags.add('forms-lab-custom-table-ready');
    tags.add('plugin-owned-custom-table-variant3-ready');
  }

  tags.add('plugin-owned-custom-table-target');
  tags.add('plugin-owned-custom-table-variant1');
  tags.add('plugin-owned-custom-table-variant3');
  tags.add('plugin-owned-custom-table-update');
  tags.add('plugin-owned-custom-table-change');
  tags.add('forms-lab-custom-table-change');
  tags.add('forms-lab-supported');
  tags.add('plugin-owned-supported');
  tags.add('remote-preserve');
}

function addWpCommentsCommentmetaGraph(local, remote, allocator, tags, { staleTarget, base = null }) {
  const commentId = allocator.graphId();
  const metaId = allocator.graphId();
  const commentRowId = `comment_ID:${commentId}`;
  const commentmetaRowId = `meta_id:${metaId}`;
  const comment = makeComment(commentId, {
    comment_post_ID: 1,
    comment_parent: 0,
    comment_content: `Generated comment graph target ${commentId}`,
    user_id: 1,
  });

  if (staleTarget) {
    setRow(base, 'wp_comments', commentRowId, comment);
    setRow(local, 'wp_comments', commentRowId, comment);
    setRow(remote, 'wp_comments', commentRowId, {
      ...comment,
      comment_content: `Remote stale comment graph target ${commentId}`,
    });
  } else {
    setRow(local, 'wp_comments', commentRowId, comment);
  }

  setRow(local, 'wp_commentmeta', commentmetaRowId, {
    meta_id: metaId,
    comment_id: commentId,
    meta_key: `_generated_commentmeta_graph_${metaId}`,
    meta_value: `generated commentmeta graph ${metaId}`,
  });

  tags.add('wp-comments-commentmeta-graph');
  tags.add('wp-comments-commentmeta-graph-v4');
  tags.add('wp-comments-create');
  tags.add('wp-commentmeta-create');
  tags.add('commentmeta-comment-graph');
  tags.add('comment-graph');
  tags.add('same-plan-graph');

  if (staleTarget) {
    tags.add('stale-graph');
    tags.add('wp-comments-remote-drift');
    tags.add('wp-comments-commentmeta-graph-v4-stale');
    tags.add('wp-comments-commentmeta-graph-v4-non-ready');
  } else {
    tags.add('wp-comments-commentmeta-graph-v4-ready');
  }
}

function addFeaturedImageAttachmentGraph(base, local, remote, allocator, tags, { staleTarget }) {
  const postId = 1;
  const attachmentId = allocator.graphId();
  const attachmentRowId = `ID:${attachmentId}`;
  const thumbnailRowId = `post_id:${postId}:meta_key:_thumbnail_id`;
  const attachment = makePost(attachmentId, `Generated featured image attachment ${attachmentId}`, {
    post_status: 'inherit',
    post_type: 'attachment',
    post_parent: postId,
    post_author: 1,
    post_mime_type: 'image/jpeg',
    guid: `https://example.test/wp-content/uploads/generated-featured-image-${attachmentId}.jpg`,
  });

  if (staleTarget) {
    setRow(base, 'wp_posts', attachmentRowId, attachment);
    setRow(local, 'wp_posts', attachmentRowId, attachment);
    setRow(remote, 'wp_posts', attachmentRowId, {
      ...attachment,
      post_title: `Remote stale featured image attachment ${attachmentId}`,
      post_content: `remote stale featured image private payload ${attachmentId}`,
    });
  } else {
    setRow(local, 'wp_posts', attachmentRowId, attachment);
  }

  setRow(local, 'wp_postmeta', thumbnailRowId, {
    post_id: postId,
    meta_key: '_thumbnail_id',
    meta_value: String(attachmentId),
  });

  tags.add('featured-image-attachment');
  tags.add('featured-image-graph');
  tags.add('postmeta-post');
  tags.add('same-plan-graph');

  if (staleTarget) {
    tags.add('stale-graph');
    tags.add('featured-image-stale-target');
  } else {
    tags.add('featured-image-ready');
    tags.add('attachment-post-create');
  }
}

function addWpTermsTermmetaGraph(local, remote, allocator, tags, { staleTarget, base = null }) {
  const termId = allocator.graphId();
  const metaId = allocator.graphId();
  const termRowId = `term_id:${termId}`;
  const termmetaRowId = `meta_id:${metaId}`;
  const term = {
    term_id: termId,
    name: `Generated term graph target ${termId}`,
    slug: `generated-term-graph-${termId}`,
    term_group: 0,
  };

  if (staleTarget) {
    setRow(base, 'wp_terms', termRowId, term);
    setRow(local, 'wp_terms', termRowId, term);
    setRow(remote, 'wp_terms', termRowId, {
      ...term,
      name: `Remote stale term graph target ${termId}`,
      slug: `remote-stale-term-graph-${termId}`,
    });
  } else {
    setRow(local, 'wp_terms', termRowId, term);
  }

  setRow(local, 'wp_termmeta', termmetaRowId, {
    meta_id: metaId,
    term_id: termId,
    meta_key: `_generated_termmeta_graph_${metaId}`,
    meta_value: `generated termmeta graph ${metaId}`,
  });

  tags.add('wp-terms-termmeta-graph');
  tags.add('wp-terms-termmeta-graph-v3');
  tags.add('wp-terms-termmeta-graph-v4');
  tags.add('wp-terms-create');
  tags.add('wp-termmeta-create');
  tags.add('termmeta-term-graph');
  tags.add('taxonomy-graph');
  tags.add('same-plan-graph');

  if (staleTarget) {
    tags.add('stale-graph');
    tags.add('wp-terms-remote-drift');
    tags.add('wp-terms-termmeta-graph-v3-stale');
    tags.add('wp-terms-termmeta-graph-v3-non-ready');
    tags.add('wp-terms-termmeta-graph-v4-stale');
    tags.add('wp-terms-termmeta-graph-v4-non-ready');
  } else {
    tags.add('wp-terms-termmeta-graph-v3-ready');
    tags.add('wp-terms-termmeta-graph-v4-ready');
  }
}

function addWpUsersUsermetaGraph(local, remote, allocator, tags, { staleTarget, base = null }) {
  const userId = allocator.graphId();
  const metaId = allocator.graphId();
  const userRowId = `ID:${userId}`;
  const usermetaRowId = `umeta_id:${metaId}`;
  const user = makeUser(userId, {
    display_name: `Generated graph user ${userId}`,
    user_pass: `generated-private-user-pass-${userId}`,
    user_activation_key: `generated-private-user-token-${userId}`,
    user_registered: '2026-05-28 00:00:00',
    user_status: 0,
  });

  if (staleTarget) {
    setRow(base, 'wp_users', userRowId, user);
    setRow(local, 'wp_users', userRowId, user);
    setRow(remote, 'wp_users', userRowId, {
      ...user,
      user_email: `remote-private-user-${userId}@example.test`,
      display_name: `Remote stale graph user ${userId}`,
      user_activation_key: `remote-private-user-token-${userId}`,
    });
  } else {
    setRow(local, 'wp_users', userRowId, user);
  }

  setRow(local, 'wp_usermeta', usermetaRowId, {
    umeta_id: metaId,
    user_id: userId,
    meta_key: `_generated_usermeta_graph_${metaId}`,
    meta_value: {
      public_label: `generated usermeta graph ${metaId}`,
      private_token: `local-private-usermeta-token-${metaId}`,
      private_notes: `local-private-usermeta-notes-${metaId}`,
    },
  });

  tags.add('wp-users-usermeta-graph');
  tags.add('wp-users-usermeta-graph-v3');
  tags.add('wp-users-usermeta-graph-v4');
  tags.add('wp-users-create');
  tags.add('wp-usermeta-create');
  tags.add('usermeta-user-graph');
  tags.add('user-meta-graph');
  tags.add('same-plan-graph');

  if (staleTarget) {
    tags.add('stale-graph');
    tags.add('wp-users-remote-drift');
    tags.add('wp-users-usermeta-graph-v3-stale');
    tags.add('wp-users-usermeta-graph-v3-non-ready');
    tags.add('wp-users-usermeta-graph-v4-stale');
    tags.add('wp-users-usermeta-graph-v4-non-ready');
  } else {
    tags.add('wp-users-usermeta-graph-v3-ready');
    tags.add('wp-users-usermeta-graph-v4-ready');
  }
}

function addWpTermTaxonomyGraph(local, remote, allocator, tags, { staleTarget, base = null }) {
  const termId = allocator.graphId();
  const taxonomyId = allocator.graphId();
  const termRowId = `term_id:${termId}`;
  const taxonomyRowId = `term_taxonomy_id:${taxonomyId}`;
  const term = {
    term_id: termId,
    name: `Generated term taxonomy graph target ${termId}`,
    slug: `generated-term-taxonomy-graph-${termId}`,
    term_group: 0,
  };

  if (staleTarget) {
    setRow(base, 'wp_terms', termRowId, term);
    setRow(local, 'wp_terms', termRowId, term);
    setRow(remote, 'wp_terms', termRowId, {
      ...term,
      name: `Remote stale term taxonomy graph target ${termId}`,
      slug: `remote-stale-term-taxonomy-graph-${termId}`,
    });
  } else {
    setRow(local, 'wp_terms', termRowId, term);
  }

  setRow(local, 'wp_term_taxonomy', taxonomyRowId, {
    term_taxonomy_id: taxonomyId,
    term_id: termId,
    taxonomy: 'category',
    description: `generated term taxonomy graph ${taxonomyId}`,
    parent: 0,
    count: 1,
  });

  tags.add('wp-term-taxonomy-graph');
  tags.add('wp-term-taxonomy-graph-v3');
  tags.add('wp-term-taxonomy-graph-v4');
  tags.add('wp-terms-create');
  tags.add('wp-term-taxonomy-create');
  tags.add('term-taxonomy-term-graph');
  tags.add('taxonomy-graph');
  tags.add('same-plan-graph');

  if (staleTarget) {
    tags.add('stale-graph');
    tags.add('wp-terms-remote-drift');
    tags.add('wp-term-taxonomy-graph-v3-stale');
    tags.add('wp-term-taxonomy-graph-v3-non-ready');
    tags.add('wp-term-taxonomy-graph-v4-stale');
    tags.add('wp-term-taxonomy-graph-v4-non-ready');
  } else {
    tags.add('wp-term-taxonomy-graph-v3-ready');
    tags.add('wp-term-taxonomy-graph-v4-ready');
  }
}

function addWpTermRelationshipsGraph(base, local, remote, allocator, tags, { staleTarget, prefix }) {
  const termId = allocator.graphId();
  const taxonomyId = allocator.graphId();
  const termRowId = `term_id:${termId}`;
  const taxonomyRowId = `term_taxonomy_id:${taxonomyId}`;
  const relationshipRowId = `object_id:1|term_taxonomy_id:${taxonomyId}`;
  const term = {
    term_id: termId,
    name: `Generated wp_term_relationships term target ${prefix} ${termId}`,
    slug: `generated-wp-term-relationships-${prefix}-${termId}`,
    term_group: 0,
  };
  const taxonomy = {
    term_taxonomy_id: taxonomyId,
    term_id: termId,
    taxonomy: 'category',
    description: `Generated wp_term_relationships taxonomy target ${prefix} ${taxonomyId}`,
    parent: 0,
    count: 1,
  };

  if (staleTarget) {
    setRow(base, 'wp_terms', termRowId, term);
    setRow(local, 'wp_terms', termRowId, term);
    setRow(remote, 'wp_terms', termRowId, term);
    setRow(base, 'wp_term_taxonomy', taxonomyRowId, taxonomy);
    setRow(local, 'wp_term_taxonomy', taxonomyRowId, taxonomy);
    setRow(remote, 'wp_term_taxonomy', taxonomyRowId, {
      ...taxonomy,
      description: `Remote stale wp_term_relationships taxonomy target ${taxonomyId}`,
      count: 2,
    });
    tags.add('wp-term-relationships-graph-stale');
    tags.add('wp-term-relationships-graph-v3-stale');
    tags.add('wp-term-relationships-graph-v3-non-ready');
    tags.add('wp-term-relationships-remote-drift');
  } else {
    setRow(local, 'wp_terms', termRowId, term);
    setRow(local, 'wp_term_taxonomy', taxonomyRowId, taxonomy);
    tags.add('wp-term-relationships-graph-ready');
    tags.add('wp-term-relationships-graph-v3-ready');
  }

  setRow(local, 'wp_term_relationships', relationshipRowId, {
    object_id: 1,
    term_taxonomy_id: taxonomyId,
    term_order: 0,
  });
  remote.files[`wp-content/uploads/${prefix}-remote-only-${allocator.next()}.txt`] =
    `Remote preserved wp_term_relationships graph note ${allocator.next()}`;

  tags.add('remote-preserve');
  tags.add('wp-term-relationships-graph');
  tags.add('wp-term-relationships-graph-target');
  tags.add('wp-term-relationships-graph-v3');
  tags.add('wp-term-relationships-create');
  tags.add('term-relationship-object-graph');
  tags.add('term-relationship-taxonomy-graph');
  tags.add('taxonomy-graph');
  tags.add('same-plan-graph');
}

function addLargeReadyPlanTier(tier, base, local, remote, allocator, tags) {
  const updateCount = 4 + tier;
  const createCount = 4 + Math.floor(tier / 2);
  const deleteCount = 3 + Math.floor(tier / 3);
  const fileCreateCount = 3 + Math.floor(tier / 4);
  const fileUpdateCount = 3 + Math.floor(tier / 3);
  const fileDeleteCount = 2 + Math.floor(tier / 5);

  for (let index = 0; index < updateCount; index++) {
    const postId = allocator.graphId();
    const rowId = `ID:${postId}`;
    const row = makePost(postId, `Base large ready update ${postId}`, {
      post_content: `base large ready update ${index}`,
      post_type: index % 2 === 0 ? 'post' : 'page',
    });
    setRow(base, 'wp_posts', rowId, row);
    setRow(local, 'wp_posts', rowId, {
      ...row,
      post_title: `Generated large ready update ${postId}`,
      post_content: `generated large ready update ${index}`,
    });
    setRow(remote, 'wp_posts', rowId, row);
  }

  for (let index = 0; index < createCount; index++) {
    const postId = allocator.graphId();
    setRow(local, 'wp_posts', `ID:${postId}`, makePost(postId, `Generated large ready create ${postId}`, {
      post_content: `generated large ready create ${index}`,
      post_type: index % 2 === 0 ? 'post' : 'page',
    }));
  }

  for (let index = 0; index < deleteCount; index++) {
    const postId = allocator.graphId();
    const rowId = `ID:${postId}`;
    const row = makePost(postId, `Base large ready delete ${postId}`, {
      post_content: `base large ready delete ${index}`,
    });
    setRow(base, 'wp_posts', rowId, row);
    setRow(local, 'wp_posts', rowId, row);
    setRow(remote, 'wp_posts', rowId, row);
    deleteRow(local, 'wp_posts', rowId);
  }

  for (let index = 0; index < fileCreateCount; index++) {
    local.files[allocator.filePath('large-ready-create')] = `generated large ready file create ${index}`;
  }

  for (let index = 0; index < fileUpdateCount; index++) {
    const path = allocator.filePath('large-ready-update');
    base.files[path] = `base large ready file update ${index}`;
    local.files[path] = `generated large ready file update ${index}`;
    remote.files[path] = base.files[path];
  }

  for (let index = 0; index < fileDeleteCount; index++) {
    const path = allocator.filePath('large-ready-delete');
    base.files[path] = `base large ready file delete ${index}`;
    local.files[path] = base.files[path];
    remote.files[path] = base.files[path];
    delete local.files[path];
  }

  const remotePostId = allocator.graphId();
  const remotePostRowId = `ID:${remotePostId}`;
  const remotePost = makePost(remotePostId, `Base large ready remote preserve ${remotePostId}`);
  setRow(base, 'wp_posts', remotePostRowId, remotePost);
  setRow(local, 'wp_posts', remotePostRowId, remotePost);
  setRow(remote, 'wp_posts', remotePostRowId, {
    ...remotePost,
    post_title: `Remote large ready preserved ${remotePostId}`,
  });

  const remotePath = allocator.filePath('large-ready-remote-preserve');
  base.files[remotePath] = 'base large ready remote file';
  local.files[remotePath] = base.files[remotePath];
  remote.files[remotePath] = 'remote large ready preserved file';

  addTaxonomyGraph(local, allocator);
  addCommentGraph(local, allocator);

  tags.add('large-ready-plan-target');
  tags.add('large-ready-plan');
  tags.add('large-ready-plan-v3');
  tags.add('large-ready-plan-v3-ready');
  tags.add('ready-candidate');
  tags.add('row-create');
  tags.add('row-update');
  tags.add('row-delete');
  tags.add('file-create');
  tags.add('file-update');
  tags.add('file-delete');
  tags.add('bulk-local-update');
  tags.add('bulk-remote-preserve');
  tags.add('remote-preserve');
  tags.add('same-plan-graph');
  tags.add('taxonomy-graph');
  tags.add('comment-graph');
}

function addCommentGraph(local, allocator) {
  const parentId = allocator.graphId();
  const childId = allocator.graphId();
  setRow(local, 'wp_comments', `comment_ID:${parentId}`, makeComment(parentId, {
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 1,
  }));
  setRow(local, 'wp_comments', `comment_ID:${childId}`, makeComment(childId, {
    comment_post_ID: 1,
    comment_parent: parentId,
    user_id: 1,
  }));
}

function addPostAuthorGraph(base, local, remote, allocator, tags, { staleTarget }) {
  const userId = allocator.graphId();
  const postId = allocator.graphId();
  const userRowId = `ID:${userId}`;
  const postRowId = `ID:${postId}`;
  const user = {
    ...makeUser(userId),
    user_login: `post-author-target-${userId}`,
    user_email: `post-author-target-${userId}@example.test`,
    display_name: `Generated post author target ${userId}`,
  };

  if (staleTarget) {
    setRow(base, 'wp_users', userRowId, user);
    setRow(local, 'wp_users', userRowId, user);
    setRow(remote, 'wp_users', userRowId, {
      ...user,
      user_email: `remote-private-post-author-${userId}@example.test`,
      display_name: `Remote stale post author ${userId}`,
    });
  } else {
    setRow(local, 'wp_users', userRowId, user);
  }

  setRow(local, 'wp_posts', postRowId, makePost(postId, `post-author-reference-${postId}`, {
    post_author: userId,
  }));

  tags.add('same-plan-graph');
  tags.add('post-author-graph');

  if (staleTarget) {
    tags.add('stale-graph');
    tags.add('post-author-stale');
    tags.add('post-author-stale-target');
    tags.add('wp-users-remote-drift');
  } else {
    tags.add('post-author-ready');
  }
}

function addCommentUserGraph(base, local, remote, allocator, tags, { staleTarget }) {
  const userId = allocator.graphId();
  const commentId = allocator.graphId();
  const userRowId = `ID:${userId}`;
  const commentRowId = `comment_ID:${commentId}`;
  const user = {
    ...makeUser(userId),
    user_login: `comment-user-target-${userId}`,
    user_email: `comment-user-target-${userId}@example.test`,
    display_name: `Generated comment user target ${userId}`,
  };

  if (staleTarget) {
    setRow(base, 'wp_users', userRowId, user);
    setRow(local, 'wp_users', userRowId, user);
    setRow(remote, 'wp_users', userRowId, {
      ...user,
      user_email: `remote-stale-comment-user-private-${userId}@example.test`,
      display_name: `Remote stale comment user ${userId}`,
    });
  } else {
    setRow(local, 'wp_users', userRowId, user);
  }

  setRow(local, 'wp_comments', commentRowId, makeComment(commentId, {
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: userId,
    comment_content: `comment-user-reference-${commentId}`,
  }));

  tags.add('comment-user-graph');
  tags.add('comment-user');
  tags.add('same-plan-graph');
  tags.add('wp-comments-create');
  tags.add('wp-users-create');

  if (staleTarget) {
    tags.add('stale-graph');
    tags.add('comment-user-stale-target');
    tags.add('wp-users-remote-drift');
  } else {
    tags.add('comment-user-ready');
  }
}

function addTaxonomyGraph(local, allocator) {
  const termId = allocator.graphId();
  const taxonomyId = allocator.graphId();
  setRow(local, 'wp_terms', `term_id:${termId}`, {
    term_id: termId,
    name: `Generated term ${termId}`,
    slug: `generated-term-${termId}`,
  });
  setRow(local, 'wp_term_taxonomy', `term_taxonomy_id:${taxonomyId}`, {
    term_taxonomy_id: taxonomyId,
    term_id: termId,
    taxonomy: 'category',
    parent: 0,
    count: 1,
  });
  setRow(local, 'wp_term_relationships', `object_id:1|term_taxonomy_id:${taxonomyId}`, {
    object_id: 1,
    term_taxonomy_id: taxonomyId,
    term_order: 0,
  });
}

function staleValueFor(resource, current) {
  if (current === ABSENT) {
    if (resource.type === 'file') {
      return `stale file ${resource.key}`;
    }
    if (resource.type === 'plugin') {
      return { version: 'stale', active: true };
    }
    return { stale: resource.key };
  }
  if (resource.type === 'file') {
    return { type: 'file', content: `stale drift ${resource.key}` };
  }
  if (resource.type === 'plugin') {
    return { ...current, version: `${current.version || '0.0.0'}-stale` };
  }
  return { ...current, __staleGeneratedHarness: true };
}

function ensurePostExists(site, id) {
  site.db ||= {};
  site.db.wp_posts ||= {};
  site.db.wp_posts[`ID:${id}`] ||= makePost(id, `Base post ${id}`);
}

function makePost(id, title, extra = {}) {
  return {
    ID: id,
    post_title: title,
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 1,
    ...extra,
  };
}

function makeUser(id, extra = {}) {
  return {
    ID: id,
    user_login: `generated-user-${id}`,
    user_email: `generated-user-${id}@example.test`,
    display_name: `Generated User ${id}`,
    ...extra,
  };
}

function makeComment(id, extra = {}) {
  return {
    comment_ID: id,
    comment_content: `Generated comment ${id}`,
    comment_approved: '1',
    ...extra,
  };
}

function setRow(site, table, id, value) {
  site.db ||= {};
  site.db[table] ||= {};
  site.db[table][id] = deepClone(value);
}

function deleteRow(site, table, id) {
  site.db ||= {};
  site.db[table] ||= {};
  delete site.db[table][id];
}

function allowPluginOwned(site, resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  site.meta ||= {};
  site.meta.pluginOwnedResources ||= {};
  site.meta.pluginOwnedResources.allowedResources ||= [];
  if (site.meta.pluginOwnedResources.allowedResources.some((entry) =>
    entry.resourceKey === resourceKey && entry.pluginOwner === pluginOwner && entry.driver === driver)) {
    return;
  }
  site.meta.pluginOwnedResources.allowedResources.push(
    allowedPluginOwnedResource(resourceKey, pluginOwner, driver, extra),
  );
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  return {
    resourceKey,
    pluginOwner,
    driver,
    ...extra,
  };
}

function rowKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function pluginResource(name) {
  return { type: 'plugin', name, key: `plugin:${name}` };
}

function pluginMainFile(name) {
  return `wp-content/plugins/${name}/${name}.php`;
}

function createAllocator(index, tier) {
  let counter = 0;
  const base = 10000 + index * 100 + tier * 10;
  return {
    next() {
      counter += 1;
      return counter;
    },
    postId() {
      return 2 + ((counter += 1) % Math.max(1, 2 + tier));
    },
    graphId() {
      counter += 1;
      return base + counter;
    },
    formsLabId() {
      counter += 1;
      return base + counter;
    },
    filePath(prefix) {
      counter += 1;
      return `wp-content/uploads/${prefix}-${base}-${counter}.txt`;
    },
    existingUploadPath() {
      counter += 1;
      return counter % 2 === 0 ? 'wp-content/uploads/shared-1.txt' : 'wp-content/uploads/shared-2.txt';
    },
  };
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to throw');
}

function assertUniqueIds(caseId, label, values) {
  const seen = new Set();
  for (const value of values) {
    assert.equal(seen.has(value), false, `${caseId} duplicate ${label} id ${value}`);
    seen.add(value);
  }
}

function increment(object, key) {
  object[String(key)] = (object[String(key)] || 0) + 1;
}

function incrementStatus(target, family, status) {
  target[family] ||= {};
  increment(target[family], status);
}

function sortNestedStatusCounts(target) {
  return Object.fromEntries(
    Object.entries(target)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([family, statuses]) => [
        family,
        Object.fromEntries(Object.entries(statuses).sort(([left], [right]) => left.localeCompare(right))),
      ]),
  );
}

function randomInt(rng, min, maxExclusive) {
  return min + Math.floor(rng() * (maxExclusive - min));
}

function mulberry32(seed) {
  return function nextRandom() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = runGeneratedPushHarness();
    console.log(JSON.stringify(report.summary, null, 2));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
