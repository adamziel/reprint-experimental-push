import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  pluginActivationDependencyReleaseVerifierBoundary,
  summarizePluginActivationDependencyReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtures = [
  'rpp-0489-private-dependency-build',
  'rpp-0489-private-dependency-drift-build',
  'rpp-0489-private-dependency-envelope',
  'rpp-0489-private-dependency-token',
  'rpp-0489-base-activation-row',
  'rpp-0489-local-activation-row',
  'rpp-0489-remote-drift-activation-row',
];

test('RPP-0489 release verifier carries plugin activation dependency drift as hash-only support evidence', () => {
  const boundary = pluginActivationDependencyReleaseVerifierBoundary;
  const proof = summarizePluginActivationDependencyReleaseVerifierProof({
    now: new Date('2026-05-30T10:48:40.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0489');
  assert.equal(proof.evidenceSource, 'release-verifier-plugin-activation-dependency-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'PLUGIN_ACTIVATION_DEPENDENCY_REMOTE_DRIFT_PRESERVED');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.rawValuesIncluded, false);
  assert.equal(proof.dependencyPlugin, boundary.dependencyPlugin);
  assert.equal(proof.dependentPlugin, boundary.dependentPlugin);

  assert.equal(proof.atomicGroup.id, boundary.groupId);
  assert.equal(proof.atomicGroup.kind, 'plugin-activation');
  assert.equal(proof.atomicGroup.status, 'ready');
  assert.equal(proof.atomicGroup.mutationCount, 2);
  assert.equal(proof.atomicGroup.dependencyCount, 1);
  assert.match(proof.atomicGroup.groupHash, sha256EvidencePattern);

  assert.deepEqual(proof.dependencyRequirement, {
    groupId: boundary.groupId,
    plugin: boundary.dependencyPlugin,
    resourceKey: boundary.dependencyResourceKey,
    source: 'live-remote',
    active: true,
    expectedVersion: '2.1.0',
    expectedHash: proof.dependencyRequirement.expectedHash,
    baseHash: proof.dependencyRequirement.baseHash,
    remoteHash: proof.dependencyRequirement.remoteHash,
    requirementHash: proof.dependencyRequirement.requirementHash,
    exact: true,
  });
  assert.equal(proof.dependencyRequirement.expectedHash, proof.dependencyRequirement.remoteHash);
  assert.equal(proof.dependencyRequirement.baseHash, proof.dependencyRequirement.remoteHash);
  assert.match(proof.dependencyRequirement.expectedHash, sha256EvidencePattern);
  assert.match(proof.dependencyRequirement.requirementHash, sha256EvidencePattern);

  assert.equal(proof.activationMutation.resourceKey, boundary.dependentResourceKey);
  assert.equal(proof.activationMutation.action, 'put');
  assert.equal(proof.activationMutation.changeKind, 'update');
  assert.equal(proof.activationMutation.exact, true);
  assert.match(proof.activationMutation.baseHash, sha256EvidencePattern);
  assert.match(proof.activationMutation.remoteBeforeHash, sha256EvidencePattern);
  assert.match(proof.activationMutation.localHash, sha256EvidencePattern);
  assert.match(proof.activationMutation.mutationHash, sha256EvidencePattern);

  assert.equal(proof.pluginOwnedDataPreservation.resourceKey, boundary.dataResourceKey);
  assert.equal(proof.pluginOwnedDataPreservation.action, 'put');
  assert.equal(proof.pluginOwnedDataPreservation.driver, boundary.driver);
  assert.equal(proof.pluginOwnedDataPreservation.owner, boundary.dependentPlugin);
  assert.equal(proof.pluginOwnedDataPreservation.supportsDelete, false);
  assert.equal(proof.pluginOwnedDataPreservation.exact, true);
  assert.equal(proof.pluginOwnedDataPreservation.remoteDataPreserved, true);
  assert.equal(
    proof.pluginOwnedDataPreservation.rowHashAfter,
    proof.pluginOwnedDataPreservation.rowHashBefore,
  );
  assert.match(proof.pluginOwnedDataPreservation.auditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.pluginOwnedDataPreservation.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.pluginOwnedDataPreservation.mutationHash, sha256EvidencePattern);
  assert.match(proof.pluginOwnedDataPreservation.rowHashBefore, sha256EvidencePattern);

  assert.equal(proof.staleDependencyRefusal.preMutation, true);
  assert.equal(proof.staleDependencyRefusal.code, 'ATOMIC_GROUP_DEPENDENCY_STALE');
  assert.equal(proof.staleDependencyRefusal.expectedHashMatchesRequirement, true);
  assert.equal(proof.staleDependencyRefusal.actualHashMatchesDriftedDependency, true);
  assert.equal(proof.staleDependencyRefusal.dependencyPluginPreserved, true);
  assert.equal(proof.staleDependencyRefusal.dependentPluginPreserved, true);
  assert.equal(proof.staleDependencyRefusal.targetUnchanged, true);
  assert.equal(proof.staleDependencyRefusal.unexpectedApplyMutationCount, 0);
  assert.equal(
    proof.staleDependencyRefusal.dependencyHashAfter,
    proof.staleDependencyRefusal.dependencyHashBefore,
  );
  assert.equal(
    proof.staleDependencyRefusal.dependentHashAfter,
    proof.staleDependencyRefusal.dependentHashBefore,
  );
  assert.notEqual(
    proof.staleDependencyRefusal.dependencyHashBefore,
    proof.dependencyRequirement.remoteHash,
  );
  assert.equal(proof.staleDependencyRefusal.remoteHashAfter, proof.staleDependencyRefusal.remoteHashBefore);
  assert.match(proof.staleDependencyRefusal.detailsHash, sha256EvidencePattern);
  assert.match(proof.staleDependencyRefusal.dependencyHashBefore, sha256EvidencePattern);
  assert.match(proof.staleDependencyRefusal.dependentHashBefore, sha256EvidencePattern);
  assert.match(proof.staleDependencyRefusal.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);

  const serialized = JSON.stringify(proof);
  assert.equal(serialized.includes('option_value'), false, 'proof must not expose raw wp_options option_value fields');
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `proof leaked raw fixture value ${raw}`);
  }
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0489 release verifier activation dependency proof' }));
});

test('RPP-0489 production-shaped release verifier carries plugin activation dependency summary', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /summarizePluginActivationDependencyReleaseVerifierProof/);
  assert.match(
    verifierSource,
    /coreSemantics:\s*\{\s*pluginActivationDependency: summarizePluginActivationDependencyReleaseVerifierProof\(\),\s*wpPostmeta:/,
  );
  assert.match(verifierSource, /PLUGIN_ACTIVATION_DEPENDENCY_REMOTE_DRIFT_PRESERVED/);
});
