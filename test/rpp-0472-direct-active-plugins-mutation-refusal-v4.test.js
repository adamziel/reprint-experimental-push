import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { getResource, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generateDirectActivePluginsMutationRefusalCases,
  validateDirectActivePluginsMutationRefusalCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const activePluginsResource = Object.freeze({
  type: 'row',
  table: 'wp_options',
  id: 'option_name:active_plugins',
  key: 'row:["wp_options","option_name:active_plugins"]',
});
const directActivePluginsVariants = Object.freeze([
  'supported-plugin-managed-option-applies',
  'unsupported-direct-active-plugins-blocked',
  'forged-ready-active-plugins-rejected-before-mutation',
]);
const sha256Hex = /^[a-f0-9]{64}$/;
const sha256Evidence = /^sha256:[a-f0-9]{64}$/;

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

function assertHashOnlyChange(change) {
  assert.ok(change);
  for (const side of ['base', 'local', 'remote']) {
    assert.ok(['present', 'absent'].includes(change[side].state));
    assert.match(change[side].hash, sha256Hex);
    assert.equal(Object.hasOwn(change[side], 'value'), false);
  }
}

function assertNoGeneratedSecrets(testCaseOrCases, evidence) {
  const cases = Array.isArray(testCaseOrCases) ? testCaseOrCases : [testCaseOrCases];
  const json = JSON.stringify(evidence);
  for (const testCase of cases) {
    for (const secret of testCase.secretTokens) {
      assert.equal(json.includes(secret), false, `${testCase.variant} leaked generated secret ${secret}`);
    }
  }
}

function assertNoRawEvidence(value, label) {
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

test('RPP-0472 generated direct active_plugins mutation refusal covers supported and unsupported variants', () => {
  const cases = generateDirectActivePluginsMutationRefusalCases();

  assert.deepEqual(cases.map((testCase) => testCase.variant), directActivePluginsVariants);
  assert.equal(cases.every((testCase) => testCase.family === 'direct-active-plugins-mutation-refusal'), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('direct-active-plugins-mutation-refusal')), true);
  assert.equal(cases.every((testCase) => testCase.activePluginsResourceKey === activePluginsResource.key), true);
  assert.equal(cases.filter((testCase) => testCase.tags.has('direct-active-plugins-supported-managed-path')).length, 1);
  assert.equal(cases.filter((testCase) => testCase.tags.has('direct-active-plugins-unsupported')).length, 2);

  const results = cases.map(validateDirectActivePluginsMutationRefusalCase);
  const outcomes = Object.fromEntries(results.map((result) => [result.variant, result.outcome]));
  assert.deepEqual(outcomes, {
    'supported-plugin-managed-option-applies': 'applied-supported-plugin-managed-path',
    'unsupported-direct-active-plugins-blocked': 'blocked-direct-active-plugins',
    'forged-ready-active-plugins-rejected-before-mutation': 'rejected-forged-direct-active-plugins',
  });

  const byVariant = Object.fromEntries(results.map((result) => [result.variant, result]));
  assert.equal(byVariant['supported-plugin-managed-option-applies'].status, 'ready');
  assert.equal(byVariant['supported-plugin-managed-option-applies'].appliedMutations, 1);
  assert.equal(byVariant['supported-plugin-managed-option-applies'].activePluginsPreserved, true);
  assert.equal(byVariant['unsupported-direct-active-plugins-blocked'].status, 'blocked');
  assert.equal(byVariant['unsupported-direct-active-plugins-blocked'].mutations, 0);
  assert.equal(byVariant['unsupported-direct-active-plugins-blocked'].remotePreserved, true);
  assert.equal(
    byVariant['forged-ready-active-plugins-rejected-before-mutation'].rejectionCode,
    'UNSUPPORTED_ACTIVE_PLUGINS_MUTATION',
  );
  assert.equal(byVariant['forged-ready-active-plugins-rejected-before-mutation'].beforeMutationCalls, 0);

  const proof = {
    rpp: 'RPP-0472',
    evidenceSource: 'local-generated-direct-active-plugins-mutation-refusal-v4',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    variants: results.map((result) => ({
      variant: result.variant,
      outcome: result.outcome,
      status: result.status,
      mutations: result.mutations,
      blockers: result.blockers,
      proofHash: `sha256:${result.proofHash}`,
    })),
  };
  proof.proofHash = `sha256:${digest(proof.variants)}`;

  for (const result of results) {
    assert.equal(result.evidenceScope, 'local-generated');
    assert.equal(result.productionBacked, false);
    assert.equal(result.releaseGate, 'NO-GO');
    assert.match(result.proofHash, sha256Hex);
  }
  for (const variantProof of proof.variants) {
    assert.match(variantProof.proofHash, sha256Evidence);
  }
  assert.match(proof.proofHash, sha256Evidence);
  assertNoGeneratedSecrets(cases, proof);
  assertNoRawEvidence(proof, 'RPP-0472 aggregate proof');
});

test('RPP-0472 supported plugin-managed option remains distinct from direct active_plugins', () => {
  const testCase = generateDirectActivePluginsMutationRefusalCases()
    .find((candidate) => candidate.variant === 'supported-plugin-managed-option-applies');
  const plan = planFor(testCase);
  const managedMutation = mutationFor(plan, testCase.dataResourceKey);
  const activePluginsBefore = getResource(testCase.remote, activePluginsResource);
  const activePluginsBeforeHash = resourceHash(testCase.remote, activePluginsResource);
  const applied = applyPlan(cloneJson(testCase.remote), plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.blockers.length, 0);
  assert.equal(mutationFor(plan, testCase.activePluginsResourceKey), undefined);
  assert.ok(managedMutation, 'supported case should plan the plugin-managed option only');
  assert.equal(managedMutation.resourceKey, testCase.dataResourceKey);
  assert.equal(managedMutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(managedMutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(managedMutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(managedMutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(managedMutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assertHashOnlyChange(managedMutation.change);

  assert.equal(applied.appliedMutations, 1);
  assert.equal(applied.site.db.wp_options[testCase.dataRowId].option_value.mode, testCase.expected.appliedMode);
  assert.deepEqual(getResource(applied.site, activePluginsResource), activePluginsBefore);
  assert.equal(resourceHash(applied.site, activePluginsResource), activePluginsBeforeHash);
  assertNoGeneratedSecrets(testCase, managedMutation.pluginOwnedResource);
  assertNoGeneratedSecrets(testCase, applied.journal);
  assertNoRawEvidence(managedMutation.pluginOwnedResource.auditEvidence, 'RPP-0472 supported audit evidence');
  assertNoRawEvidence(managedMutation.pluginOwnedResource.driverAuditEvidence, 'RPP-0472 supported driver evidence');
  assertNoRawEvidence(applied.journal, 'RPP-0472 supported apply journal');
});

test('RPP-0472 direct active_plugins mutation refuses before apply and stays hash-only', () => {
  const cases = generateDirectActivePluginsMutationRefusalCases();
  const blockedCase = cases.find((candidate) => candidate.variant === 'unsupported-direct-active-plugins-blocked');
  const forgedCase = cases.find((candidate) =>
    candidate.variant === 'forged-ready-active-plugins-rejected-before-mutation');
  const plan = planFor(blockedCase);
  const blocker = blockerFor(plan, blockedCase.activePluginsResourceKey);
  const remote = cloneJson(blockedCase.remote);
  const remoteBeforeHash = digest(remote);
  const activePluginsBeforeHash = resourceHash(remote, activePluginsResource);
  let beforeMutationCalls = 0;
  const blockedError = captureError(() => applyPlan(remote, plan, {
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const forgedResult = validateDirectActivePluginsMutationRefusalCase(forgedCase);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.preconditions.length, 0);
  assert.equal(mutationFor(plan, blockedCase.activePluginsResourceKey), undefined);
  assert.ok(blocker, 'direct active_plugins mutation should expose a blocker');
  assert.equal(blocker.class, 'unsupported-active-plugins-direct-mutation');
  assert.equal(blocker.reasonCode, 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED');
  assert.equal(blocker.requiredDriver, 'plugin-activation-driver');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-active-plugins-and-stop');
  assert.equal(blocker.change.localChange, 'update');
  assert.equal(blocker.change.remoteChange, 'unchanged');
  assertHashOnlyChange(blocker.change);

  assert.ok(blockedError instanceof PushPlanError);
  assert.equal(blockedError.code, 'PLAN_NOT_READY');
  assert.equal(beforeMutationCalls, 0);
  assert.equal(digest(remote), remoteBeforeHash);
  assert.equal(resourceHash(remote, activePluginsResource), activePluginsBeforeHash);
  assert.equal(forgedResult.outcome, 'rejected-forged-direct-active-plugins');
  assert.equal(forgedResult.rejectionCode, 'UNSUPPORTED_ACTIVE_PLUGINS_MUTATION');
  assert.equal(forgedResult.beforeMutationCalls, 0);
  assert.equal(forgedResult.remotePreserved, true);

  assertNoGeneratedSecrets(blockedCase, blocker);
  assertNoGeneratedSecrets(blockedCase, blockedError.details);
  assertNoGeneratedSecrets(forgedCase, forgedResult);
  assertNoRawEvidence(blocker, 'RPP-0472 active_plugins blocker');
  assertNoRawEvidence(blockedError.details, 'RPP-0472 active_plugins blocked error');
  assertNoRawEvidence(forgedResult, 'RPP-0472 active_plugins forged result');
});
