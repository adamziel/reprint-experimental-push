import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  summarizeDriverAuditEvidenceRedactionReleaseVerifierProof,
  wpOptionsDriverReleaseVerifierBoundary,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'rpp-0499-release-verifier-audit-base-option',
  'rpp-0499-release-verifier-audit-local-option',
  '<?php /* rpp-0499 release verifier audit owner-context drift */',
  'rpp-0499-release-verifier-audit-stale-remote-drift-option',
  'rpp-0499-release-verifier-audit-remote-only-field',
]);

function assertNoRawAuditPayloads(value, label) {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture value ${raw}`);
  }
  assert.equal(serialized.includes('option_value'), false, `${label} must not expose option_value fields`);
  assert.equal(serialized.includes('__pluginOwner'), false, `${label} must not expose raw owner marker fields`);
}

test('RPP-0499 release verifier carries driver audit evidence redaction through remote drift preservation', () => {
  const proof = summarizeDriverAuditEvidenceRedactionReleaseVerifierProof({
    now: new Date('2026-05-30T10:49:00.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0499');
  assert.equal(proof.evidenceSource, 'release-verifier-driver-audit-evidence-redaction-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'DRIVER_AUDIT_EVIDENCE_REDACTED_REMOTE_DRIFT_PRESERVED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.driver, 'wp-option');
  assert.equal(proof.owner, 'forms');
  assert.deepEqual(proof.resource, {
    resourceKey: wpOptionsDriverReleaseVerifierBoundary.resourceKey,
    table: 'wp_options',
    rowId: 'option_name:forms_settings',
  });
  assert.deepEqual(proof.releaseVerifier, {
    checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
    check: 'plugin-driver-audit-evidence-redaction',
    variant: 'v5',
    remoteDriftPreservesPluginOwnedData: true,
  });

  assert.equal(proof.blockedOwnerContextDrift.status, 'blocked');
  assert.equal(proof.blockedOwnerContextDrift.mutationCount, 0);
  assert.equal(proof.blockedOwnerContextDrift.blockerCount, 1);
  assert.equal(proof.blockedOwnerContextDrift.blockerClass, 'stale-plugin-owner-context');
  assert.equal(proof.blockedOwnerContextDrift.resourceKey, wpOptionsDriverReleaseVerifierBoundary.resourceKey);
  assert.equal(proof.blockedOwnerContextDrift.pluginOwner, 'forms');
  assert.equal(proof.blockedOwnerContextDrift.driver, 'wp-option');
  assert.equal(proof.blockedOwnerContextDrift.reasonCode, 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED');
  assert.equal(proof.blockedOwnerContextDrift.decision, 'blocked');
  assert.equal(proof.blockedOwnerContextDrift.applyRefusalCode, 'PLAN_NOT_READY');
  assert.equal(proof.blockedOwnerContextDrift.remoteDataPreserved, true);
  assert.equal(proof.blockedOwnerContextDrift.evidenceRedacted, true);
  assert.equal(proof.blockedOwnerContextDrift.rowHashAfter, proof.blockedOwnerContextDrift.rowHashBefore);
  assert.equal(proof.blockedOwnerContextDrift.remoteHashAfter, proof.blockedOwnerContextDrift.remoteHashBefore);
  assert.match(proof.blockedOwnerContextDrift.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.blockedOwnerContextDrift.blockerHash, sha256EvidencePattern);
  assert.match(proof.blockedOwnerContextDrift.applyRefusalDetailsHash, sha256EvidencePattern);
  assert.match(proof.blockedOwnerContextDrift.rowHashBefore, sha256EvidencePattern);
  assert.match(proof.blockedOwnerContextDrift.remoteHashBefore, sha256EvidencePattern);

  assert.equal(proof.acceptedAuditEvidence.resourceKey, wpOptionsDriverReleaseVerifierBoundary.resourceKey);
  assert.equal(proof.acceptedAuditEvidence.action, 'put');
  assert.equal(proof.acceptedAuditEvidence.changeKind, 'update');
  assert.equal(proof.acceptedAuditEvidence.pluginOwner, 'forms');
  assert.equal(proof.acceptedAuditEvidence.driver, 'wp-option');
  assert.equal(proof.acceptedAuditEvidence.policySource, 'local-snapshot');
  assert.equal(proof.acceptedAuditEvidence.supportsDelete, false);
  assert.equal(proof.acceptedAuditEvidence.ownerContextRequired, true);
  assert.equal(proof.acceptedAuditEvidence.exactMutation, true);
  assert.equal(proof.acceptedAuditEvidence.plannerAudit.evidenceSource, 'planner-plugin-driver-audit');
  assert.equal(proof.acceptedAuditEvidence.plannerAudit.format, 'hash-only');
  assert.equal(proof.acceptedAuditEvidence.plannerAudit.rawValuesIncluded, false);
  assert.match(proof.acceptedAuditEvidence.plannerAudit.plannerAuditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.acceptedAuditEvidence.plannerAudit.ownerContextHash, sha256EvidencePattern);
  assert.equal(proof.acceptedAuditEvidence.driverDecision.operation, 'plugin-driver-audit');
  assert.equal(proof.acceptedAuditEvidence.driverDecision.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(proof.acceptedAuditEvidence.driverDecision.decision, 'supported');
  assert.equal(proof.acceptedAuditEvidence.driverDecision.redaction, 'hash-only');
  assert.equal(proof.acceptedAuditEvidence.driverDecision.rawValuesIncluded, false);
  assert.match(proof.acceptedAuditEvidence.driverDecision.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.acceptedAuditEvidence.baseHash, sha256HexPattern);
  assert.match(proof.acceptedAuditEvidence.localHash, sha256HexPattern);
  assert.match(proof.acceptedAuditEvidence.remoteBeforeHash, sha256HexPattern);
  assert.match(proof.acceptedAuditEvidence.mutationHash, sha256EvidencePattern);

  assert.equal(proof.precondition.resourceKey, wpOptionsDriverReleaseVerifierBoundary.resourceKey);
  assert.equal(proof.precondition.expectedHash, proof.acceptedAuditEvidence.remoteBeforeHash);
  assert.equal(proof.precondition.checkedAgainst, 'live-remote');
  assert.equal(proof.precondition.exactPrecondition, true);
  assert.match(proof.precondition.preconditionHash, sha256EvidencePattern);

  assert.equal(proof.staleRemotePreservation.preMutation, true);
  assert.equal(proof.staleRemotePreservation.code, 'PRECONDITION_FAILED');
  assert.equal(proof.staleRemotePreservation.beforeMutationCalls, 0);
  assert.equal(proof.staleRemotePreservation.expectedHashMatchesMutation, true);
  assert.equal(proof.staleRemotePreservation.actualHashMatchesRowBefore, true);
  assert.equal(proof.staleRemotePreservation.remoteDataPreserved, true);
  assert.equal(proof.staleRemotePreservation.rowHashAfter, proof.staleRemotePreservation.rowHashBefore);
  assert.equal(proof.staleRemotePreservation.remoteHashAfter, proof.staleRemotePreservation.remoteHashBefore);
  assert.match(proof.staleRemotePreservation.detailsHash, sha256EvidencePattern);
  assert.match(proof.staleRemotePreservation.rowHashBefore, sha256EvidencePattern);
  assert.match(proof.staleRemotePreservation.remoteHashBefore, sha256EvidencePattern);

  assert.equal(proof.redaction.format, 'hash-only');
  assert.equal(proof.redaction.evidenceSurfacesRedacted, true);
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.redaction.rawFieldNamesIncluded, false);
  assert.equal(proof.redaction.checkedFixtureCount, rawFixtures.length);
  assert.deepEqual(proof.redaction.surfaces, [
    'blocked-driver-decision-evidence',
    'planner-audit-evidence',
    'supported-driver-decision-evidence',
    'apply-refusal-details',
    'stale-precondition-details',
    'release-verifier-proof',
  ]);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawAuditPayloads(proof, 'RPP-0499 release verifier proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0499 release verifier audit redaction proof' }));
});

test('RPP-0499 release verifier emits audit redaction carry-through beside plugin-driver proofs', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /export function summarizeDriverAuditEvidenceRedactionReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /auditEvidenceRedaction: summarizeDriverAuditEvidenceRedactionReleaseVerifierProof\(\)/,
  );
  assert.match(verifierSource, /DRIVER_AUDIT_EVIDENCE_REDACTED_REMOTE_DRIFT_PRESERVED/);
});
