import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import { generateDriverDryRunValidationHookCases } from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const variants = [
  'supported-dry-run-hook-applies',
  'unsupported-dry-run-hook-blocked',
];
const sha256Pattern = /^[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertNoPrivateMarkers(value, testCase) {
  const json = JSON.stringify(value);
  for (const marker of testCase.secretTokens) {
    assert.equal(json.includes(marker), false, `${testCase.variant} leaked generated private marker ${marker}`);
  }
}

function assertChangeEvidenceIsHashOnly(change) {
  assert.equal(change.localChange, 'update');
  assert.equal(change.remoteChange, 'unchanged');

  for (const side of ['base', 'local', 'remote']) {
    assert.ok(['present', 'absent'].includes(change[side].state));
    assert.match(change[side].hash, sha256Pattern);
    assert.equal(Object.hasOwn(change[side], 'value'), false, `${side} change evidence exposed a raw value`);
  }
}

function assertCommonGeneratedCaseShape(cases) {
  assert.deepEqual(cases.map((testCase) => testCase.variant), variants);
  assert.equal(new Set(cases.map((testCase) => testCase.dataResourceKey)).size, cases.length);
  assert.equal(cases.every((testCase) => testCase.family === 'driver-dry-run-validation-hook'), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('driver-dry-run-validation-hook')), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('plugin-owned-generated')), true);
  assert.equal(cases.every((testCase) => testCase.dataResourceKey.startsWith('row:["wp_options"')), true);
  assert.equal(cases.filter((testCase) => testCase.tags.has('driver-dry-run-validation-supported')).length, 1);
  assert.equal(cases.filter((testCase) => testCase.tags.has('driver-dry-run-validation-unsupported')).length, 1);
}

function supportedEvidence(testCase, plan, mutation, result) {
  return {
    id: testCase.id,
    variant: testCase.variant,
    outcome: 'applied-supported-hook',
    status: plan.status,
    mutationCount: plan.summary.mutations,
    blockerCount: plan.summary.blockers,
    resourceKey: testCase.dataResourceKey,
    driver: mutation.pluginOwnedResource.driver,
    pluginOwner: mutation.pluginOwnedResource.pluginOwner,
    hook: mutation.pluginOwnedResource.dryRunValidationEvidence.hook,
    reasonCode: mutation.pluginOwnedResource.dryRunValidationEvidence.reasonCode,
    supportedHook: mutation.pluginOwnedResource.dryRunValidationEvidence.supportedHook,
    appliedMutations: result.appliedMutations,
    mutationHash: digest({
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      dryRunValidationEvidence: mutation.pluginOwnedResource.dryRunValidationEvidence,
    }),
  };
}

function unsupportedEvidence(testCase, plan, blocker, error, remoteBeforeHash, remoteAfterHash) {
  return {
    id: testCase.id,
    variant: testCase.variant,
    outcome: 'blocked-unsupported-hook',
    status: plan.status,
    mutationCount: plan.summary.mutations,
    blockerCount: plan.summary.blockers,
    resourceKey: testCase.dataResourceKey,
    driver: blocker.driver,
    pluginOwner: blocker.pluginOwner,
    hook: blocker.dryRunValidationEvidence.hook,
    reasonCode: blocker.dryRunValidationEvidence.reasonCode,
    supportedHook: blocker.dryRunValidationEvidence.supportedHook,
    applyErrorCode: error.code,
    remotePreserved: remoteBeforeHash === remoteAfterHash,
    blockerHash: digest({
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      driver: blocker.driver,
      pluginOwner: blocker.pluginOwner,
      dryRunValidationEvidence: blocker.dryRunValidationEvidence,
      change: {
        localChange: blocker.change.localChange,
        remoteChange: blocker.change.remoteChange,
        baseHash: blocker.change.base.hash,
        localHash: blocker.change.local.hash,
        remoteHash: blocker.change.remote.hash,
      },
    }),
  };
}

function assertSupportedDryRunHookCase(testCase) {
  const plan = planFor(testCase);
  const mutation = mutationFor(plan, testCase.dataResourceKey);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.preconditions.length, 1);
  assert.ok(mutation, 'supported dry-run hook case should plan a plugin-owned mutation');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.resourceKey, testCase.dataResourceKey);
  assert.equal(mutation.pluginOwnedResource.pluginOwner, testCase.plugin);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
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
  assertChangeEvidenceIsHashOnly(mutation.change);
  assertNoPrivateMarkers(mutation.pluginOwnedResource, testCase);

  const result = applyPlan(cloneJson(testCase.remote), plan);
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_options[testCase.dataRowId].option_value.mode, testCase.expected.appliedMode);
  assert.deepEqual(result.site.plugins[testCase.plugin], testCase.expected.plugin);
  assertNoPrivateMarkers(result.journal, testCase);

  const evidence = supportedEvidence(testCase, plan, mutation, result);
  assert.match(evidence.mutationHash, sha256Pattern);
  assertNoPrivateMarkers(evidence, testCase);
  return evidence;
}

function assertUnsupportedDryRunHookCase(testCase) {
  const plan = planFor(testCase);
  const mutation = mutationFor(plan, testCase.dataResourceKey);
  const blocker = blockerFor(plan, testCase.dataResourceKey);
  const remote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remote);
  const error = captureError(() => applyPlan(remote, plan));
  const remoteAfterHash = digest(remote);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.blockers, 1);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(mutation, undefined);
  assert.ok(blocker, 'unsupported dry-run hook case should expose a blocker');
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.reason, 'Plugin-owned resource driver dry-run validation hook is not supported.');
  assert.equal(blocker.pluginOwner, testCase.plugin);
  assert.equal(blocker.driver, 'wp-option');
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
  assertChangeEvidenceIsHashOnly(blocker.change);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.deepEqual(error.details, { status: 'blocked' });
  assert.equal(remoteAfterHash, remoteBeforeHash);
  assert.equal(remote.db.wp_options[testCase.dataRowId].option_value.token, testCase.expected.remoteToken);
  assertNoPrivateMarkers(blocker, testCase);
  assertNoPrivateMarkers(error.details, testCase);

  const evidence = unsupportedEvidence(testCase, plan, blocker, error, remoteBeforeHash, remoteAfterHash);
  assert.match(evidence.blockerHash, sha256Pattern);
  assert.equal(evidence.remotePreserved, true);
  assertNoPrivateMarkers(evidence, testCase);
  return evidence;
}

function assertDryRunHookCase(testCase) {
  if (testCase.variant === 'supported-dry-run-hook-applies') {
    return assertSupportedDryRunHookCase(testCase);
  }

  assert.equal(testCase.variant, 'unsupported-dry-run-hook-blocked');
  return assertUnsupportedDryRunHookCase(testCase);
}

test('RPP-0477 generated driver dry-run validation hook harness covers supported and unsupported v4 variants', () => {
  const cases = generateDriverDryRunValidationHookCases();

  assertCommonGeneratedCaseShape(cases);

  const results = cases.map(assertDryRunHookCase);
  const outcomes = Object.fromEntries(results.map((result) => [result.variant, result.outcome]));
  assert.deepEqual(outcomes, {
    'supported-dry-run-hook-applies': 'applied-supported-hook',
    'unsupported-dry-run-hook-blocked': 'blocked-unsupported-hook',
  });

  const evidence = {
    rpp: 'RPP-0477',
    evidenceSource: 'generated-push-harness-driver-dry-run-validation-hook-v4',
    evidenceScope: 'local-generated-focused',
    productionBacked: false,
    releaseGate: 'NO-GO',
    supportedVariants: results.filter((result) => result.supportedHook === true).length,
    unsupportedVariants: results.filter((result) => result.supportedHook === false).length,
    resultHash: digest(results),
    results,
  };

  assert.equal(evidence.supportedVariants, 1);
  assert.equal(evidence.unsupportedVariants, 1);
  assert.match(evidence.resultHash, sha256Pattern);
  for (const testCase of cases) {
    assertNoPrivateMarkers(evidence, testCase);
  }
});
