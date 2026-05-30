import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import {
  generateDriverOwnerIdentityBindingCases,
  validateDriverOwnerIdentityBindingCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const ownerIdentityVariants = Object.freeze([
  'supported-exact-owner-policy',
  'unsupported-wrong-policy-owner',
  'unsupported-missing-owner-policy',
  'unsupported-local-owner-drift',
  'unsupported-stale-owner-context',
]);
const expectedOutcomes = Object.freeze({
  'supported-exact-owner-policy': 'ready',
  'unsupported-wrong-policy-owner': 'planner-blocked',
  'unsupported-missing-owner-policy': 'planner-blocked',
  'unsupported-local-owner-drift': 'apply-refused',
  'unsupported-stale-owner-context': 'planner-blocked',
});
const sha256Pattern = /^[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
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
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function blockerFor(plan, resourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey) || null;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertNoPrivateMarkers(cases, evidence) {
  const serialized = JSON.stringify(evidence);
  for (const testCase of cases) {
    for (const marker of testCase.secretTokens) {
      assert.equal(
        serialized.includes(marker),
        false,
        `${testCase.variant} leaked generated private marker ${marker}`,
      );
    }
  }
}

function countBy(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function plannerRefusalEvidence(testCase, plan, blocker) {
  const remote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remote);
  const error = captureError(() => applyPlan(remote, plan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');

  const remoteAfterHash = digest(remote);
  return {
    stage: 'planner',
    code: error.code,
    remoteUnchanged: remoteAfterHash === remoteBeforeHash,
    remoteBeforeHash,
    remoteAfterHash,
    blockerClass: blocker?.class || null,
    reasonCode: blocker?.reasonCode
      || blocker?.ownerMetadataRefusalEvidence?.reasonCode
      || blocker?.unknownPluginOwnedResourceRefusalEvidence?.reasonCode
      || null,
    blockerHash: blocker ? digest(blocker) : null,
    refusalHash: digest(error.details || {}),
  };
}

function applyRefusalEvidence(testCase, plan) {
  const remote = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remote);
  const error = captureError(() => applyPlan(remote, plan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');

  const remoteAfterHash = digest(remote);
  return {
    stage: 'apply',
    code: error.code,
    remoteUnchanged: remoteAfterHash === remoteBeforeHash,
    remoteBeforeHash,
    remoteAfterHash,
    pluginOwner: error.details?.pluginOwner || null,
    driver: error.details?.driver || null,
    reasonCode: error.details?.applyValidationEvidence?.reasonCode || null,
    refusalHash: digest(error.details || {}),
  };
}

function supportedApplyEvidence(testCase, plan) {
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  assert.equal(applied.appliedMutations, 1);
  return {
    appliedMutations: applied.appliedMutations,
    appliedRowHash: digest(applied.site.db.wp_options[testCase.rowId]),
    journalHash: digest(applied.journal),
  };
}

function releaseVerifierCaseEvidence(testCase, generatedResult) {
  const plan = planFor(testCase);
  const mutation = mutationFor(plan, testCase.resourceKey);
  const blocker = blockerFor(plan, testCase.resourceKey);
  const supported = generatedResult.outcome === 'ready';
  const failClosed = supported
    ? null
    : generatedResult.outcome === 'apply-refused'
      ? applyRefusalEvidence(testCase, plan)
      : plannerRefusalEvidence(testCase, plan, blocker);

  const evidence = {
    id: testCase.id,
    variant: testCase.variant,
    family: testCase.family,
    generatedHarnessOutcome: generatedResult.outcome,
    generatedHarnessProofHash: generatedResult.proofHash,
    releaseVerifierCheck: 'driver-owner-identity-binding',
    status: plan.status,
    mutationCount: plan.mutations.length,
    blockerCount: plan.blockers.length,
    ownerIdentityBinding: {
      supported,
      pluginOwner: mutation?.pluginOwnedResource?.pluginOwner
        || blocker?.pluginOwner
        || failClosed?.pluginOwner
        || null,
      driver: mutation?.pluginOwnedResource?.driver
        || blocker?.driver
        || failClosed?.driver
        || null,
      policySource: mutation?.pluginOwnedResource?.policySource || blocker?.policySource || null,
      ownerContextRequired: mutation?.pluginOwnedResource?.ownerContextRequired === true,
      exactOwnerDriver: mutation?.pluginOwnedResource?.pluginOwner === 'forms'
        && mutation?.pluginOwnedResource?.driver === 'wp-option',
    },
    hashes: {
      planHash: digest(plan),
      mutationHash: mutation ? digest(mutation) : null,
      blockerHash: blocker ? digest(blocker) : null,
      generatedResultHash: digest(generatedResult),
    },
    apply: supported ? supportedApplyEvidence(testCase, plan) : null,
    failClosed,
  };

  assertNoPrivateMarkers([testCase], evidence);
  return evidence;
}

function buildReleaseVerifierCarryThrough(cases, generatedResults) {
  const variantEvidence = cases.map((testCase) => {
    const result = generatedResults.find((entry) => entry.id === testCase.id);
    assert.ok(result, `missing generated result for ${testCase.id}`);
    return releaseVerifierCaseEvidence(testCase, result);
  });
  const outcomes = Object.fromEntries(
    variantEvidence.map((entry) => [entry.variant, entry.generatedHarnessOutcome]),
  );
  const supportedVariants = variantEvidence.filter((entry) => entry.ownerIdentityBinding.supported);
  const unsupportedVariants = variantEvidence.filter((entry) => !entry.ownerIdentityBinding.supported);
  const failClosedVariants = unsupportedVariants.filter((entry) => entry.failClosed?.remoteUnchanged === true);

  const proof = {
    rpp: 'RPP-0482',
    evidenceScope: 'local-generated-release-verifier',
    evidenceSource: 'release-verifier-driver-owner-identity-binding-v5',
    checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      acceptedForReleaseGate: false,
      reason: 'local generated owner identity binding proof carried through release-verifier evidence only',
    },
    releaseVerifier: {
      check: 'plugin-driver-owner-identity-binding',
      generatedHarnessCovered: true,
      supportedVariants: supportedVariants.length,
      unsupportedVariants: unsupportedVariants.length,
      failClosedUnsupportedVariants: failClosedVariants.length,
      outcomes,
      outcomeCounts: countBy(variantEvidence.map((entry) => entry.generatedHarnessOutcome)),
      variantSetHash: sha256Evidence(variantEvidence.map((entry) => ({
        variant: entry.variant,
        outcome: entry.generatedHarnessOutcome,
        status: entry.status,
        ownerIdentityBinding: entry.ownerIdentityBinding,
        failClosed: entry.failClosed
          ? {
              stage: entry.failClosed.stage,
              code: entry.failClosed.code,
              remoteUnchanged: entry.failClosed.remoteUnchanged,
              reasonCode: entry.failClosed.reasonCode,
            }
          : null,
      }))),
    },
    variants: variantEvidence,
  };
  proof.proofHash = sha256Evidence({
    releaseVerifier: proof.releaseVerifier,
    variants: proof.variants.map((entry) => ({
      variant: entry.variant,
      generatedHarnessOutcome: entry.generatedHarnessOutcome,
      hashes: entry.hashes,
      failClosed: entry.failClosed
        ? {
            stage: entry.failClosed.stage,
            code: entry.failClosed.code,
            remoteUnchanged: entry.failClosed.remoteUnchanged,
            reasonCode: entry.failClosed.reasonCode,
          }
        : null,
    })),
  });

  assertNoPrivateMarkers(cases, proof);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0482 release verifier proof' }));
  return proof;
}

test('RPP-0482 carries generated driver owner identity variants through release-verifier evidence', () => {
  const cases = generateDriverOwnerIdentityBindingCases();
  const generatedResults = cases.map(validateDriverOwnerIdentityBindingCase);
  const proof = buildReleaseVerifierCarryThrough(cases, generatedResults);

  assert.deepEqual(cases.map((testCase) => testCase.variant), ownerIdentityVariants);
  assert.equal(cases.every((testCase) => testCase.family === 'driver-owner-identity-binding'), true);
  assert.equal(cases.every((testCase) => testCase.tags.has('plugin-owned-generated')), true);
  assert.equal(cases.filter((testCase) => testCase.tags.has('driver-owner-identity-supported')).length, 1);
  assert.equal(cases.filter((testCase) => testCase.tags.has('driver-owner-identity-unsupported')).length, 4);
  assert.deepEqual(proof.releaseVerifier.outcomes, expectedOutcomes);
  assert.deepEqual(proof.releaseVerifier.outcomeCounts, {
    ready: 1,
    'planner-blocked': 3,
    'apply-refused': 1,
  });
  assert.equal(proof.releaseVerifier.supportedVariants, 1);
  assert.equal(proof.releaseVerifier.unsupportedVariants, 4);
  assert.equal(proof.releaseVerifier.failClosedUnsupportedVariants, 4);
  assert.equal(proof.releaseVerifier.generatedHarnessCovered, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseGate.status, 'NO-GO');
  assert.equal(proof.releaseGate.acceptedForReleaseGate, false);
  assert.match(proof.releaseVerifier.variantSetHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.proofHash, /^sha256:[a-f0-9]{64}$/);

  for (const result of generatedResults) {
    assert.match(result.proofHash, sha256Pattern);
    assert.equal(result.outcome, expectedOutcomes[result.variant]);
  }
});

test('RPP-0482 release-verifier evidence keeps exact owner and driver on the supported path', () => {
  const cases = generateDriverOwnerIdentityBindingCases();
  const generatedResults = cases.map(validateDriverOwnerIdentityBindingCase);
  const proof = buildReleaseVerifierCarryThrough(cases, generatedResults);
  const supported = proof.variants.find((entry) => entry.variant === 'supported-exact-owner-policy');

  assert.ok(supported);
  assert.equal(supported.status, 'ready');
  assert.equal(supported.mutationCount, 1);
  assert.equal(supported.blockerCount, 0);
  assert.deepEqual(supported.ownerIdentityBinding, {
    supported: true,
    pluginOwner: 'forms',
    driver: 'wp-option',
    policySource: 'local-snapshot',
    ownerContextRequired: true,
    exactOwnerDriver: true,
  });
  assert.equal(supported.apply.appliedMutations, 1);
  assert.match(supported.apply.appliedRowHash, sha256Pattern);
  assert.match(supported.apply.journalHash, sha256Pattern);
  assert.match(supported.hashes.planHash, sha256Pattern);
  assert.match(supported.hashes.mutationHash, sha256Pattern);
  assert.equal(supported.hashes.blockerHash, null);
  assert.equal(supported.failClosed, null);
  assertNoPrivateMarkers(cases, proof);
});

test('RPP-0482 release-verifier evidence keeps unsupported owner variants fail-closed', () => {
  const cases = generateDriverOwnerIdentityBindingCases();
  const generatedResults = cases.map(validateDriverOwnerIdentityBindingCase);
  const proof = buildReleaseVerifierCarryThrough(cases, generatedResults);
  const byVariant = Object.fromEntries(proof.variants.map((entry) => [entry.variant, entry]));

  assert.equal(byVariant['unsupported-wrong-policy-owner'].status, 'blocked');
  assert.equal(byVariant['unsupported-wrong-policy-owner'].failClosed.stage, 'planner');
  assert.equal(byVariant['unsupported-wrong-policy-owner'].failClosed.code, 'PLAN_NOT_READY');
  assert.equal(byVariant['unsupported-wrong-policy-owner'].failClosed.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(byVariant['unsupported-wrong-policy-owner'].failClosed.remoteUnchanged, true);
  assert.equal(byVariant['unsupported-wrong-policy-owner'].ownerIdentityBinding.driver, null);

  assert.equal(byVariant['unsupported-missing-owner-policy'].status, 'blocked');
  assert.equal(byVariant['unsupported-missing-owner-policy'].failClosed.stage, 'planner');
  assert.equal(byVariant['unsupported-missing-owner-policy'].failClosed.code, 'PLAN_NOT_READY');
  assert.equal(byVariant['unsupported-missing-owner-policy'].failClosed.reasonCode, 'UNKNOWN_PLUGIN_OWNED_RESOURCE');
  assert.equal(byVariant['unsupported-missing-owner-policy'].failClosed.remoteUnchanged, true);
  assert.equal(byVariant['unsupported-missing-owner-policy'].ownerIdentityBinding.driver, null);

  assert.equal(byVariant['unsupported-local-owner-drift'].status, 'ready');
  assert.equal(byVariant['unsupported-local-owner-drift'].mutationCount, 1);
  assert.equal(byVariant['unsupported-local-owner-drift'].failClosed.stage, 'apply');
  assert.equal(byVariant['unsupported-local-owner-drift'].failClosed.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(
    byVariant['unsupported-local-owner-drift'].failClosed.reasonCode,
    'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED',
  );
  assert.equal(byVariant['unsupported-local-owner-drift'].failClosed.pluginOwner, 'forms-impostor');
  assert.equal(byVariant['unsupported-local-owner-drift'].failClosed.driver, 'wp-option');
  assert.equal(byVariant['unsupported-local-owner-drift'].failClosed.remoteUnchanged, true);

  assert.equal(byVariant['unsupported-stale-owner-context'].status, 'blocked');
  assert.equal(byVariant['unsupported-stale-owner-context'].failClosed.stage, 'planner');
  assert.equal(byVariant['unsupported-stale-owner-context'].failClosed.code, 'PLAN_NOT_READY');
  assert.equal(
    byVariant['unsupported-stale-owner-context'].failClosed.reasonCode,
    'STALE_PLUGIN_METADATA_OWNER_CONTEXT',
  );
  assert.equal(byVariant['unsupported-stale-owner-context'].failClosed.remoteUnchanged, true);

  for (const variant of ownerIdentityVariants.slice(1)) {
    assert.match(byVariant[variant].failClosed.remoteBeforeHash, sha256Pattern);
    assert.match(byVariant[variant].failClosed.remoteAfterHash, sha256Pattern);
    assert.match(byVariant[variant].failClosed.refusalHash, sha256Pattern);
    assert.equal(
      byVariant[variant].failClosed.remoteAfterHash,
      byVariant[variant].failClosed.remoteBeforeHash,
      `${variant} changed the remote after release-verifier refusal`,
    );
  }
  assertNoPrivateMarkers(cases, proof);
});
