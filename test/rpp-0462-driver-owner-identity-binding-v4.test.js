import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import { generateDriverOwnerIdentityBindingCases } from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const ownerIdentityVariants = [
  'supported-exact-owner-policy',
  'unsupported-wrong-policy-owner',
  'unsupported-missing-owner-policy',
  'unsupported-local-owner-drift',
  'unsupported-stale-owner-context',
];

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

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
}

function assertNoPrivateMarkers(value, testCase) {
  const json = JSON.stringify(value);
  for (const marker of testCase.secretTokens) {
    assert.equal(json.includes(marker), false, `${testCase.variant} leaked generated private marker ${marker}`);
  }
}

function assertRemoteUnchangedAfterRefusal(testCase, plan, expectedCode) {
  const remote = cloneJson(testCase.remote);
  const before = digest(remote);
  const error = captureError(() => applyPlan(remote, plan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, expectedCode);
  assert.equal(digest(remote), before, `${testCase.variant} changed remote data after refusal`);
  assertNoPrivateMarkers(error.details, testCase);
  return error;
}

function redactedCaseEvidence({ testCase, plan, outcome, mutation = null, blocker = null, error = null }) {
  return {
    id: testCase.id,
    variant: testCase.variant,
    outcome,
    status: plan.status,
    mutationCount: plan.mutations.length,
    blockerCount: plan.blockers.length,
    resourceKey: testCase.resourceKey,
    mutation: mutation
      ? {
          action: mutation.action,
          pluginOwner: mutation.pluginOwnedResource.pluginOwner,
          driver: mutation.pluginOwnedResource.driver,
          policySource: mutation.pluginOwnedResource.policySource,
          ownerContextRequired: mutation.pluginOwnedResource.ownerContextRequired,
          supportsDelete: mutation.pluginOwnedResource.supportsDelete,
          auditEvidence: mutation.pluginOwnedResource.auditEvidence,
          driverAuditEvidence: mutation.pluginOwnedResource.driverAuditEvidence,
        }
      : null,
    blocker: blocker
      ? {
          class: blocker.class,
          pluginOwner: blocker.pluginOwner,
          driver: blocker.driver || null,
          policySource: blocker.policySource || null,
          reasonCode: blocker.reasonCode || null,
          ownerMetadataRefusalEvidence: blocker.ownerMetadataRefusalEvidence || null,
          driverAuditEvidence: blocker.driverAuditEvidence || null,
          unknownPluginOwnedResourceRefusalEvidence: blocker.unknownPluginOwnedResourceRefusalEvidence || null,
          baseHash: blocker.baseHash,
          localHash: blocker.localHash,
          remoteHash: blocker.remoteHash,
          changeHash: digest(blocker.change),
        }
      : null,
    applyError: error
      ? {
          code: error.code,
          resourceKey: error.details?.resourceKey || null,
          pluginOwner: error.details?.pluginOwner || null,
          driver: error.details?.driver || null,
          reasonCode: error.details?.applyValidationEvidence?.reasonCode || null,
          evidenceHash: digest(error.details || {}),
        }
      : null,
  };
}

function assertSupportedExactOwnerCase(testCase, plan) {
  const mutation = mutationFor(plan, testCase.resourceKey);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.preconditions.length, 1);
  assert.ok(mutation, 'supported owner identity case should plan a mutation');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(mutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assertNoPrivateMarkers(mutation.pluginOwnedResource, testCase);

  const applied = applyPlan(cloneJson(testCase.remote), plan);
  assert.equal(applied.appliedMutations, 1);
  assert.equal(applied.site.db.wp_options[testCase.rowId].option_value.mode, 'local-supported-exact-owner-policy');
  assert.equal(applied.site.db.wp_options[testCase.rowId].__pluginOwner, 'forms');
  assertNoPrivateMarkers(applied.journal, testCase);

  return redactedCaseEvidence({ testCase, plan, outcome: 'ready', mutation });
}

function assertWrongOrMissingOwnerPolicyCase(testCase, plan) {
  const blocker = blockerFor(plan, testCase.resourceKey);
  const error = assertRemoteUnchangedAfterRefusal(testCase, plan, 'PLAN_NOT_READY');

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, testCase.resourceKey), undefined);
  assert.ok(blocker, 'unsupported owner policy case should expose a blocker');
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.driver || null, null);
  assert.equal(blocker.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(blocker.unknownPluginOwnedResourceRefusalEvidence.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(blocker.unknownPluginOwnedResourceRefusalEvidence.rawValuesIncluded, false);
  assertNoPrivateMarkers(blocker, testCase);

  return redactedCaseEvidence({
    testCase,
    plan,
    outcome: 'planner-blocked',
    blocker,
    error,
  });
}

function assertLocalOwnerDriftCase(testCase, plan) {
  const mutation = mutationFor(plan, testCase.resourceKey);

  assert.equal(plan.status, 'ready');
  assert.ok(mutation, 'local owner drift should reach apply revalidation');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(testCase.local.db.wp_options[testCase.rowId].__pluginOwner, 'forms-impostor');
  assertNoPrivateMarkers(mutation.pluginOwnedResource, testCase);

  const error = assertRemoteUnchangedAfterRefusal(testCase, plan, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(error.details.resourceKey, testCase.resourceKey);
  assert.equal(error.details.pluginOwner, 'forms-impostor');
  assert.equal(error.details.driver, 'wp-option');
  assert.equal(error.details.applyValidationEvidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED');
  assert.equal(error.details.applyValidationEvidence.outcome, 'refused-before-mutation');

  return redactedCaseEvidence({
    testCase,
    plan,
    outcome: 'apply-refused',
    mutation,
    error,
  });
}

function assertStaleOwnerContextCase(testCase, plan) {
  const blocker = blockerFor(plan, testCase.resourceKey);
  const error = assertRemoteUnchangedAfterRefusal(testCase, plan, 'PLAN_NOT_READY');

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, testCase.resourceKey), undefined);
  assert.ok(blocker, 'stale owner context case should expose a blocker');
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.driver, 'wp-option');
  assert.equal(blocker.policySource, 'local-snapshot');
  assert.equal(blocker.ownerMetadataRefusalEvidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
  assert.deepEqual(blocker.ownerMetadataRefusalEvidence.stalePluginMetadataResourceKeys, ['plugin:forms']);
  assert.equal(blocker.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED');
  assert.equal(blocker.driverAuditEvidence.rawValuesIncluded, false);
  assertNoPrivateMarkers(blocker, testCase);

  return redactedCaseEvidence({
    testCase,
    plan,
    outcome: 'planner-blocked',
    blocker,
    error,
  });
}

function assertOwnerIdentityCase(testCase) {
  const plan = planFor(testCase);

  if (testCase.variant === 'supported-exact-owner-policy') {
    return assertSupportedExactOwnerCase(testCase, plan);
  }

  if (
    testCase.variant === 'unsupported-wrong-policy-owner'
    || testCase.variant === 'unsupported-missing-owner-policy'
  ) {
    return assertWrongOrMissingOwnerPolicyCase(testCase, plan);
  }

  if (testCase.variant === 'unsupported-local-owner-drift') {
    return assertLocalOwnerDriftCase(testCase, plan);
  }

  assert.equal(testCase.variant, 'unsupported-stale-owner-context');
  return assertStaleOwnerContextCase(testCase, plan);
}

test('RPP-0462 generated driver owner identity binding covers supported and unsupported variants', () => {
  const cases = generateDriverOwnerIdentityBindingCases();

  assert.deepEqual(cases.map((testCase) => testCase.variant), ownerIdentityVariants);
  assert.equal(cases.every((testCase) => testCase.family === 'driver-owner-identity-binding'), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('plugin-owned-generated')), true);
  assert.equal(cases.filter((testCase) => testCase.tags.has('driver-owner-identity-supported')).length, 1);
  assert.equal(cases.filter((testCase) => testCase.tags.has('driver-owner-identity-unsupported')).length, 4);
  assert.equal(cases.every((testCase) => testCase.resourceKey.startsWith('row:["wp_options"')), true);

  const results = cases.map(assertOwnerIdentityCase);
  const outcomes = Object.fromEntries(results.map((result) => [result.variant, result.outcome]));
  assert.deepEqual(outcomes, {
    'supported-exact-owner-policy': 'ready',
    'unsupported-wrong-policy-owner': 'planner-blocked',
    'unsupported-missing-owner-policy': 'planner-blocked',
    'unsupported-local-owner-drift': 'apply-refused',
    'unsupported-stale-owner-context': 'planner-blocked',
  });

  const evidence = {
    evidenceScope: 'local-generated-focused',
    productionBacked: false,
    releaseGate: 'NO-GO',
    supportedVariants: results.filter((result) => result.outcome === 'ready').length,
    unsupportedVariants: results.filter((result) => result.outcome !== 'ready').length,
    resultHash: digest(results),
    results,
  };

  assert.equal(evidence.supportedVariants, 1);
  assert.equal(evidence.unsupportedVariants, 4);
  assert.match(evidence.resultHash, /^[a-f0-9]{64}$/);
  for (const testCase of cases) {
    assertNoPrivateMarkers(evidence, testCase);
  }
});
