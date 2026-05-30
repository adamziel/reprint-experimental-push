import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  arbitraryPluginFixturePackageBoundary,
  summarizeArbitraryPluginFixturePackageEvidence,
} from '../scripts/playground/production-plugin-package-scenarios.js';
import {
  summarizeArbitraryPluginFixturePackageReleaseVerifierEvidence,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateSentinels = Object.freeze([
  'RPP-0500-PRIVATE-BASE-PAYLOAD',
  'RPP-0500-PRIVATE-LOCAL-PAYLOAD',
  'RPP-0500-PRIVATE-REVOKED-CREDENTIAL-MESSAGE',
]);

function packagedProof({
  evidenceScope = 'local-playground',
  checked = true,
  guardOverrides = {},
  proofOverrides = {},
} = {}) {
  const guard = {
    resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
    applyRejectedCode: 'reprint_push_lab_auth_required',
    applyRejectedMessage: privateSentinels[2],
    rowRetainedAfterReject: checked,
    updatedMarkerAfterReject: checked ? 'base' : 'local-update',
    payloadModeAfterReject: checked ? 'base' : 'local-update',
    rawPayload: privateSentinels[0],
    ...guardOverrides,
  };
  const proof = {
    driver: arbitraryPluginFixturePackageBoundary.driver,
    pluginOwner: arbitraryPluginFixturePackageBoundary.pluginOwner,
    table: arbitraryPluginFixturePackageBoundary.table,
    resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
    proofKind: 'arbitrary-plugin-fixture-package',
    sourceKind: evidenceScope === 'production-backed' ? 'production-backed' : 'local-playground',
    evidenceScope,
    releaseGateEvidenceScope: evidenceScope,
    productionBacked: evidenceScope === 'production-backed',
    allowlistExact: checked,
    planReady: checked,
    mutationCount: checked ? 1 : 0,
    noMutationAfterRevokedCredential: checked,
    rawPayload: privateSentinels[1],
    ...proofOverrides,
  };
  const arbitraryPluginFixturePackage = summarizeArbitraryPluginFixturePackageEvidence({
    driverReceiptRevokedCredentialGuard: guard,
    arbitraryPluginFixturePackageProof: proof,
  });

  return {
    status: 0,
    mode: 'driver-guard-only',
    packagedRevokedCredentialGuard: guard,
    arbitraryPluginFixturePackage,
  };
}

function summarizeReleaseVerifierPackage(options) {
  return summarizeArbitraryPluginFixturePackageReleaseVerifierEvidence({
    packagedPluginDriverProof: packagedProof(options),
    checkedProductionEvidence: options?.checkedProductionEvidence === true,
  });
}

function assertNoPrivatePayloads(value, label) {
  const json = JSON.stringify(value);
  for (const sentinel of privateSentinels) {
    assert.equal(json.includes(sentinel), false, `${label} leaked ${sentinel}`);
  }
  assert.equal(json.includes('rawPayload'), false, `${label} leaked rawPayload`);
  assert.equal(json.includes('applyRejectedMessage'), false, `${label} leaked rejected credential message`);
}

test('RPP-0500 release verifier labels local arbitrary plugin fixture package evidence as support-only', () => {
  const summary = summarizeReleaseVerifierPackage({
    evidenceScope: 'local-playground',
  });

  assert.equal(summary.proofKind, 'arbitrary-plugin-fixture-package');
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_SUPPORT_ONLY');
  assert.equal(summary.driver, arbitraryPluginFixturePackageBoundary.driver);
  assert.equal(summary.pluginOwner, arbitraryPluginFixturePackageBoundary.pluginOwner);
  assert.equal(summary.table, arbitraryPluginFixturePackageBoundary.table);
  assert.equal(summary.resourceKey, arbitraryPluginFixturePackageBoundary.resourceKey);
  assert.equal(summary.evidenceScope, 'local-playground');
  assert.equal(summary.releaseGateEvidenceScope, 'local-playground');
  assert.equal(summary.productionScopeClaimed, false);
  assert.equal(summary.checkedProductionEvidence, false);
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.supportOnly, true);
  assert.equal(summary.checked, true);
  assert.equal(summary.remoteDataPreserved, true);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.verdict, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.match(summary.releaseGate.note, /local\/support-only/);
  assert.match(summary.releaseGate.note, /evidenceScope=local-playground/);
  assert.match(summary.releaseGate.note, /production-backed release gate evidence is still required/);
  assert.deepEqual(summary.packageSmoke, { status: 0, mode: 'driver-guard-only' });
  assert.equal(summary.packageProof.allowlistExact, true);
  assert.equal(summary.packageProof.planReady, true);
  assert.equal(summary.packageProof.mutationCount, 1);
  assert.equal(summary.revokedCredentialGuard.applyRejectedCode, 'reprint_push_lab_auth_required');
  assertNoPrivatePayloads(summary, 'local release verifier package summary');
});

test('RPP-0500 release verifier keeps production-scoped fixture package evidence NO-GO without checked production proof', () => {
  const summary = summarizeReleaseVerifierPackage({
    evidenceScope: 'production-backed',
  });

  assert.equal(summary.checked, true);
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGateEvidenceScope, 'production-backed');
  assert.equal(summary.productionScopeClaimed, true);
  assert.equal(summary.checkedProductionEvidence, false);
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.supportOnly, true);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_PRODUCTION_PROOF_REQUIRED');
  assert.equal(summary.releaseGate.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.match(summary.releaseGate.note, /production-backed scope/);
  assert.match(summary.releaseGate.note, /release gate remains NO-GO/);
  assert.equal(summary.packagedReleaseGate.status, 'GO');
  assert.equal(summary.packagedReleaseGate.acceptedForReleaseGate, true);
  assertNoPrivatePayloads(summary, 'production-scoped release verifier package summary');
});

test('RPP-0500 release verifier accepts checked production-backed arbitrary fixture package evidence', () => {
  const summary = summarizeReleaseVerifierPackage({
    evidenceScope: 'production-backed',
    checkedProductionEvidence: true,
  });

  assert.equal(summary.checked, true);
  assert.equal(summary.status, 'checked');
  assert.equal(summary.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_PRODUCTION_BACKED');
  assert.equal(summary.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGateEvidenceScope, 'production-backed');
  assert.equal(summary.productionScopeClaimed, true);
  assert.equal(summary.checkedProductionEvidence, true);
  assert.equal(summary.productionBacked, true);
  assert.equal(summary.supportOnly, false);
  assert.equal(summary.acceptedForReleaseGate, true);
  assert.equal(summary.releaseGate.status, 'GO');
  assert.equal(summary.releaseGate.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_PRODUCTION_BACKED');
  assert.equal(summary.releaseGate.productionBacked, true);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, true);
  assert.match(summary.releaseGate.note, /production-backed/);
  assertNoPrivatePayloads(summary, 'checked production-backed release verifier package summary');
});

test('RPP-0500 release verifier blocks incomplete arbitrary fixture package checks before release gate credit', () => {
  const summary = summarizeReleaseVerifierPackage({
    evidenceScope: 'production-backed',
    checkedProductionEvidence: true,
    checked: false,
  });

  assert.equal(summary.checked, false);
  assert.equal(summary.status, 'blocked');
  assert.equal(summary.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_REQUIRED');
  assert.equal(summary.productionScopeClaimed, true);
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.supportOnly, true);
  assert.equal(summary.remoteDataPreserved, false);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_INCOMPLETE');
  assert.equal(summary.releaseGate.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.equal(summary.packageProof.noMutationAfterRevokedCredential, false);
  assertNoPrivatePayloads(summary, 'incomplete release verifier package summary');
});

test('RPP-0500 production-shaped release verifier carries arbitrary fixture package summary into pluginDriver proof', () => {
  const verifierSource = fs.readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(verifierSource, /summarizeArbitraryPluginFixturePackageReleaseVerifierEvidence/);
  assert.match(
    verifierSource,
    /arbitraryPluginFixturePackage: arbitraryPluginFixturePackageReleaseVerifierEvidence,/,
  );
  assert.match(
    verifierSource,
    /checkedProductionEvidence: packagedSourceFixture === null\s*&& Boolean\(explicitReleaseVerifySourceUrl\)\s*&& checkedDurableJournalAccepted/,
  );
  assert.match(verifierSource, /packagedGuard: packagedPluginDriverProof/);
});
