import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProductionPluginPackageSelectedScenarios,
  scenarioGroups,
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

test('scenario parser rejects unknown plugin-driver smoke scenarios', () => {
  assert.throws(
    () => parseProductionPluginPackageSelectedScenarios(
      ['--scenario=driver-callback-guards,typo-guard'],
      undefined,
    ),
    /Unknown production plugin package smoke scenario: typo-guard/,
  );
});
