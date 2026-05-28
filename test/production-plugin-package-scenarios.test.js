import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arbitraryPluginFixturePackageBoundary,
  parseProductionPluginPackageSelectedScenarios,
  scenarioGroups,
  scenarioNames,
  summarizeArbitraryPluginFixturePackageEvidence,
} from '../scripts/playground/production-plugin-package-scenarios.js';

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
  assert.ok(selected.has('driver-missing-plugin-owner-guard'));
  assert.ok(selected.has('driver-duplicate-table-guard'));
});


test('scenario parser expands the arbitrary plugin fixture package alias', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=arbitrary-plugin-fixture-package'],
    undefined,
  );

  assert.deepEqual(Array.from(selected), ['driver-receipt-guards']);
});

test('arbitrary plugin fixture package evidence is explicitly local support-only and release held', () => {
  const evidence = summarizeArbitraryPluginFixturePackageEvidence({
    driverReceiptRevokedCredentialGuard: {
      resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
      revokedCredentialUuid: 'must-not-leak-revoked-credential-uuid',
      rotatedCredentialUsedForRevocation: 'must-not-leak-rotated-credential-uuid',
      applyRejectedCode: 'AUTH_SESSION_REVOKED',
      applyRejectedMessage: 'private error text should not be surfaced',
      rowRetainedAfterReject: true,
      updatedMarkerAfterReject: 'base',
      payloadModeAfterReject: 'base',
    },
  });
  const serialized = JSON.stringify(evidence);

  assert.equal(evidence.plugin, 'driver-fixture/driver-fixture.php');
  assert.equal(evidence.driver, 'fixture-arbitrary-plugin-table');
  assert.equal(evidence.pluginOwner, 'driver-fixture');
  assert.equal(evidence.table, 'wp_reprint_push_driver_fixture');
  assert.equal(evidence.resourceKey, 'row:["wp_reprint_push_driver_fixture","entry_id:1"]');
  assert.equal(evidence.proofKind, 'arbitrary-plugin-fixture-package');
  assert.equal(evidence.sourceKind, 'local-playground');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.supportOnly, true);
  assert.equal(evidence.checked, true);
  assert.equal(evidence.remoteDataPreserved, true);
  assert.equal(evidence.acceptedForReleaseGate, false);
  assert.equal(evidence.releaseGate.status, 'NO-GO');
  assert.equal(evidence.releaseGate.verdict, 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED');
  assert.match(evidence.releaseGate.note, /production-backed release gate evidence is still required/);
  assert.deepEqual(evidence.revokedCredentialGuard, {
    resourceKey: arbitraryPluginFixturePackageBoundary.resourceKey,
    applyRejectedCode: 'AUTH_SESSION_REVOKED',
    rowRetainedAfterReject: true,
    updatedMarkerAfterReject: 'base',
    payloadModeAfterReject: 'base',
  });
  assert.equal(serialized.includes('must-not-leak'), false);
  assert.equal(serialized.includes('private error text'), false);
});

test('arbitrary plugin fixture package evidence remains NO-GO when the local guard has not run', () => {
  const evidence = summarizeArbitraryPluginFixturePackageEvidence();

  assert.equal(evidence.checked, false);
  assert.equal(evidence.remoteDataPreserved, false);
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.acceptedForReleaseGate, false);
  assert.equal(evidence.releaseGate.status, 'NO-GO');
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
