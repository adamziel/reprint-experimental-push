import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
