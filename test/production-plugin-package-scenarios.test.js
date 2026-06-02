import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arbitraryPluginFixturePackageBoundary,
  parseProductionPluginPackageSelectedScenarios,
  scenarioGroups,
  scenarioNames,
  summarizeArbitraryPluginFixturePackageEvidence,
} from '../scripts/playground/production-plugin-package-scenarios.js';

const registeredContractProvenanceProof = Object.freeze({
  registeredContractProvenanceAccepted: true,
  registeredDriverProvenanceHash: `sha256:${'a'.repeat(64)}`,
  contractHash: 'b'.repeat(64),
  contractValidationHash: 'c'.repeat(64),
});

test('scenario parser expands malformed driver aliases into concrete checks', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=driver-callback-guards,driver-registration-shape-guards'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected).sort(),
    [
      ...scenarioGroups['driver-callback-guards'],
      ...scenarioGroups['driver-registration-shape-guards'],
    ].sort(),
  );
});

test('scenario parser expands the full driver-registration alias into every malformed guard', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=driver-registration-guards'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected).sort(),
    scenarioGroups['driver-registration-guards'].slice().sort(),
  );
});

test('scenario parser expands the verifier alias into receipt and registration guards', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=driver-verifier-guards'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected).sort(),
    scenarioGroups['driver-verifier-guards'].slice().sort(),
  );
});

test('scenario parser expands the production boundary alias into custom-table and allowlist guards', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=driver-production-boundary-guards'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected).sort(),
    scenarioGroups['driver-production-boundary-guards'].slice().sort(),
  );
  assert.ok(selected.has('driver-receipt-guards'));
  assert.ok(selected.has('driver-activation-hook-effects-boundary'));
  assert.ok(selected.has('driver-missing-plugin-owner-guard'));
  assert.ok(selected.has('driver-duplicate-table-guard'));
});

test('scenario parser exposes activation-hook effects as a concrete support-only boundary check', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=driver-activation-hook-effects-guards'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected),
    ['driver-activation-hook-effects-boundary'],
  );
});

test('scenario parser exposes source mutation guards as a concrete packaged apply check', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=source-mutation-guards'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected),
    ['core-db-file-guarded-apply'],
  );
});

test('scenario parser exposes the noncanonical contract evidence guard as a concrete check', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=driver-noncanonical-contract-evidence-guard'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected),
    ['driver-noncanonical-contract-evidence-guard'],
  );
});

test('scenario groups only contain concrete plugin-driver smoke scenarios', () => {
  const concreteNames = new Set(scenarioNames);
  for (const [groupName, groupScenarios] of Object.entries(scenarioGroups)) {
    for (const scenarioName of groupScenarios) {
      assert.equal(
        concreteNames.has(scenarioName),
        true,
        `${groupName} contains non-concrete scenario ${scenarioName}`,
      );
    }
  }
});

test('scenario parser rejects unknown plugin-driver smoke scenarios', () => {
  assert.throws(
    () => parseProductionPluginPackageSelectedScenarios(
      ['--scenario=driver-callback-guards,typo-guard'],
      undefined,
    ),
    /Unknown production plugin package smoke scenario: typo-guard/,
  );
});

test('RPP-0420 arbitrary plugin fixture package summary labels local evidence as support-only', () => {
  const summary = summarizeArbitraryPluginFixturePackageEvidence({
    driverReceiptRevokedCredentialGuard: {
      resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
      applyRejectedCode: 'reprint_push_lab_auth_required',
      rowRetainedAfterReject: true,
      updatedMarkerAfterReject: 'base',
      payloadModeAfterReject: 'base',
    },
    arbitraryPluginFixturePackageProof: {
      evidenceScope: 'local-playground',
      releaseGateEvidenceScope: 'local-playground',
      allowlistExact: true,
      planReady: true,
      mutationCount: 1,
      noMutationAfterRevokedCredential: true,
    },
  });

  assert.equal(summary.checked, true);
  assert.equal(summary.evidenceScope, 'local-playground');
  assert.equal(summary.releaseGateEvidenceScope, 'local-playground');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.supportOnly, true);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.evidenceScope, 'local-playground');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.match(summary.releaseGate.note, /local\/support-only/);
  assert.match(summary.releaseGate.note, /evidenceScope=local-playground/);
  assert.match(summary.releaseGate.note, /production-backed release gate evidence is still required/);
  assert.equal(summary.packageProof.allowlistExact, true);
  assert.equal(summary.packageProof.planReady, true);
  assert.equal(summary.packageProof.mutationCount, 1);
});

test('RPP-0420 arbitrary plugin fixture package summary keeps production scope NO-GO without registered provenance', () => {
  const summary = summarizeArbitraryPluginFixturePackageEvidence({
    driverReceiptRevokedCredentialGuard: {
      resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
      applyRejectedCode: 'reprint_push_lab_auth_required',
      rowRetainedAfterReject: true,
      updatedMarkerAfterReject: 'base',
      payloadModeAfterReject: 'base',
    },
    arbitraryPluginFixturePackageProof: {
      evidenceScope: 'production-backed',
      releaseGateEvidenceScope: 'production-backed',
      productionBacked: true,
      allowlistExact: true,
      planReady: true,
      mutationCount: 1,
      noMutationAfterRevokedCredential: true,
    },
  });

  assert.equal(summary.packageChecksComplete, true);
  assert.equal(summary.checked, false);
  assert.equal(summary.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGateEvidenceScope, 'production-backed');
  assert.equal(summary.productionScoped, true);
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.supportOnly, true);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.registeredContractProvenanceAccepted, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.verdict, 'ARBITRARY_PLUGIN_FIXTURE_PACKAGE_REGISTERED_PROVENANCE_REQUIRED');
  assert.equal(summary.releaseGate.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.match(summary.releaseGate.note, /missing registered contract provenance/);
  assert.equal(summary.packageProof.registeredContractProvenanceAccepted, false);
});

test('RPP-0420 arbitrary plugin fixture package summary accepts production evidence only with registered provenance', () => {
  const summary = summarizeArbitraryPluginFixturePackageEvidence({
    driverReceiptRevokedCredentialGuard: {
      resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
      applyRejectedCode: 'reprint_push_lab_auth_required',
      rowRetainedAfterReject: true,
      updatedMarkerAfterReject: 'base',
      payloadModeAfterReject: 'base',
    },
    arbitraryPluginFixturePackageProof: {
      evidenceScope: 'production-backed',
      releaseGateEvidenceScope: 'production-backed',
      productionBacked: true,
      allowlistExact: true,
      planReady: true,
      mutationCount: 1,
      noMutationAfterRevokedCredential: true,
      ...registeredContractProvenanceProof,
    },
  });

  assert.equal(summary.packageChecksComplete, true);
  assert.equal(summary.checked, true);
  assert.equal(summary.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGateEvidenceScope, 'production-backed');
  assert.equal(summary.productionScoped, true);
  assert.equal(summary.productionBacked, true);
  assert.equal(summary.supportOnly, false);
  assert.equal(summary.acceptedForReleaseGate, true);
  assert.equal(summary.registeredContractProvenanceAccepted, true);
  assert.equal(summary.releaseGate.status, 'GO');
  assert.equal(summary.releaseGate.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGate.productionBacked, true);
  assert.match(summary.releaseGate.note, /registered contract provenance/);
  assert.equal(summary.packageProof.registeredContractProvenanceAccepted, true);
  assert.equal(
    summary.packageProof.registeredDriverProvenanceHash,
    registeredContractProvenanceProof.registeredDriverProvenanceHash,
  );
});
