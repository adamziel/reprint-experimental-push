import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  driverDryRunValidationHookReleaseVerifierBoundary,
  summarizeDriverDryRunValidationHookReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtureMarkers = [
  'rpp-0497-base-dry-run-validation-hook',
  'rpp-0497-local-dry-run-validation-hook',
  'rpp-0497-unsupported-dry-run-validation-hook',
];

function assertHash(value, label) {
  assert.match(value, sha256EvidencePattern, label);
}

function assertNoRawFixtureEvidence(value) {
  const serialized = JSON.stringify(value);
  for (const marker of rawFixtureMarkers) {
    assert.equal(serialized.includes(marker), false, `release-verifier evidence leaked ${marker}`);
  }
  assert.equal(serialized.includes('option_value'), false, 'release-verifier evidence exposed option_value');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(value, { label: 'RPP-0497 release verifier proof' }));
}

test('RPP-0497 release verifier carries driver dry-run validation hook variants as hash-only evidence', () => {
  const proof = summarizeDriverDryRunValidationHookReleaseVerifierProof({
    now: new Date('2026-05-30T11:49:07.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0497');
  assert.equal(proof.evidenceSource, 'release-verifier-driver-dry-run-validation-hook-v5');
  assert.equal(proof.evidenceScope, 'local-generated-release-verifier');
  assert.equal(proof.checkedBy, 'scripts/playground/production-shaped-release-verify.mjs');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'DRIVER_DRY_RUN_VALIDATION_HOOK_SUPPORT_ONLY');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate.status, 'NO-GO');
  assert.equal(proof.releaseGate.verdict, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(proof.releaseGate.acceptedForReleaseGate, false);
  assert.equal(proof.driver, 'wp-option');
  assert.equal(proof.owner, 'forms');
  assert.deepEqual(proof.resource, {
    resourceKey: driverDryRunValidationHookReleaseVerifierBoundary.resourceKey,
    table: 'wp_options',
    rowId: 'option_name:rpp_0497_forms_settings',
  });

  assert.deepEqual(proof.variants.map((entry) => entry.variant), [
    'supported-dry-run-hook-applies',
    'unsupported-dry-run-hook-blocked',
  ]);
  assert.equal(proof.releaseVerifier.check, 'plugin-driver-dry-run-validation-hook');
  assert.equal(proof.releaseVerifier.generatedHarnessCovered, true);
  assert.equal(proof.releaseVerifier.supportedVariants, 1);
  assert.equal(proof.releaseVerifier.unsupportedVariants, 1);
  assert.equal(proof.releaseVerifier.failClosedUnsupportedVariants, 1);
  assert.deepEqual(proof.releaseVerifier.outcomes, {
    'supported-dry-run-hook-applies': 'applied-supported-hook',
    'unsupported-dry-run-hook-blocked': 'blocked-unsupported-hook',
  });
  assert.deepEqual(proof.releaseVerifier.outcomeCounts, {
    'applied-supported-hook': 1,
    'blocked-unsupported-hook': 1,
  });
  assertHash(proof.releaseVerifier.variantSetHash, 'variant set hash');
  assertHash(proof.proofHash, 'proof hash');
  assertNoRawFixtureEvidence(proof);
});

test('RPP-0497 release verifier records exact supported dry-run hook apply evidence', () => {
  const proof = summarizeDriverDryRunValidationHookReleaseVerifierProof();
  const supported = proof.variants.find((entry) => entry.variant === 'supported-dry-run-hook-applies');

  assert.ok(supported);
  assert.equal(supported.status, 'ready');
  assert.equal(supported.outcome, 'applied-supported-hook');
  assert.equal(supported.plan.mutationCount, 1);
  assert.equal(supported.plan.blockerCount, 0);
  assert.equal(supported.plan.preconditionCount, 1);
  assert.equal(supported.driverDryRunValidation.supported, true);
  assert.equal(supported.driverDryRunValidation.pluginOwner, 'forms');
  assert.equal(supported.driverDryRunValidation.driver, 'wp-option');
  assert.equal(supported.driverDryRunValidation.policySource, 'local-snapshot');
  assert.equal(supported.driverDryRunValidation.hook, 'wp-option:validate-row');
  assert.equal(
    supported.driverDryRunValidation.reasonCode,
    'PLUGIN_DRIVER_DRY_RUN_VALIDATION_PASSED',
  );
  assert.equal(supported.driverDryRunValidation.operation, 'dry-run-validation');
  assert.equal(supported.driverDryRunValidation.supportedHook, true);
  assert.equal(supported.driverDryRunValidation.status, 'passed');
  assert.equal(supported.mutationBoundary.resourceKey, driverDryRunValidationHookReleaseVerifierBoundary.resourceKey);
  assert.equal(supported.mutationBoundary.action, 'put');
  assert.equal(supported.mutationBoundary.changeKind, 'update');
  assert.equal(supported.mutationBoundary.pluginOwner, 'forms');
  assert.equal(supported.mutationBoundary.driver, 'wp-option');
  assert.equal(supported.apply.appliedMutations, 1);
  assertHash(supported.plan.hash, 'supported plan hash');
  assertHash(supported.driverDryRunValidation.evidenceHash, 'supported dry-run validation hash');
  assertHash(supported.hashes.planHash, 'supported plan duplicate hash');
  assertHash(supported.hashes.mutationHash, 'supported mutation hash');
  assert.equal(supported.hashes.blockerHash, null);
  assertHash(supported.apply.appliedRowHash, 'supported applied row hash');
  assertHash(supported.apply.journalHash, 'supported journal hash');
  assert.equal(supported.failClosed, null);
  assertNoRawFixtureEvidence(supported);
});

test('RPP-0497 release verifier keeps unsupported dry-run hook fail-closed before mutation', () => {
  const proof = summarizeDriverDryRunValidationHookReleaseVerifierProof();
  const unsupported = proof.variants.find((entry) => entry.variant === 'unsupported-dry-run-hook-blocked');

  assert.ok(unsupported);
  assert.equal(unsupported.status, 'blocked');
  assert.equal(unsupported.outcome, 'blocked-unsupported-hook');
  assert.equal(unsupported.plan.mutationCount, 0);
  assert.equal(unsupported.plan.blockerCount, 1);
  assert.equal(unsupported.plan.preconditionCount, 0);
  assert.equal(unsupported.driverDryRunValidation.supported, false);
  assert.equal(unsupported.driverDryRunValidation.pluginOwner, 'forms');
  assert.equal(unsupported.driverDryRunValidation.driver, 'wp-option');
  assert.equal(unsupported.driverDryRunValidation.policySource, 'local-snapshot');
  assert.equal(unsupported.driverDryRunValidation.hook, 'wp-option:unsupported-dry-run');
  assert.equal(
    unsupported.driverDryRunValidation.reasonCode,
    'PLUGIN_DRIVER_DRY_RUN_VALIDATION_UNSUPPORTED',
  );
  assert.equal(unsupported.driverDryRunValidation.operation, 'refuse-before-mutation');
  assert.equal(unsupported.driverDryRunValidation.supportedHook, false);
  assert.equal(unsupported.driverDryRunValidation.status, 'passed');
  assert.equal(unsupported.mutationBoundary, null);
  assert.equal(unsupported.apply, null);
  assert.equal(unsupported.failClosed.stage, 'planner');
  assert.equal(unsupported.failClosed.code, 'PLAN_NOT_READY');
  assert.equal(unsupported.failClosed.remoteUnchanged, true);
  assert.equal(unsupported.failClosed.remoteAfterHash, unsupported.failClosed.remoteBeforeHash);
  assert.equal(unsupported.failClosed.reasonCode, 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_UNSUPPORTED');
  assert.equal(unsupported.failClosed.blockerClass, 'unsupported-plugin-owned-resource');
  assertHash(unsupported.plan.hash, 'unsupported plan hash');
  assertHash(unsupported.driverDryRunValidation.evidenceHash, 'unsupported dry-run validation hash');
  assertHash(unsupported.hashes.planHash, 'unsupported plan duplicate hash');
  assert.equal(unsupported.hashes.mutationHash, null);
  assertHash(unsupported.hashes.blockerHash, 'unsupported blocker hash');
  assertHash(unsupported.failClosed.remoteBeforeHash, 'unsupported remote before hash');
  assertHash(unsupported.failClosed.remoteAfterHash, 'unsupported remote after hash');
  assertHash(unsupported.failClosed.blockerHash, 'unsupported fail-closed blocker hash');
  assertHash(unsupported.failClosed.refusalHash, 'unsupported refusal hash');
  assertNoRawFixtureEvidence(unsupported);
});

test('RPP-0497 production-shaped release verifier carries dry-run hook proof into pluginDriver evidence', () => {
  const verifierSource = fs.readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(verifierSource, /export function summarizeDriverDryRunValidationHookReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /dryRunValidationHook: summarizeDriverDryRunValidationHookReleaseVerifierProof\(\)/,
  );
  assert.match(verifierSource, /DRIVER_DRY_RUN_VALIDATION_HOOK_SUPPORT_ONLY/);
});
