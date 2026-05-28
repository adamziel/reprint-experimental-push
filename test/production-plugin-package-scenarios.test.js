import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArbitraryPluginFixturePackageProof,
  parseProductionPluginPackageSelectedScenarios,
  scenarioGroups,
  scenarioNames,
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

test('scenario parser expands the arbitrary plugin fixture package alias to the packaged driver receipt proof', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=arbitrary-plugin-fixture-package'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected).sort(),
    ['driver-receipt-guards'],
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

test('RPP-0440 arbitrary plugin fixture package proof is local, hash-only, and redacted', () => {
  const privateBaseValue = 'rpp-0440-private-base-plugin-owned-value';
  const privateLocalValue = 'rpp-0440-private-local-plugin-owned-value';
  const resourceKey = 'row:["wp_reprint_push_driver_fixture","entry_id:1"]';
  const baseRow = {
    entry_id: 1,
    payload: {
      owner: 'driver-fixture',
      mode: 'base',
      private_note: privateBaseValue,
    },
    updated_marker: 'base',
  };
  const localRow = {
    entry_id: 1,
    payload: {
      owner: 'driver-fixture',
      mode: 'local-update',
      private_note: privateLocalValue,
    },
    updated_marker: 'local-update',
  };
  const planMutation = {
    id: 'mutation-private-rpp-0440',
    action: 'put',
    resourceKey,
    remoteBeforeHash: 'a'.repeat(64),
    localAfterHash: 'b'.repeat(64),
    value: localRow,
  };
  const proof = buildArbitraryPluginFixturePackageProof({
    resourceKey,
    driver: 'fixture-arbitrary-plugin-table',
    table: 'wp_reprint_push_driver_fixture',
    pluginOwner: 'driver-fixture',
    baseRow,
    localRow,
    afterRejectedRow: baseRow,
    planMutation,
    dryRunReceipt: {
      receiptHash: `sha256:${'c'.repeat(64)}`,
      privateEchoShouldHashOnly: privateLocalValue,
    },
    rejectedApply: {
      status: 401,
      body: {
        code: 'reprint_push_lab_auth_required',
        message: 'private apply refusal message ' + privateBaseValue,
      },
    },
    privateValueProbe: privateBaseValue,
  });
  const serializedProof = JSON.stringify(proof);

  assert.equal(proof.rpp, 'RPP-0440');
  assert.equal(proof.evidenceScope, 'local-playground-arbitrary-plugin-fixture-package');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.format, 'hash-only');
  assert.equal(proof.rawValuesIncluded, false);
  assert.equal(proof.fixturePackage.arbitraryPluginOwnedPackage, true);
  assert.equal(proof.fixturePackage.resourceKey, resourceKey);
  assert.equal(proof.applyRefusal.status, 401);
  assert.equal(proof.applyRefusal.code, 'reprint_push_lab_auth_required');
  assert.equal(proof.preservation.rowRetainedAfterReject, true);
  assert.equal(proof.preservation.remoteDataPreserved, true);
  assert.match(proof.hashes.baseRow, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.hashes.localRow, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.hashes.afterRejectedRow, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.hashes.mutation, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.hashes.mutationValue, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.hashes.dryRunReceipt, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.hashes.privateValueProbe, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.applyRefusal.messageHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.proofHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(serializedProof.includes(privateBaseValue), false);
  assert.equal(serializedProof.includes(privateLocalValue), false);
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
