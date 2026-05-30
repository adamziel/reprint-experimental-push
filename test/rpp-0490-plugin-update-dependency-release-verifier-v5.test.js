import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  pluginUpdateDependencyReleaseVerifierBoundary,
  summarizePluginUpdateDependencyReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const boundary = pluginUpdateDependencyReleaseVerifierBoundary;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'rpp-0490-private-dependency-build-token',
  'rpp-0490-private-dependent-release-note',
  'rpp-0490-private-local-row-mode',
  'rpp-0490-private-stale-remote-row-mode',
]);

function assertNoRawFixtures(value, label = 'RPP-0490 evidence') {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture ${raw}`);
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label }));
}

test('RPP-0490 release verifier carries plugin update dependency validation as hash-only support evidence', () => {
  const proof = summarizePluginUpdateDependencyReleaseVerifierProof({
    now: new Date('2026-05-30T13:49:00.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0490');
  assert.equal(proof.evidenceSource, 'release-verifier-plugin-update-dependency-validator-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'PLUGIN_UPDATE_DEPENDENCY_VALIDATOR_SUPPORT_ONLY');
  assert.equal(proof.checked, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.acceptedForReleaseGate, false);
  assert.equal(proof.releaseGate.status, 'NO-GO');
  assert.equal(proof.releaseGate.verdict, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.match(proof.releaseGate.note, /local\/support-only/);
  assert.match(proof.releaseGate.note, /evidenceScope=local-candidate/);
  assert.match(proof.releaseGate.note, /production-backed release gate evidence is still required/);

  assert.equal(proof.plan.status, 'ready');
  assert.equal(proof.plan.summary.mutations, 2);
  assert.equal(proof.plan.summary.conflicts, 0);
  assert.equal(proof.plan.summary.blockers, 0);
  assert.equal(proof.plan.summary.atomicGroups, 1);
  assert.equal(proof.plan.mutationCount, 2);
  assert.equal(proof.plan.preconditionCount, 2);
  assert.match(proof.plan.hash, sha256EvidencePattern);

  assert.deepEqual(proof.dependency, {
    groupId: 'rpp-0490-update-dependent-plugin-release-verifier',
    plugin: boundary.dependencyPlugin,
    dependentPlugin: boundary.dependentPlugin,
    source: 'live-remote',
    expectedVersion: boundary.dependencyVersion,
    versionRange: boundary.versionRange,
    active: true,
    expectedHash: proof.dependency.expectedHash,
    remoteHash: proof.dependency.remoteHash,
    baseHash: proof.dependency.baseHash,
    expectedHashEvidence: proof.dependency.expectedHashEvidence,
    requirementHash: proof.dependency.requirementHash,
    exactDependency: true,
  });
  assert.match(proof.dependency.expectedHash, sha256EvidencePattern);
  assert.equal(proof.dependency.remoteHash, proof.dependency.expectedHash);
  assert.match(proof.dependency.baseHash, sha256EvidencePattern);
  assert.match(proof.dependency.expectedHashEvidence, sha256EvidencePattern);
  assert.match(proof.dependency.requirementHash, sha256EvidencePattern);

  assert.equal(proof.updateMutation.resourceKey, `plugin:${boundary.dependentPlugin}`);
  assert.equal(proof.updateMutation.action, 'put');
  assert.equal(proof.updateMutation.changeKind, 'update');
  assert.equal(proof.updateMutation.exactUpdateMutation, true);
  assert.match(proof.updateMutation.mutationHash, sha256EvidencePattern);
  assert.match(proof.updateMutation.preconditionHash, sha256EvidencePattern);

  assert.equal(proof.pluginOwnedData.resourceKey, boundary.dataResourceKey);
  assert.equal(proof.pluginOwnedData.driver, boundary.dataDriver);
  assert.equal(proof.pluginOwnedData.owner, boundary.dependentPlugin);
  assert.equal(proof.pluginOwnedData.exactDataMutation, true);
  assert.match(proof.pluginOwnedData.auditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.pluginOwnedData.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.pluginOwnedData.resultRowHash, sha256EvidencePattern);
  assert.match(proof.pluginOwnedData.preconditionHash, sha256EvidencePattern);

  assert.equal(proof.acceptedApply.appliedMutations, 2);
  assert.equal(proof.acceptedApply.dependentPluginUpdated, true);
  assert.equal(proof.acceptedApply.dependencyStatePreserved, true);
  assert.equal(proof.acceptedApply.pluginOwnedDataApplied, true);
  assert.equal(proof.acceptedApply.errorCode, null);

  assert.equal(proof.refusals.versionMismatch.code, 'ATOMIC_GROUP_DEPENDENCY_VERSION_MISMATCH');
  assert.equal(proof.refusals.versionMismatch.preMutation, true);
  assert.equal(proof.refusals.versionMismatch.remoteDataPreserved, true);
  assert.equal(proof.refusals.versionMismatch.remoteHashAfter, proof.refusals.versionMismatch.remoteHashBefore);
  assert.match(proof.refusals.versionMismatch.detailsHash, sha256EvidencePattern);

  assert.equal(proof.refusals.unsupportedRange.code, 'ATOMIC_GROUP_DEPENDENCY_VERSION_RANGE_UNSUPPORTED');
  assert.equal(proof.refusals.unsupportedRange.preMutation, true);
  assert.equal(proof.refusals.unsupportedRange.remoteDataPreserved, true);
  assert.equal(proof.refusals.unsupportedRange.remoteHashAfter, proof.refusals.unsupportedRange.remoteHashBefore);
  assert.match(proof.refusals.unsupportedRange.detailsHash, sha256EvidencePattern);

  assert.equal(proof.refusals.staleDependency.code, 'ATOMIC_GROUP_DEPENDENCY_STALE');
  assert.equal(proof.refusals.staleDependency.preMutation, true);
  assert.equal(proof.refusals.staleDependency.remoteDataPreserved, true);
  assert.equal(proof.refusals.staleDependency.dependencyHashAfter, proof.refusals.staleDependency.dependencyHashBefore);
  assert.equal(proof.refusals.staleDependency.rowHashAfter, proof.refusals.staleDependency.rowHashBefore);
  assert.equal(proof.refusals.staleDependency.remoteHashAfter, proof.refusals.staleDependency.remoteHashBefore);
  assert.match(proof.refusals.staleDependency.detailsHash, sha256EvidencePattern);
  assert.match(proof.refusals.staleDependency.dependencyHashBefore, sha256EvidencePattern);
  assert.match(proof.refusals.staleDependency.rowHashBefore, sha256EvidencePattern);
  assert.match(proof.refusals.staleDependency.remoteHashBefore, sha256EvidencePattern);

  assert.equal(proof.redaction.format, 'hash-only');
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.redaction.checkedFixtureCount, rawFixtures.length);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawFixtures(proof, 'RPP-0490 release verifier proof');
});

test('RPP-0490 release verifier distinguishes production scope from checked production proof', () => {
  const scoped = summarizePluginUpdateDependencyReleaseVerifierProof({
    evidenceScope: 'production-backed',
    checkedProductionEvidence: false,
  });
  const checked = summarizePluginUpdateDependencyReleaseVerifierProof({
    evidenceScope: 'production-backed',
    checkedProductionEvidence: true,
  });

  assert.equal(scoped.checked, true);
  assert.equal(scoped.status, 'support_only');
  assert.equal(scoped.productionScopeClaimed, true);
  assert.equal(scoped.checkedProductionEvidence, false);
  assert.equal(scoped.productionBacked, false);
  assert.equal(scoped.acceptedForReleaseGate, false);
  assert.equal(scoped.releaseGate.status, 'NO-GO');
  assert.equal(scoped.releaseGate.verdict, 'PLUGIN_UPDATE_DEPENDENCY_VALIDATOR_PRODUCTION_PROOF_REQUIRED');
  assert.match(scoped.releaseGate.note, /production-backed scope/);
  assert.match(scoped.releaseGate.note, /release gate remains NO-GO/);

  assert.equal(checked.checked, true);
  assert.equal(checked.status, 'checked');
  assert.equal(checked.verdict, 'PLUGIN_UPDATE_DEPENDENCY_VALIDATOR_PRODUCTION_BACKED');
  assert.equal(checked.productionScopeClaimed, true);
  assert.equal(checked.checkedProductionEvidence, true);
  assert.equal(checked.productionBacked, true);
  assert.equal(checked.releaseEligible, true);
  assert.equal(checked.acceptedForReleaseGate, true);
  assert.equal(checked.releaseGate.status, 'GO');
  assert.equal(checked.releaseGate.verdict, 'PLUGIN_UPDATE_DEPENDENCY_VALIDATOR_PRODUCTION_BACKED');
  assertNoRawFixtures(scoped, 'RPP-0490 production-scoped proof');
  assertNoRawFixtures(checked, 'RPP-0490 checked production proof');
});

test('RPP-0490 release verifier emits plugin update dependency evidence beside plugin-driver proofs', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /pluginUpdateDependencyValidator: summarizePluginUpdateDependencyReleaseVerifierProof\(\)/);
  assert.match(verifierSource, /export function summarizePluginUpdateDependencyReleaseVerifierProof/);
  assert.match(verifierSource, /PLUGIN_UPDATE_DEPENDENCY_VALIDATOR_SUPPORT_ONLY/);
});
