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
      'driver-callback-guards',
      'driver-registration-shape-guards',
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
    [
      'driver-registration-guards',
      ...scenarioGroups['driver-registration-guards'],
    ].sort(),
  );
});

test('scenario parser expands the verifier alias into receipt and registration guards', () => {
  const selected = parseProductionPluginPackageSelectedScenarios(
    ['--scenario=driver-verifier-guards'],
    undefined,
  );

  assert.deepEqual(
    Array.from(selected).sort(),
    [
      'driver-verifier-guards',
      ...scenarioGroups['driver-verifier-guards'],
    ].sort(),
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
      'driver-verifier-guards',
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
      'driver-verifier-guards',
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

test('scenario parser rejects blank explicit plugin-driver smoke scenarios', () => {
  assert.throws(
    () => parseProductionPluginPackageSelectedScenarios(
      ['--scenario= , '],
      undefined,
    ),
    /Production plugin package smoke scenarios cannot be blank/,
  );
});

test('scenario parser rejects blank plugin-driver smoke scenario environment input', () => {
  assert.throws(
    () => parseProductionPluginPackageSelectedScenarios(
      [],
      '   ',
    ),
    /Production plugin package smoke scenarios cannot be blank/,
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
    [
      'driver-receipt-guards',
      ...scenarioGroups['driver-receipt-guards'],
    ].sort(),
  );
});

test('scenario resolver maps driver-receipt-only mode to the bounded receipt guard scenario', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-receipt-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-receipt-guards']);
  assert.equal(resolved.resolvedMode, 'driver-receipt-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      'driver-receipt-guards',
      ...scenarioGroups['driver-receipt-guards'],
    ].sort(),
  );
});

test('scenario parser accepts direct receipt guard scenarios', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    ['--scenario=driver-receipt-plan-binding-guard,driver-receipt-expiry-guard'],
    undefined,
  );

  assert.deepEqual(resolved.requestedScenarios, [
    'driver-receipt-plan-binding-guard',
    'driver-receipt-expiry-guard',
  ]);
  assert.equal(resolved.resolvedMode, null);
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      'driver-receipt-plan-binding-guard',
      'driver-receipt-expiry-guard',
    ].sort(),
  );
});

test('scenario resolver maps driver-verifier-only mode to the bounded verifier bundle', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-verifier-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-verifier-guards']);
  assert.equal(resolved.resolvedMode, 'driver-verifier-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      'driver-verifier-guards',
      ...scenarioGroups['driver-verifier-guards'],
    ].sort(),
  );
});

test('scenario resolver maps driver-registration-only mode to the malformed registration bundle', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-registration-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-registration-guards']);
  assert.equal(resolved.resolvedMode, 'driver-registration-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      'driver-registration-guards',
      ...scenarioGroups['driver-registration-guards'],
    ].sort(),
  );
});

test('scenario resolver maps driver-receipt-registration-only mode to the bounded combined receipt and registration proof set', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-receipt-registration-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-receipt-registration-guards']);
  assert.equal(resolved.resolvedMode, 'driver-receipt-registration-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      'driver-receipt-registration-guards',
      ...scenarioGroups['driver-receipt-registration-guards'],
    ].sort(),
  );
});

test('scenario resolver maps driver-callback-only mode to the bounded callback guard bundle', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-callback-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-callback-guards']);
  assert.equal(resolved.resolvedMode, 'driver-callback-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      'driver-callback-guards',
      ...scenarioGroups['driver-callback-guards'],
    ].sort(),
  );
});

test('scenario resolver maps driver-registration-shape-only mode to the bounded registration-shape bundle', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-registration-shape-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-registration-shape-guards']);
  assert.equal(resolved.resolvedMode, 'driver-registration-shape-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      'driver-registration-shape-guards',
      ...scenarioGroups['driver-registration-shape-guards'],
    ].sort(),
  );
});

test('scenario resolver maps driver-delete-only mode to the bounded delete apply scenario', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-delete-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-delete-apply']);
  assert.equal(resolved.resolvedMode, 'driver-delete-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    ['driver-delete-apply'],
  );
});

test('scenario resolver maps driver-positive-only mode to the bounded packaged positive proof bundle', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-positive-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-positive-proof']);
  assert.equal(resolved.resolvedMode, 'driver-positive-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      'driver-positive-proof',
      ...scenarioGroups['driver-positive-proof'],
    ].sort(),
  );
});

test('scenario resolver maps driver-release-proof-only mode to the bounded route, receipt, and delete proof set', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-release-proof-only',
  );

  assert.deepEqual(resolved.requestedScenarios, ['driver-release-proof']);
  assert.equal(resolved.resolvedMode, 'driver-release-proof-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      'driver-release-proof',
      ...scenarioGroups['driver-release-proof'],
    ].sort(),
  );
});

test('scenario resolver maps driver-proof-only mode to the bounded driver delete and verifier proof set', () => {
  const resolved = resolveProductionPluginPackageScenarios(
    [],
    undefined,
    'driver-proof-only',
  );

  assert.deepEqual(resolved.requestedScenarios, [
    'driver-delete-apply',
    'driver-verifier-guards',
  ]);
  assert.equal(resolved.resolvedMode, 'driver-proof-only');
  assert.deepEqual(
    Array.from(resolved.selectedScenarios).sort(),
    [
      'driver-verifier-guards',
      'driver-delete-apply',
      ...scenarioGroups['driver-verifier-guards'],
    ].sort(),
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
