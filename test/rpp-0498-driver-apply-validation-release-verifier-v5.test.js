import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  driverApplyValidationHookReleaseVerifierBoundary,
  summarizeDriverApplyValidationHookReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'rpp-0498-base-private-apply-validation-mode',
  'rpp-0498-base-private-apply-validation-token',
  'rpp-0498-local-private-apply-validation-mode',
  'rpp-0498-local-private-apply-validation-token',
]);

function assertNoRawFixtures(value, label = 'RPP-0498 release verifier evidence') {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked ${raw}`);
  }
  assert.equal(serialized.includes('option_value'), false, `${label} exposed raw option_value fields`);
}

test('RPP-0498 release verifier carries driver apply validation hook through one local mutation apply', () => {
  const boundary = driverApplyValidationHookReleaseVerifierBoundary;
  const proof = summarizeDriverApplyValidationHookReleaseVerifierProof({
    now: new Date('2026-05-30T13:49:08.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0498');
  assert.equal(proof.evidenceSource, 'release-verifier-driver-apply-validation-hook-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'DRIVER_APPLY_VALIDATION_HOOK_MUTATION_APPLIED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.equal(proof.driver, 'wp-option');
  assert.equal(proof.owner, 'forms');
  assert.deepEqual(proof.resource, {
    resourceKey: boundary.resourceKey,
    table: 'wp_options',
    rowId: 'option_name:rpp_0498_forms_apply_validation',
  });
  assert.deepEqual(proof.allowlist, {
    resourceKey: boundary.resourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    supportsDelete: false,
    policySource: 'local-snapshot',
    applyValidation: {
      hook: 'wp-option:validate-apply',
      status: 'passed',
    },
  });

  assert.equal(proof.plan.status, 'ready');
  assert.deepEqual(proof.plan.summary, {
    mutations: 1,
    conflicts: 0,
    blockers: 0,
  });
  assert.equal(proof.plan.mutationCount, 1);
  assert.equal(proof.plan.preconditionCount, 1);
  assert.match(proof.plan.hash, sha256EvidencePattern);

  assert.equal(proof.mutationBoundary.resourceKey, boundary.resourceKey);
  assert.equal(proof.mutationBoundary.action, 'put');
  assert.equal(proof.mutationBoundary.changeKind, 'update');
  assert.equal(proof.mutationBoundary.pluginOwner, 'forms');
  assert.equal(proof.mutationBoundary.driver, 'wp-option');
  assert.equal(proof.mutationBoundary.policySource, 'local-snapshot');
  assert.equal(proof.mutationBoundary.supportsDelete, false);
  assert.equal(proof.mutationBoundary.exactMutation, true);
  assert.match(proof.mutationBoundary.baseHash, sha256Pattern);
  assert.match(proof.mutationBoundary.localHash, sha256Pattern);
  assert.match(proof.mutationBoundary.remoteBeforeHash, sha256Pattern);
  assert.match(proof.mutationBoundary.auditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.mutationBoundary.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.mutationBoundary.applyValidationEvidenceHash, sha256EvidencePattern);
  assert.match(proof.mutationBoundary.mutationHash, sha256EvidencePattern);
  assert.deepEqual(proof.mutationBoundary.applyValidationEvidence, {
    reasonCode: 'PLUGIN_DRIVER_APPLY_VALIDATION_PASSED',
    operation: 'apply-validation',
    hook: 'wp-option:validate-apply',
    supportedHook: true,
    status: 'passed',
    policySource: 'local-snapshot',
  });

  assert.equal(proof.precondition.resourceKey, boundary.resourceKey);
  assert.equal(proof.precondition.expectedHash, proof.mutationBoundary.remoteBeforeHash);
  assert.equal(proof.precondition.checkedAgainst, 'live-remote');
  assert.equal(proof.precondition.exactPrecondition, true);
  assert.match(proof.precondition.preconditionHash, sha256EvidencePattern);

  assert.deepEqual(proof.driverApplyValidation, {
    reasonCode: 'PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED',
    operation: 'driver-apply-validation',
    outcome: 'accepted',
    resourceKey: boundary.resourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    supportsDelete: false,
    action: 'put',
    resource: {
      type: 'row',
      table: 'wp_options',
      id: 'option_name:rpp_0498_forms_apply_validation',
    },
    planned: {
      state: 'present',
      hash: proof.mutationBoundary.localHash,
    },
    remote: {
      state: 'present',
      hash: proof.mutationBoundary.remoteBeforeHash,
    },
    evidenceHash: proof.driverApplyValidation.evidenceHash,
  });
  assert.match(proof.driverApplyValidation.evidenceHash, sha256EvidencePattern);

  assert.equal(proof.applyCarryThrough.mutateRemote, true);
  assert.equal(proof.applyCarryThrough.applyPlanSucceeded, true);
  assert.equal(proof.applyCarryThrough.remoteChanged, true);
  assert.equal(proof.applyCarryThrough.rowChanged, true);
  assert.equal(proof.applyCarryThrough.hookCount, 1);
  assert.equal(proof.applyCarryThrough.appliedMutations, 1);
  assert.equal(proof.applyCarryThrough.journalEntries, 1);
  assert.equal(proof.applyCarryThrough.journalApplied, true);
  assert.equal(proof.applyCarryThrough.acceptedHook, true);
  assert.equal(proof.applyCarryThrough.carriedThroughApply, true);
  assert.match(proof.applyCarryThrough.finalRowHash, sha256EvidencePattern);
  assert.match(proof.applyCarryThrough.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.applyCarryThrough.remoteHashAfter, sha256EvidencePattern);
  assert.notEqual(proof.applyCarryThrough.remoteHashAfter, proof.applyCarryThrough.remoteHashBefore);
  assert.equal(proof.applyCarryThrough.driverApplyValidationHash, proof.driverApplyValidation.evidenceHash);
  assert.equal(proof.failure, null);
  assert.match(proof.proofHash, sha256EvidencePattern);

  assertNoRawFixtures(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0498 release verifier apply-validation proof' }));
});

test('RPP-0498 production-shaped release verifier emits apply-validation hook proof in pluginDriver evidence', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /export function summarizeDriverApplyValidationHookReleaseVerifierProof/);
  assert.match(verifierSource, /driverApplyValidationHook: summarizeDriverApplyValidationHookReleaseVerifierProof\(\)/);
  assert.match(verifierSource, /DRIVER_APPLY_VALIDATION_HOOK_MUTATION_APPLIED/);
});
