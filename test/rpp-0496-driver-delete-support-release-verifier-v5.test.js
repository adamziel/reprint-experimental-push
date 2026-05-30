import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  driverDeleteSupportReleaseVerifierBoundary,
  summarizeDriverDeleteSupportReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtures = [
  'rpp-0496-delete-support-base-option',
  'rpp-0496-delete-support-nested-marker',
];

function assertNoRawDeleteSupportValues(value) {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `release verifier proof leaked ${raw}`);
  }
  assert.equal(serialized.includes('option_value'), false, 'proof must not expose raw option_value fields');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(value, { label: 'RPP-0496 release verifier proof' }));
}

test('RPP-0496 release verifier carries driver delete support flag behavior as support-only evidence', () => {
  const proof = summarizeDriverDeleteSupportReleaseVerifierProof({
    now: new Date('2026-05-30T13:49:00.000Z'),
  });
  const boundary = driverDeleteSupportReleaseVerifierBoundary;

  assert.equal(proof.rpp, 'RPP-0496');
  assert.equal(proof.evidenceSource, 'release-verifier-driver-delete-support-flag-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'DRIVER_DELETE_SUPPORT_FLAG_CARRIED_THROUGH');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.deepEqual(proof.releaseGate, {
    status: 'NO-GO',
    acceptedForReleaseGate: false,
    reason: 'local release-verifier support evidence for plugin-driver delete support only',
  });
  assert.equal(proof.driver, 'wp-option');
  assert.equal(proof.owner, 'forms');
  assert.deepEqual(proof.resource, {
    resourceKey: boundary.resourceKey,
    table: 'wp_options',
    rowId: 'option_name:rpp_0496_forms_settings',
  });

  const exactDriver = proof.scenarios.exactDriverBinding;
  assert.equal(exactDriver.ok, true);
  assert.equal(exactDriver.status, 'blocked');
  assert.equal(exactDriver.mutationCount, 0);
  assert.equal(exactDriver.blockerCount, 1);
  assert.equal(exactDriver.decoyDriver, 'wp-postmeta');
  assert.equal(exactDriver.decoySupportsDelete, true);
  assert.equal(exactDriver.matchedDriver, 'wp-option');
  assert.equal(exactDriver.noDecoyDriverInBlocker, true);
  assert.equal(exactDriver.blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(exactDriver.blocker.resourceKey, boundary.resourceKey);
  assert.equal(exactDriver.blocker.pluginOwner, 'forms');
  assert.equal(exactDriver.blocker.driver, 'wp-option');
  assert.equal(exactDriver.blocker.supportsDelete, false);
  assert.equal(exactDriver.blocker.deleteSupportReasonCode, 'PLUGIN_DRIVER_DELETE_UNSUPPORTED');
  assert.equal(exactDriver.blocker.deleteRefusalReasonCode, 'PLUGIN_OWNED_RESOURCE_DELETE_UNSUPPORTED');
  assert.match(exactDriver.blocker.blockerHash, sha256EvidencePattern);
  assert.equal(exactDriver.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(exactDriver.applyRefusal.remoteUnchanged, true);
  assert.match(exactDriver.applyRefusal.detailsHash, sha256EvidencePattern);
  assert.match(exactDriver.planHash, sha256EvidencePattern);

  const supportedDelete = proof.scenarios.supportedDelete;
  assert.equal(supportedDelete.ok, true);
  assert.equal(supportedDelete.status, 'ready');
  assert.equal(supportedDelete.mutationCount, 1);
  assert.equal(supportedDelete.blockerCount, 0);
  assert.equal(supportedDelete.preconditionCount, 1);
  assert.equal(supportedDelete.mutation.resourceKey, boundary.resourceKey);
  assert.equal(supportedDelete.mutation.action, 'delete');
  assert.equal(supportedDelete.mutation.driver, 'wp-option');
  assert.equal(supportedDelete.mutation.pluginOwner, 'forms');
  assert.equal(supportedDelete.mutation.supportsDelete, true);
  assert.equal(supportedDelete.mutation.policySource, 'local-snapshot');
  assert.equal(supportedDelete.mutation.ownerContextRequired, true);
  assert.equal(supportedDelete.mutation.exactMutation, true);
  assert.match(supportedDelete.mutation.auditEvidenceHash, sha256EvidencePattern);
  assert.match(supportedDelete.mutation.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(supportedDelete.mutation.mutationHash, sha256EvidencePattern);
  assert.equal(supportedDelete.precondition.resourceKey, boundary.resourceKey);
  assert.equal(supportedDelete.precondition.expectedHash, supportedDelete.mutation.remoteBeforeHash);
  assert.equal(supportedDelete.precondition.checkedAgainst, 'live-remote');
  assert.equal(supportedDelete.precondition.exactPrecondition, true);
  assert.match(supportedDelete.precondition.preconditionHash, sha256EvidencePattern);
  assert.deepEqual(supportedDelete.apply, {
    appliedMutations: 1,
    rowDeleted: true,
    pluginPreserved: true,
    journalHash: supportedDelete.apply.journalHash,
  });
  assert.match(supportedDelete.apply.journalHash, sha256EvidencePattern);

  const forgedDelete = proof.scenarios.forgedDelete;
  assert.equal(forgedDelete.ok, true);
  assert.equal(forgedDelete.sourcePlanStatus, 'ready');
  assert.equal(forgedDelete.sourceMutationCount, 1);
  assert.equal(forgedDelete.forgedSupportsDelete, false);
  assert.equal(forgedDelete.applyRefusal.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(forgedDelete.applyRefusal.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED');
  assert.equal(forgedDelete.applyRefusal.outcome, 'refused-before-mutation');
  assert.equal(forgedDelete.applyRefusal.action, 'delete');
  assert.equal(forgedDelete.applyRefusal.driver, 'wp-option');
  assert.equal(forgedDelete.applyRefusal.pluginOwner, 'forms');
  assert.equal(forgedDelete.applyRefusal.supportsDelete, false);
  assert.equal(forgedDelete.applyRefusal.remoteUnchanged, true);
  assert.match(forgedDelete.applyRefusal.detailsHash, sha256EvidencePattern);
  assert.match(forgedDelete.planHash, sha256EvidencePattern);
  assert.match(forgedDelete.forgedPlanHash, sha256EvidencePattern);

  assert.equal(proof.redaction.format, 'hash-only');
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.redaction.checkedFixtureCount, rawFixtures.length);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawDeleteSupportValues(proof);
});

test('RPP-0496 production-shaped release verifier emits delete-support carry-through in pluginDriver proof', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /export function summarizeDriverDeleteSupportReleaseVerifierProof/);
  assert.match(verifierSource, /deleteSupport: summarizeDriverDeleteSupportReleaseVerifierProof\(\)/);
  assert.match(verifierSource, /DRIVER_DELETE_SUPPORT_FLAG_CARRIED_THROUGH/);
});
