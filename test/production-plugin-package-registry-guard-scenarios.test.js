import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  resolveProductionPluginPackageScenarios,
} from '../scripts/playground/production-plugin-package-scenarios.js';

const smokeSource = fs.readFileSync(new URL('../scripts/playground/production-plugin-package-smoke.mjs', import.meta.url), 'utf8');

test('packaged plugin-driver smoke includes whitespace-only registry guard scenarios', () => {
  assert.match(smokeSource, /driver-whitespace-name-guard/);
  assert.match(smokeSource, /driver-whitespace-plugin-owner-guard/);
  assert.match(smokeSource, /driver-whitespace-table-guard/);
  assert.match(smokeSource, /'driver' => '   '/);
  assert.match(smokeSource, /'pluginOwner' => '   '/);
  assert.match(smokeSource, /'table' => '   '/);
  assert.match(smokeSource, /summary\.driverWhitespaceNameGuard = \{/);
  assert.match(smokeSource, /summary\.driverWhitespacePluginOwnerGuard = \{/);
  assert.match(smokeSource, /summary\.driverWhitespaceTableGuard = \{/);
});

test('packaged plugin-driver scenario resolver accepts dedicated whitespace registry guards', () => {
  for (const scenarioName of [
    'driver-whitespace-name-guard',
    'driver-whitespace-plugin-owner-guard',
    'driver-whitespace-table-guard',
  ]) {
    const resolved = resolveProductionPluginPackageScenarios([`--scenario=${scenarioName}`], undefined, undefined);
    assert.equal(resolved.resolvedMode, null);
    assert.equal(resolved.canonicalMode, null);
    assert.deepEqual(resolved.requestedScenarios, [scenarioName]);
    assert.deepEqual(resolved.selectedScenarios, new Set([scenarioName]));
  }
});

test('packaged plugin-driver scenario resolver exposes a dedicated whitespace registration bundle mode', () => {
  const resolved = resolveProductionPluginPackageScenarios([], undefined, 'driverRegistrationWhitespaceGuards');

  assert.equal(resolved.resolvedMode, 'driverRegistrationWhitespaceGuards');
  assert.equal(resolved.canonicalMode, 'driver-registration-whitespace-guards');
  assert.deepEqual(resolved.requestedScenarios, ['driver-registration-whitespace-guards']);
  assert.deepEqual(
    resolved.selectedScenarios,
    new Set([
      'driver-registration-whitespace-guards',
      'driver-whitespace-name-guard',
      'driver-whitespace-plugin-owner-guard',
      'driver-whitespace-table-guard',
    ]),
  );
});

test('packaged plugin-driver scenario resolver exposes a dedicated receipt auth guard bundle mode', () => {
  const resolved = resolveProductionPluginPackageScenarios([], undefined, 'driverReceiptAuthGuards');

  assert.equal(resolved.resolvedMode, 'driverReceiptAuthGuards');
  assert.equal(resolved.canonicalMode, 'driver-receipt-auth-guards');
  assert.deepEqual(resolved.requestedScenarios, ['driver-receipt-auth-guards']);
  assert.deepEqual(
    resolved.selectedScenarios,
    new Set([
      'driver-receipt-auth-guards',
      'driver-receipt-plan-binding-guard',
      'driver-receipt-expiry-guard',
      'driver-receipt-identity-guard',
      'driver-receipt-rotated-credential-guard',
      'driver-receipt-revoked-credential-guard',
    ]),
  );
});

test('packaged plugin-driver scenario resolver exposes a dedicated receipt credential guard bundle mode', () => {
  const resolved = resolveProductionPluginPackageScenarios([], undefined, 'driverReceiptCredentialGuards');

  assert.equal(resolved.resolvedMode, 'driverReceiptCredentialGuards');
  assert.equal(resolved.canonicalMode, 'driver-receipt-credential-guards');
  assert.deepEqual(resolved.requestedScenarios, ['driver-receipt-credential-guards']);
  assert.deepEqual(
    resolved.selectedScenarios,
    new Set([
      'driver-receipt-credential-guards',
      'driver-receipt-rotated-credential-guard',
      'driver-receipt-revoked-credential-guard',
    ]),
  );
});
