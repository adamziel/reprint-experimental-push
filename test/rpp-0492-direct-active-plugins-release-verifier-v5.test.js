import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  directActivePluginsMutationRefusalBoundary,
  summarizeDirectActivePluginsMutationRefusalReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';
import {
  generateDirectActivePluginsMutationRefusalCases,
  validateDirectActivePluginsMutationRefusalCase,
} from '../scripts/harness/generated-push-cases.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const expectedOutcomes = Object.freeze({
  'supported-plugin-managed-option-applies': 'applied-supported-plugin-managed-path',
  'unsupported-direct-active-plugins-blocked': 'blocked-direct-active-plugins',
  'forged-ready-active-plugins-rejected-before-mutation': 'rejected-forged-direct-active-plugins',
});

function proof() {
  return summarizeDirectActivePluginsMutationRefusalReleaseVerifierProof({
    now: new Date('2026-05-30T12:49:20.000Z'),
  });
}

function assertNoPrivateMarkers(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('rpp0492-private'), false);
  assert.equal(serialized.includes('option_value'), false);
  assert.equal(serialized.includes('private-base-plugin'), false);
  assert.equal(serialized.includes('private-local-plugin'), false);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(value, { label: 'RPP-0492 release verifier proof' }));
}

test('RPP-0492 release verifier carries direct active_plugins refusal variants as hash-only evidence', () => {
  const summary = proof();
  const generatedResults = generateDirectActivePluginsMutationRefusalCases()
    .map(validateDirectActivePluginsMutationRefusalCase);
  const generatedOutcomes = Object.fromEntries(
    generatedResults.map((entry) => [entry.variant, entry.outcome]),
  );

  assert.equal(summary.rpp, 'RPP-0492');
  assert.equal(summary.evidenceSource, 'release-verifier-direct-active-plugins-mutation-refusal-v5');
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.verdict, 'DIRECT_ACTIVE_PLUGINS_MUTATION_REFUSAL_CARRIED');
  assert.equal(summary.evidenceScope, 'local-release-verifier');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.releaseEligible, false);
  assert.equal(summary.releaseGate, 'NO-GO');
  assert.equal(summary.rawValuesIncluded, false);
  assert.deepEqual(summary.resource, {
    resourceKey: directActivePluginsMutationRefusalBoundary.resourceKey,
    table: 'wp_options',
    rowId: 'option_name:active_plugins',
    requiredDriver: 'plugin-activation-driver',
  });
  assert.deepEqual(summary.variants.map((entry) => entry.variant), [
    ...directActivePluginsMutationRefusalBoundary.variants,
  ]);
  assert.deepEqual(summary.releaseVerifier.outcomes, expectedOutcomes);
  assert.deepEqual(generatedOutcomes, expectedOutcomes);
  assert.equal(summary.releaseVerifier.generatedHarnessVariantsCovered, true);
  assert.equal(summary.releaseVerifier.supportedVariants, 1);
  assert.equal(summary.releaseVerifier.unsupportedVariants, 2);
  assert.equal(summary.releaseVerifier.failClosedUnsupportedVariants, 2);
  assert.match(summary.releaseVerifier.variantSetHash, sha256EvidencePattern);
  assert.match(summary.proofHash, sha256EvidencePattern);

  for (const variant of summary.variants) {
    assert.equal(variant.family, 'direct-active-plugins-mutation-refusal');
    assert.match(variant.plan.hash, sha256EvidencePattern);
    assert.match(variant.proofHash, sha256EvidencePattern);
  }
  assertNoPrivateMarkers(summary);
});

test('RPP-0492 release verifier keeps the supported plugin-managed option separate from active_plugins', () => {
  const summary = proof();
  const supported = summary.variants.find((entry) =>
    entry.variant === 'supported-plugin-managed-option-applies');

  assert.ok(supported);
  assert.equal(supported.outcome, 'applied-supported-plugin-managed-path');
  assert.equal(supported.status, 'ready');
  assert.equal(supported.supportedManagedPath, true);
  assert.equal(supported.plan.mutationCount, 1);
  assert.equal(supported.plan.blockerCount, 0);
  assert.equal(supported.plan.preconditionCount, 1);
  assert.equal(supported.managedMutation.pluginOwner, 'forms');
  assert.equal(supported.managedMutation.driver, 'wp-option');
  assert.equal(supported.managedMutation.policySource, 'local-snapshot');
  assert.equal(supported.managedMutation.ownerContextRequired, true);
  assert.match(supported.managedMutation.baseHash, sha256HexPattern);
  assert.match(supported.managedMutation.remoteBeforeHash, sha256HexPattern);
  assert.match(supported.managedMutation.localHash, sha256HexPattern);
  assert.match(supported.managedMutation.auditEvidenceHash, sha256EvidencePattern);
  assert.match(supported.managedMutation.driverAuditEvidenceHash, sha256EvidencePattern);
  assert.match(supported.managedMutation.mutationHash, sha256EvidencePattern);
  assert.equal(supported.activePlugins.resourceKey, directActivePluginsMutationRefusalBoundary.resourceKey);
  assert.equal(supported.activePlugins.directMutationPlanned, false);
  assert.equal(supported.activePlugins.preserved, true);
  assert.equal(supported.activePlugins.beforeHash, supported.activePlugins.afterHash);
  assert.match(supported.activePlugins.beforeHash, sha256HexPattern);
  assert.equal(supported.applied.appliedMutations, 1);
  assert.match(supported.applied.journalHash, sha256EvidencePattern);
  assertNoPrivateMarkers(supported);
});

test('RPP-0492 release verifier proves direct active_plugins refusals before mutation', () => {
  const summary = proof();
  const byVariant = Object.fromEntries(summary.variants.map((entry) => [entry.variant, entry]));
  const blocked = byVariant['unsupported-direct-active-plugins-blocked'];
  const forged = byVariant['forged-ready-active-plugins-rejected-before-mutation'];

  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.outcome, 'blocked-direct-active-plugins');
  assert.equal(blocked.plan.mutationCount, 0);
  assert.equal(blocked.plan.preconditionCount, 0);
  assert.equal(blocked.blocker.class, 'unsupported-active-plugins-direct-mutation');
  assert.equal(blocked.blocker.reasonCode, 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED');
  assert.equal(blocked.blocker.requiredDriver, 'plugin-activation-driver');
  assert.equal(blocked.blocker.resolutionPolicy, 'preserve-remote-active-plugins-and-stop');
  assert.equal(blocked.blocker.localChange, 'update');
  assert.equal(blocked.blocker.remoteChange, 'unchanged');
  assert.match(blocked.blocker.blockerHash, sha256EvidencePattern);
  assert.equal(blocked.applyRefusal.code, 'PLAN_NOT_READY');
  assert.equal(blocked.applyRefusal.reasonCode, 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED');
  assert.equal(blocked.applyRefusal.beforeMutationCalls, 0);
  assert.equal(blocked.applyRefusal.preMutation, true);
  assert.equal(blocked.applyRefusal.remotePreserved, true);
  assert.equal(blocked.applyRefusal.remoteBeforeHash, blocked.applyRefusal.remoteAfterHash);
  assert.equal(blocked.applyRefusal.activePluginsHashBefore, blocked.applyRefusal.activePluginsHashAfter);
  assert.match(blocked.applyRefusal.detailsHash, sha256EvidencePattern);

  assert.equal(forged.status, 'blocked');
  assert.equal(forged.outcome, 'rejected-forged-direct-active-plugins');
  assert.equal(forged.forgedReadyPlan.status, 'ready');
  assert.equal(forged.forgedReadyPlan.mutationCount, 1);
  assert.equal(forged.forgedReadyPlan.preconditionCount, 1);
  assert.equal(forged.forgedReadyPlan.resourceKey, directActivePluginsMutationRefusalBoundary.resourceKey);
  assert.match(forged.forgedReadyPlan.planHash, sha256EvidencePattern);
  assert.match(forged.forgedReadyPlan.mutationHash, sha256EvidencePattern);
  assert.equal(forged.applyRefusal.code, 'UNSUPPORTED_ACTIVE_PLUGINS_MUTATION');
  assert.equal(forged.applyRefusal.reasonCode, 'DIRECT_ACTIVE_PLUGINS_MUTATION_UNSUPPORTED');
  assert.equal(forged.applyRefusal.requiredDriver, 'plugin-activation-driver');
  assert.equal(forged.applyRefusal.beforeMutationCalls, 0);
  assert.equal(forged.applyRefusal.preMutation, true);
  assert.equal(forged.applyRefusal.remotePreserved, true);
  assert.equal(forged.applyRefusal.remoteBeforeHash, forged.applyRefusal.remoteAfterHash);
  assert.equal(forged.applyRefusal.activePluginsHashBefore, forged.applyRefusal.activePluginsHashAfter);
  assert.match(forged.applyRefusal.detailsHash, sha256EvidencePattern);

  assertNoPrivateMarkers(blocked);
  assertNoPrivateMarkers(forged);
});

test('RPP-0492 release verifier emits active_plugins refusal proof in the plugin-driver bundle', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /directActivePluginsMutationRefusal:/);
  assert.match(verifierSource, /export function summarizeDirectActivePluginsMutationRefusalReleaseVerifierProof/);
  assert.match(verifierSource, /DIRECT_ACTIVE_PLUGINS_MUTATION_REFUSAL_CARRIED/);
});
