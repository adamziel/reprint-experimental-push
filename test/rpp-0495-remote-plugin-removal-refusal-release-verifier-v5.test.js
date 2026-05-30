import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  remotePluginRemovalRefusalReleaseVerifierBoundary,
  summarizeRemotePluginRemovalRefusalReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const boundary = remotePluginRemovalRefusalReleaseVerifierBoundary;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'RPP_0495_BASE_ROW_SENTINEL',
  'RPP_0495_LOCAL_ROW_SENTINEL',
  'RPP_0495_REMOTE_ROW_PRESERVED',
  'RPP_0495_OWNER_PLUGIN_BASE_SENTINEL',
]);

function caseById(proof, id) {
  const entry = proof.cases.find((candidate) => candidate.id === id);
  assert.ok(entry, `missing ${id} proof case`);
  return entry;
}

function assertHashOnlyEvidence(value, label = 'RPP-0495 evidence') {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture ${raw}`);
  }
  assert.equal(serialized.includes('meta_value'), false, `${label} leaked raw meta_value field name`);
  assert.equal(serialized.includes('post_content'), false, `${label} leaked raw post_content field name`);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

test('RPP-0495 release verifier carries remote plugin removal refusal as hash-only NO-GO evidence', () => {
  const proof = summarizeRemotePluginRemovalRefusalReleaseVerifierProof({
    now: new Date('2026-05-30T10:49:50.000Z'),
  });
  const localCase = caseById(proof, 'local-candidate-policy');
  const productionCase = caseById(proof, 'production-backed-remote-snapshot');

  assert.equal(proof.rpp, 'RPP-0495');
  assert.equal(proof.proofKind, 'remote-plugin-removal-refusal');
  assert.equal(proof.evidenceSource, 'release-verifier-remote-plugin-removal-refusal-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'REMOTE_PLUGIN_REMOVAL_REFUSAL_SUPPORT_ONLY');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.acceptedForReleaseGate, false);
  assert.equal(proof.checkedProductionEvidence, false);
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.rawValuesIncluded, false);
  assert.deepEqual(proof.resource, {
    resourceKey: boundary.resourceKey,
    table: boundary.table,
    rowId: boundary.rowId,
    ownerPluginResourceKey: boundary.pluginResourceKey,
  });
  assert.deepEqual(proof.releaseGateEvidenceScopes, ['local-candidate', 'production-backed']);
  assert.equal(proof.caseCount, 2);
  assert.equal(proof.refusedBeforeMutationCount, 2);
  assert.equal(proof.remotePreservedCount, 2);
  assert.equal(proof.releaseGate.status, 'NO-GO');
  assert.equal(proof.releaseGate.verdict, 'REMOTE_PLUGIN_REMOVAL_REFUSAL_PRODUCTION_PROOF_REQUIRED');
  assert.equal(proof.releaseGate.evidenceScope, 'mixed');
  assert.equal(proof.releaseGate.productionBacked, false);
  assert.equal(proof.releaseGate.acceptedForReleaseGate, false);
  assert.match(proof.releaseGate.note, /production-backed scope/);
  assert.match(proof.releaseGate.note, /checked production verifier evidence is still required/);
  assert.match(proof.proofHash, sha256EvidencePattern);

  assert.equal(localCase.checked, true);
  assert.equal(localCase.status, 'checked');
  assert.equal(localCase.policyLocation, 'local');
  assert.equal(localCase.releaseGate.status, 'NO-GO');
  assert.equal(localCase.releaseGate.verdict, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(localCase.releaseGate.evidenceScope, 'local-candidate');
  assert.equal(localCase.releaseGate.productionBacked, false);
  assert.equal(localCase.releaseGate.acceptedForReleaseGate, false);
  assert.match(localCase.releaseGate.note, /local\/support-only/);
  assert.match(localCase.releaseGate.note, /production-backed release gate evidence is still required/);

  assert.equal(productionCase.checked, true);
  assert.equal(productionCase.status, 'checked');
  assert.equal(productionCase.policyLocation, 'remote');
  assert.equal(productionCase.refusal.productionBacked, true);
  assert.equal(productionCase.releaseGate.status, 'NO-GO');
  assert.equal(productionCase.releaseGate.verdict, 'REMOTE_PLUGIN_REMOVAL_REFUSAL_PRODUCTION_PROOF_REQUIRED');
  assert.equal(productionCase.releaseGate.evidenceScope, 'production-backed');
  assert.equal(productionCase.releaseGate.productionBacked, false);
  assert.equal(productionCase.releaseGate.acceptedForReleaseGate, false);
  assert.match(productionCase.releaseGate.note, /production-backed scope/);
  assert.match(productionCase.releaseGate.note, /release gate remains NO-GO/);

  for (const entry of proof.cases) {
    assert.equal(entry.refusedBeforeMutation, true);
    assert.deepEqual(entry.plan.summary, {
      mutations: 0,
      decisions: 1,
      conflicts: 0,
      blockers: 1,
    });
    assert.equal(entry.plan.mutationCount, 0);
    assert.equal(entry.plan.preconditionCount, 0);
    assert.match(entry.plan.hash, sha256EvidencePattern);
    assert.equal(entry.blocker.class, 'stale-plugin-owner-context');
    assert.equal(entry.blocker.resourceKey, boundary.resourceKey);
    assert.equal(entry.blocker.pluginOwner, boundary.owner);
    assert.equal(entry.blocker.driver, boundary.driver);
    assert.match(entry.blocker.blockerHash, sha256EvidencePattern);
    assert.match(entry.blocker.driverAuditEvidenceHash, sha256EvidencePattern);
    assert.equal(entry.refusal.reasonCode, 'REMOTE_PLUGIN_REMOVAL_OWNER_CONTEXT');
    assert.equal(entry.refusal.operation, 'refuse-before-mutation');
    assert.equal(entry.refusal.resourceKey, boundary.resourceKey);
    assert.equal(entry.refusal.pluginOwner, boundary.owner);
    assert.deepEqual(entry.refusal.removedPluginResourceKeys, [boundary.pluginResourceKey]);
    assert.equal(entry.refusal.contextHashes.length, 1);
    assert.equal(entry.refusal.contextHashes[0].resourceKey, boundary.pluginResourceKey);
    assert.equal(entry.refusal.contextHashes[0].localChange, 'unchanged');
    assert.equal(entry.refusal.contextHashes[0].remoteChange, 'delete');
    assert.match(entry.refusal.contextHashes[0].baseHash, sha256Pattern);
    assert.match(entry.refusal.contextHashes[0].localHash, sha256Pattern);
    assert.match(entry.refusal.contextHashes[0].remoteHash, sha256Pattern);
    assert.match(entry.refusal.evidenceHash, sha256EvidencePattern);
    assert.equal(entry.blockedApply.code, 'PLAN_NOT_READY');
    assert.match(entry.blockedApply.detailsHash, sha256EvidencePattern);
    assert.equal(entry.blockedApply.unexpectedApplyMutationCount, 0);
    assert.equal(entry.remotePreservation.remoteDataPreserved, true);
    assert.equal(entry.remotePreservation.rowHashAfter, entry.remotePreservation.rowHashBefore);
    assert.equal(entry.remotePreservation.remoteHashAfter, entry.remotePreservation.remoteHashBefore);
    assert.match(entry.remotePreservation.rowHashBefore, sha256EvidencePattern);
    assert.match(entry.remotePreservation.remoteHashBefore, sha256EvidencePattern);
  }

  assert.equal(localCase.blocker.policySource, 'local-snapshot');
  assert.equal(localCase.refusal.proofScope, 'local-focused');
  assert.equal(localCase.refusal.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(localCase.refusal.productionBacked, false);
  assert.match(localCase.refusal.releaseGateNote, /Local proof only/);
  assert.equal(productionCase.blocker.policySource, 'remote-snapshot');
  assert.equal(productionCase.refusal.proofScope, 'production-backed');
  assert.equal(productionCase.refusal.releaseGateEvidenceScope, 'production-backed');
  assert.match(productionCase.refusal.releaseGateNote, /Production-backed release gate evidence/);
  assertHashOnlyEvidence(proof);
});

test('RPP-0495 release verifier separates checked production-backed refusal from local support-only proof', () => {
  const proof = summarizeRemotePluginRemovalRefusalReleaseVerifierProof({
    now: new Date('2026-05-30T10:49:50.000Z'),
    checkedProductionEvidence: true,
  });
  const localCase = caseById(proof, 'local-candidate-policy');
  const productionCase = caseById(proof, 'production-backed-remote-snapshot');

  assert.equal(proof.status, 'checked');
  assert.equal(proof.verdict, 'REMOTE_PLUGIN_REMOVAL_REFUSAL_PRODUCTION_BACKED');
  assert.equal(proof.productionBacked, true);
  assert.equal(proof.acceptedForReleaseGate, true);
  assert.equal(proof.releaseGate.status, 'GO');
  assert.equal(proof.releaseGate.verdict, 'REMOTE_PLUGIN_REMOVAL_REFUSAL_PRODUCTION_BACKED');
  assert.equal(proof.releaseGate.evidenceScope, 'production-backed');
  assert.equal(proof.releaseGate.productionBacked, true);
  assert.equal(proof.releaseGate.acceptedForReleaseGate, true);
  assert.match(proof.releaseGate.note, /production-backed/);
  assert.equal(localCase.productionBacked, false);
  assert.equal(localCase.acceptedForReleaseGate, false);
  assert.equal(localCase.releaseGate.status, 'NO-GO');
  assert.equal(productionCase.productionBacked, true);
  assert.equal(productionCase.acceptedForReleaseGate, true);
  assert.equal(productionCase.releaseGate.status, 'GO');
  assertHashOnlyEvidence(proof, 'RPP-0495 checked production evidence');
});

test('RPP-0495 production-shaped release verifier carries remote removal summary into pluginDriver proof', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /export function summarizeRemotePluginRemovalRefusalReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /remotePluginRemovalRefusal:\s*summarizeRemotePluginRemovalRefusalReleaseVerifierProof\(\)/,
  );
  assert.match(verifierSource, /REMOTE_PLUGIN_REMOVAL_REFUSAL_PRODUCTION_PROOF_REQUIRED/);
});
