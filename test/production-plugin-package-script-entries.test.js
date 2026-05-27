import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseProductionPluginPackageSelectedScenarios } from '../scripts/playground/production-plugin-package-scenarios.js';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function packageSmokeMode(scriptName) {
  const command = packageJson.scripts[scriptName];
  const match = command?.match(/REPRINT_PUSH_PACKAGE_SMOKE_MODE=([^ ]+)/);
  return match?.[1] ?? null;
}

function packageSmokeScenario(scriptName) {
  const command = packageJson.scripts[scriptName];
  const match = command?.match(/REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=([^ ]+)/);
  return match?.[1] ?? null;
}

test('package scripts pin the bounded plugin-driver verifier guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-verifier-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-verifier-guards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver delete apply entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-delete-apply-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-delete-apply node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts keep plugin-driver entries on bounded scenario-backed smoke commands', () => {
  const driverScripts = Object.keys(packageJson.scripts)
    .filter((scriptName) => scriptName.startsWith('test:playground:production-plugin-driver-'));

  assert.ok(driverScripts.length >= 2, 'expected package scripts to expose plugin-driver proof entrypoints');

  for (const scriptName of driverScripts) {
    assert.equal(
      packageSmokeMode(scriptName),
      'driver-guard-only',
      `${scriptName} should use the bounded packaged driver smoke mode`,
    );

    const scenario = packageSmokeScenario(scriptName);
    assert.equal(typeof scenario, 'string', `${scriptName} should select an explicit scenario`);

    const selectedScenarios = parseProductionPluginPackageSelectedScenarios([], scenario);
    assert.ok(selectedScenarios?.size > 0, `${scriptName} should resolve to at least one runtime scenario`);
  }
});

test('package scripts expose the delete-apply scenario as a single bounded proof command', () => {
  const selectedScenarios = parseProductionPluginPackageSelectedScenarios(
    [],
    packageSmokeScenario('test:playground:production-plugin-driver-delete-apply-only'),
  );

  assert.deepEqual([...selectedScenarios], ['driver-delete-apply']);
});
