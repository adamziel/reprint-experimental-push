import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import {
  pluginUninstallDeleteReleaseVerifierBoundary,
  summarizePluginUninstallDeleteReleaseVerifierProof,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rawFixtures = Object.freeze([
  'rpp-0491-release-verifier-base-plugin-version',
  'rpp-0491-release-verifier-base-package-file',
  'rpp-0491-release-verifier-base-option-value',
  'rpp-0491-release-verifier-blocked-remote-package-file',
  'rpp-0491-release-verifier-blocked-remote-option-value',
]);

function assertNoRawFixtures(value, label = 'RPP-0491 evidence') {
  const serialized = JSON.stringify(value);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture ${raw}`);
  }
  assert.equal(serialized.includes('option_value'), false, `${label} leaked raw option_value field`);
}

test('RPP-0491 release verifier carries plugin uninstall/delete refusal as hash-only support evidence', () => {
  const boundary = pluginUninstallDeleteReleaseVerifierBoundary;
  const proof = summarizePluginUninstallDeleteReleaseVerifierProof({
    now: new Date('2026-05-30T11:49:10.000Z'),
  });

  assert.equal(proof.rpp, 'RPP-0491');
  assert.equal(proof.evidenceSource, 'release-verifier-plugin-uninstall-delete-refusal-v5');
  assert.equal(proof.status, 'support_only');
  assert.equal(proof.verdict, 'PLUGIN_UNINSTALL_DELETE_REFUSAL_PRESERVED');
  assert.equal(proof.evidenceScope, 'local-candidate');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.releaseGate.status, 'NO-GO');
  assert.equal(proof.releaseGate.acceptedForReleaseGate, false);
  assert.equal(proof.releaseGate.productionBacked, false);
  assert.match(proof.releaseGate.note, /local\/support-only/);
  assert.match(proof.releaseGate.note, /production-backed release gate evidence is still required/);
  assert.equal(proof.owner, boundary.owner);
  assert.equal(proof.driver, boundary.driver);
  assert.equal(proof.rawValuesIncluded, false);
  assert.equal(proof.explicitPluginDeleteDriverPresent, false);

  assert.deepEqual(proof.resourceBoundary, {
    owner: 'forms',
    plugin: {
      resourceKey: boundary.pluginResourceKey,
      resourceType: 'plugin',
      supportsDelete: false,
      expectedRefusal: 'PLUGIN_UNINSTALL_DELETE_REFUSED',
    },
    packageFile: {
      resourceKey: boundary.pluginFileResourceKey,
      resourceType: 'file',
      supportsDelete: false,
      expectedRefusal: 'PLUGIN_UNINSTALL_DELETE_REFUSED',
    },
    pluginOwnedRow: {
      resourceKey: boundary.rowResourceKey,
      resourceType: 'row',
      table: boundary.table,
      rowId: boundary.rowId,
      driver: boundary.driver,
      supportsDelete: false,
      expectedRefusal: 'PLUGIN_OWNED_RESOURCE_DELETE_UNSUPPORTED',
    },
  });

  assert.equal(proof.planRefusal.status, 'blocked');
  assert.deepEqual(proof.planRefusal.summary, {
    mutations: 0,
    blockers: 3,
    conflicts: 0,
    decisions: 0,
  });
  assert.equal(proof.planRefusal.noMutationsEmitted, true);
  assert.deepEqual(proof.planRefusal.blockerResourceKeys, [
    boundary.pluginFileResourceKey,
    boundary.pluginResourceKey,
    boundary.rowResourceKey,
  ]);
  assert.deepEqual(proof.planRefusal.blockerClasses, [
    'plugin-uninstall-delete-refusal',
    'plugin-uninstall-delete-refusal',
    'unsupported-plugin-owned-resource',
  ]);
  assert.deepEqual(proof.planRefusal.reasonCodes, [
    'PLUGIN_OWNED_RESOURCE_DELETE_UNSUPPORTED',
    'PLUGIN_UNINSTALL_DELETE_REFUSED',
  ]);
  assert.match(proof.planRefusal.pluginDeleteBlockerHash, sha256EvidencePattern);
  assert.match(proof.planRefusal.packageFileDeleteBlockerHash, sha256EvidencePattern);
  assert.match(proof.planRefusal.pluginOwnedRowDeleteBlockerHash, sha256EvidencePattern);
  assert.match(proof.planRefusal.planHash, sha256EvidencePattern);

  assert.equal(proof.applyRefusal.blockedPlan.code, 'PLAN_NOT_READY');
  assert.equal(proof.applyRefusal.blockedPlan.refusedBeforeMutation, true);
  assert.equal(proof.applyRefusal.blockedPlan.remotePreserved, true);
  assert.equal(proof.applyRefusal.blockedPlan.unexpectedApplyMutationCount, 0);
  assert.match(proof.applyRefusal.blockedPlan.detailsHash, sha256EvidencePattern);

  assert.equal(proof.applyRefusal.forgedPluginDelete.code, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(proof.applyRefusal.forgedPluginDelete.reasonCode, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(proof.applyRefusal.forgedPluginDelete.refusedBeforeMutation, true);
  assert.equal(proof.applyRefusal.forgedPluginDelete.remotePreserved, true);
  assert.equal(proof.applyRefusal.forgedPluginDelete.unexpectedApplyMutationCount, 0);
  assert.match(proof.applyRefusal.forgedPluginDelete.detailsHash, sha256EvidencePattern);

  assert.equal(proof.applyRefusal.forgedPackageFileDelete.code, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(proof.applyRefusal.forgedPackageFileDelete.reasonCode, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(proof.applyRefusal.forgedPackageFileDelete.refusedBeforeMutation, true);
  assert.equal(proof.applyRefusal.forgedPackageFileDelete.remotePreserved, true);
  assert.equal(proof.applyRefusal.forgedPackageFileDelete.unexpectedApplyMutationCount, 0);
  assert.match(proof.applyRefusal.forgedPackageFileDelete.detailsHash, sha256EvidencePattern);

  for (const hash of Object.values(proof.hashes)) {
    assert.match(hash, sha256EvidencePattern);
  }
  assert.equal(proof.redaction.format, 'hash-only');
  assert.equal(proof.redaction.rawValuesIncluded, false);
  assert.equal(proof.redaction.checkedFixtureCount, rawFixtures.length);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawFixtures(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0491 release verifier proof' }));
});

test('RPP-0491 production-shaped release verifier emits plugin uninstall/delete refusal evidence', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  const carryThroughOccurrences = verifierSource.match(
    /uninstallDeleteRefusal: summarizePluginUninstallDeleteReleaseVerifierProof\(\)/g,
  ) || [];

  assert.match(verifierSource, /export function summarizePluginUninstallDeleteReleaseVerifierProof/);
  assert.match(verifierSource, /pluginUninstallDeleteReleaseVerifierBoundary/);
  assert.equal(carryThroughOccurrences.length, 2);
});
