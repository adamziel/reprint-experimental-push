import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  summarizeWpOptionsDriverReleaseVerifierProof,
  wpOptionsDriverReleaseVerifierBoundary,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtures = [
  'rpp-0484-release-verifier-base-option',
  'rpp-0484-release-verifier-local-option',
  'rpp-0484-release-verifier-remote-drift-option',
];

test('RPP-0484 release verifier carries wp_options driver drift preservation as hash-only support evidence', () => {
  const proof = summarizeWpOptionsDriverReleaseVerifierProof({
    now: new Date('2026-05-30T10:48:40.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0484');
  assert.equal(proof.evidenceSource, 'release-verifier-wp-options-driver-semantics-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'WP_OPTIONS_DRIVER_REMOTE_DRIFT_PRESERVED');
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
  assert.deepEqual(proof.allowlist, {
    resourceKey: wpOptionsDriverReleaseVerifierBoundary.resourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    supportsDelete: false,
    policySource: 'local-snapshot',
  });

  assert.equal(proof.plan.status, 'ready');
  assert.equal(proof.plan.summary.mutations, 1);
  assert.equal(proof.plan.summary.conflicts, 0);
  assert.equal(proof.plan.summary.blockers, 0);
  assert.equal(proof.plan.mutationCount, 1);
  assert.equal(proof.plan.preconditionCount, 1);
  assert.match(proof.plan.hash, sha256EvidencePattern);

  assert.equal(proof.mutationBoundary.resourceKey, wpOptionsDriverReleaseVerifierBoundary.resourceKey);
  assert.equal(proof.mutationBoundary.action, 'put');
  assert.equal(proof.mutationBoundary.changeKind, 'update');
  assert.equal(proof.mutationBoundary.pluginOwner, 'forms');
  assert.equal(proof.mutationBoundary.driver, 'wp-option');
  assert.equal(proof.mutationBoundary.supportsDelete, false);
  assert.equal(proof.mutationBoundary.ownerContextRequired, true);
  assert.equal(proof.mutationBoundary.exactMutation, true);
  assert.match(proof.mutationBoundary.baseHash, /^[a-f0-9]{64}$/);
  assert.match(proof.mutationBoundary.localHash, /^[a-f0-9]{64}$/);
  assert.match(proof.mutationBoundary.remoteBeforeHash, /^[a-f0-9]{64}$/);
  assert.match(proof.mutationBoundary.auditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.mutationBoundary.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.mutationBoundary.mutationHash, sha256EvidencePattern);

  assert.equal(proof.precondition.resourceKey, wpOptionsDriverReleaseVerifierBoundary.resourceKey);
  assert.equal(proof.precondition.expectedHash, proof.mutationBoundary.remoteBeforeHash);
  assert.equal(proof.precondition.checkedAgainst, 'live-remote');
  assert.equal(proof.precondition.exactPrecondition, true);
  assert.match(proof.precondition.preconditionHash, sha256EvidencePattern);

  assert.equal(proof.staleRemotePreservation.preMutation, true);
  assert.equal(proof.staleRemotePreservation.code, 'PRECONDITION_FAILED');
  assert.equal(proof.staleRemotePreservation.expectedHashMatchesMutation, true);
  assert.equal(proof.staleRemotePreservation.actualHashMatchesRowBefore, true);
  assert.equal(proof.staleRemotePreservation.rowHashAfter, proof.staleRemotePreservation.rowHashBefore);
  assert.equal(proof.staleRemotePreservation.remoteHashAfter, proof.staleRemotePreservation.remoteHashBefore);
  assert.equal(proof.staleRemotePreservation.remoteDataPreserved, true);
  assert.equal(proof.staleRemotePreservation.unexpectedApplyMutationCount, 0);
  assert.match(proof.staleRemotePreservation.detailsHash, sha256EvidencePattern);
  assert.match(proof.staleRemotePreservation.rowHashBefore, sha256EvidencePattern);
  assert.match(proof.staleRemotePreservation.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);

  const serialized = JSON.stringify(proof);
  assert.equal(serialized.includes('option_value'), false, 'proof must not expose raw wp_options option_value fields');
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `proof leaked raw fixture value ${raw}`);
  }
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0484 release verifier wp_options proof' }));
});

test('RPP-0484 release verifier emits wp_options carry-through beside the production-owned boundary', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /wpOptionsDriverSemantics: summarizeWpOptionsDriverReleaseVerifierProof\(\)/);
  assert.match(verifierSource, /export function summarizeWpOptionsDriverReleaseVerifierProof/);
  assert.match(verifierSource, /WP_OPTIONS_DRIVER_REMOTE_DRIFT_PRESERVED/);
});
