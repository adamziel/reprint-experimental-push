import test from 'node:test';
import assert from 'node:assert/strict';

import {
  arbitraryPluginFixturePackageBoundary,
  parseProductionPluginPackageSelectedScenarios,
  scenarioGroups,
  summarizeArbitraryPluginFixturePackageEvidence,
} from '../scripts/playground/production-plugin-package-scenarios.js';

const privateFixtureSentinel = 'RPP-0440-PRIVATE-FIXTURE-PAYLOAD-SHOULD-NOT-LEAK';

function completeProofSummary({
  evidenceScope = 'local-playground',
  productionBacked = undefined,
  guard = {},
  proof = {},
} = {}) {
  return {
    driverReceiptRevokedCredentialGuard: {
      resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
      applyRejectedCode: 'reprint_push_lab_auth_required',
      applyRejectedMessage: privateFixtureSentinel,
      rowRetainedAfterReject: true,
      updatedMarkerAfterReject: 'base',
      payloadModeAfterReject: 'base',
      rawPayload: privateFixtureSentinel,
      ...guard,
    },
    arbitraryPluginFixturePackageProof: {
      evidenceScope,
      releaseGateEvidenceScope: evidenceScope,
      ...(productionBacked === undefined ? {} : { productionBacked }),
      allowlistExact: true,
      planReady: true,
      mutationCount: 1,
      noMutationAfterRevokedCredential: true,
      rawPayload: privateFixtureSentinel,
      ...proof,
    },
  };
}

function assertNoRawFixturePayload(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(privateFixtureSentinel), false);
  assert.equal(serialized.includes('rawPayload'), false);
  assert.equal(serialized.includes('applyRejectedMessage'), false);
}

test('RPP-0440 arbitrary plugin fixture package alias stays bounded to the receipt guard proof', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=arbitrary-plugin-fixture-package'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected),
    scenarioGroups['arbitrary-plugin-fixture-package'],
  );
  assert.deepEqual(Array.from(selected), ['driver-receipt-guards']);
  assert.equal(arbitraryPluginFixturePackageBoundary.scenario, 'driver-receipt-guards');
  assert.equal(arbitraryPluginFixturePackageBoundary.plugin, 'driver-fixture/driver-fixture.php');
  assert.equal(arbitraryPluginFixturePackageBoundary.driver, 'fixture-arbitrary-plugin-table');
  assert.equal(arbitraryPluginFixturePackageBoundary.pluginOwner, 'driver-fixture');
  assert.equal(arbitraryPluginFixturePackageBoundary.table, 'wp_reprint_push_driver_fixture');
});

test('RPP-0440 local arbitrary plugin fixture package proof is support-only and names the missing production evidence', () => {
  const summary = summarizeArbitraryPluginFixturePackageEvidence(
    completeProofSummary({ evidenceScope: 'local-playground' }),
  );

  assert.equal(summary.checked, true);
  assert.equal(summary.proofKind, 'arbitrary-plugin-fixture-package');
  assert.equal(summary.evidenceScope, 'local-playground');
  assert.equal(summary.releaseGateEvidenceScope, 'local-playground');
  assert.equal(summary.sourceKind, 'local-playground');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.supportOnly, true);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.verdict, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.equal(summary.releaseGate.evidenceScope, 'local-playground');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.match(summary.releaseGate.note, /local\/support-only/);
  assert.match(summary.releaseGate.note, /evidenceScope=local-playground/);
  assert.match(summary.releaseGate.note, /production-backed release gate evidence is still required/);
  assert.equal(summary.packageProof.allowlistExact, true);
  assert.equal(summary.packageProof.planReady, true);
  assert.equal(summary.packageProof.mutationCount, 1);
  assert.equal(summary.packageProof.noMutationAfterRevokedCredential, true);
  assert.equal(summary.revokedCredentialGuard.resourceKey, arbitraryPluginFixturePackageBoundary.resourceKey);
  assert.equal(summary.revokedCredentialGuard.applyRejectedCode, 'reprint_push_lab_auth_required');
  assert.equal(summary.revokedCredentialGuard.updatedMarkerAfterReject, 'base');
  assert.equal(summary.revokedCredentialGuard.payloadModeAfterReject, 'base');
  assertNoRawFixturePayload(summary);
});

test('RPP-0440 production-backed arbitrary plugin fixture package proof is accepted only when checks pass', () => {
  const summary = summarizeArbitraryPluginFixturePackageEvidence(
    completeProofSummary({ evidenceScope: 'production-backed', productionBacked: true }),
  );

  assert.equal(summary.checked, true);
  assert.equal(summary.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGateEvidenceScope, 'production-backed');
  assert.equal(summary.sourceKind, 'production-backed');
  assert.equal(summary.productionBacked, true);
  assert.equal(summary.supportOnly, false);
  assert.equal(summary.acceptedForReleaseGate, true);
  assert.equal(summary.releaseGate.status, 'GO');
  assert.equal(summary.releaseGate.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_PRODUCTION_BACKED');
  assert.equal(summary.releaseGate.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGate.productionBacked, true);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, true);
  assert.match(summary.releaseGate.note, /production-backed/);
  assert.doesNotMatch(summary.releaseGate.note, /local\/support-only/);
  assertNoRawFixturePayload(summary);
});

test('RPP-0440 production-scoped fixture package evidence still fails the release gate when package checks are incomplete', () => {
  const summary = summarizeArbitraryPluginFixturePackageEvidence(
    completeProofSummary({
      evidenceScope: 'production-backed',
      productionBacked: true,
      guard: {
        updatedMarkerAfterReject: 'local-update',
        payloadModeAfterReject: 'local-update',
      },
      proof: {
        noMutationAfterRevokedCredential: false,
      },
    }),
  );

  assert.equal(summary.checked, false);
  assert.equal(summary.remoteDataPreserved, false);
  assert.equal(summary.evidenceScope, 'production-backed');
  assert.equal(summary.productionBacked, true);
  assert.equal(summary.supportOnly, false);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_INCOMPLETE');
  assert.equal(summary.releaseGate.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGate.productionBacked, true);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.match(summary.releaseGate.note, /production-backed/);
  assert.doesNotMatch(summary.releaseGate.note, /local\/support-only/);
  assert.equal(summary.packageProof.noMutationAfterRevokedCredential, false);
  assertNoRawFixturePayload(summary);
});
