import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProductionPluginPackageSelectedScenarios,
  resolveProductionPluginPackageScenarios,
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

test('scenario resolver preserves requested aliases alongside expanded scenarios', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    ['--scenario=driver-verifier-guards,driver-delete-apply'],
    undefined,
  );

  assert.deepEqual(resolved.requestedScenarios, [
    'driver-verifier-guards',
    'driver-delete-apply',
  ]);
  assert.equal(resolved.resolvedMode, null);
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      ...scenarioGroups['driver-verifier-guards'],
      'driver-delete-apply',
    ].sort(),
  );
});

test('scenario resolver dedupes repeated aliases before returning requested scenarios', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    ['--scenario=driver-verifier-guards,driver-verifier-guards,driver-delete-apply'],
    undefined,
  );

  assert.deepEqual(resolved.requestedScenarios, [
    'driver-verifier-guards',
    'driver-delete-apply',
  ]);
  assert.equal(resolved.resolvedMode, null);
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      ...scenarioGroups['driver-verifier-guards'],
      'driver-delete-apply',
    ].sort(),
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

test('scenario resolver maps driver-guard-only mode to the bounded receipt guard scenario', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-guard-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-receipt-guards']);
  assert.equal(resolved.resolvedMode, 'driver-guard-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    ['driver-receipt-guards'],
  );
});

test('scenario resolver clears mode metadata when explicit scenario input overrides the bounded mode', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    ['--scenario=driver-delete-apply'],
    undefined,
    'driver-guard-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-delete-apply']);
  assert.equal(resolved.resolvedMode, null);
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    ['driver-delete-apply'],
  );
});

test('scenario resolver rejects unknown plugin-driver smoke modes', () => {
  assert.throws(
    () => resolveProductionPluginPackageScenarios([], undefined, 'unknown-mode'),
    /Unknown production plugin package smoke mode: unknown-mode/,
  );
});
