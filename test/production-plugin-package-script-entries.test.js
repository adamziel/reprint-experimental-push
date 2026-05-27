import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveProductionPluginPackageScenarios } from '../scripts/playground/production-plugin-package-scenarios.js';
import {
  guardProofModeAliases,
  guardProofModeNames,
  resolveProductionPluginPackageModeProofKey,
} from '../scripts/playground/production-plugin-package-proof-summary.js';

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

test('package scripts pin the bounded plugin-driver guard-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-guard-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverGuardOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the direct core package routes scenario entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-core-package-routes'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=core-package-routes node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the canonical plugin-driver route-proof mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-route-proof'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRouteProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver verifier bundle entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-verifier-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverVerifierGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver receipt guard scenario entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver registration guard bundle entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRegistrationGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver combined receipt and registration guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-registration-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptRegistrationGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver callback guard bundle entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-callback-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverCallbackGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver registration-shape guard bundle entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-shape-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRegistrationShapeGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver delete apply scenario entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-delete-apply'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-delete-apply node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the canonical plugin-driver delete-apply proof mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-delete-apply-proof'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverDeleteApplyProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver positive proof scenario entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-positive-proof'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverPositiveProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver release proof entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-release-proof'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReleaseProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver mutation proof entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-mutation-proof'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverMutationProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver delete guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-delete-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-delete-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver update validation guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-update-validation-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-update-validation-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver receipt plan binding guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-plan-binding-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-receipt-plan-binding-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver receipt expiry guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-expiry-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-receipt-expiry-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver receipt identity guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-identity-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-receipt-identity-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver rotated credential guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-rotated-credential-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-receipt-rotated-credential-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver revoked credential guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-revoked-credential-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-receipt-revoked-credential-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver missing-export guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-missing-export-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-missing-export-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver missing-apply guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-missing-apply-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-missing-apply-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver missing-validate guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-missing-validate-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-missing-validate-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver missing-name guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-missing-name-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-missing-name-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver missing-plugin-owner guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-missing-plugin-owner-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-missing-plugin-owner-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver missing-table guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-missing-table-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-missing-table-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver duplicate-name guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-duplicate-name-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-duplicate-name-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver duplicate-table guard entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-duplicate-table-guard'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-duplicate-table-guard node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver proof mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-proof'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver verifier-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-verifier-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverVerifierOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver verifier-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-verifier-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverVerifierGuardsOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver registration-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRegistrationOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver registration-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRegistrationGuardsOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver receipt-registration-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-registration-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptRegistrationOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver receipt-registration-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-registration-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptRegistrationGuardsOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver callback-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-callback-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverCallbackOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver callback-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-callback-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverCallbackGuardsOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver registration-shape-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-shape-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRegistrationShapeOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver registration-shape-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-shape-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRegistrationShapeGuardsOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver receipt-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver receipt-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptGuardsOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver delete-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-delete-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverDeleteOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver delete-apply-proof-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-delete-apply-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverDeleteApplyProofOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver route-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-route-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRouteOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver route-proof-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-route-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRouteProofOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver positive-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-positive-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverPositiveOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver positive-proof-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-positive-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverPositiveProofOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver release-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-release-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReleaseOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver release-proof-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-release-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReleaseProofOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver mutation-proof-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-mutation-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverMutationProofOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver proof-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverProofOnly node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts keep plugin-driver only entrypoints on exact Only mode aliases', () => {
  const onlyScripts = Object.keys(packageJson.scripts)
    .filter((scriptName) => scriptName.startsWith('test:playground:production-plugin-driver-'))
    .filter((scriptName) => scriptName.endsWith('-only'));
  for (const scriptName of onlyScripts) {
    assert.match(
      packageSmokeMode(scriptName) ?? '',
      /Only$/,
      `${scriptName} should use an exact Only mode alias`,
    );
  }
});

test('package scripts keep every plugin-driver smoke entrypoint resolvable by the scenario parser', () => {
  const driverScripts = Object.keys(packageJson.scripts)
    .filter((scriptName) => scriptName.startsWith('test:playground:production-plugin-driver-'));

  for (const scriptName of driverScripts) {
    const mode = packageSmokeMode(scriptName);
    const scenario = packageSmokeScenario(scriptName);

    assert.notEqual(
      mode === null && scenario === null,
      true,
      `${scriptName} should pin either a smoke mode or a smoke scenario`,
    );
    assert.equal(
      mode !== null && scenario !== null,
      false,
      `${scriptName} should not pin both a smoke mode and a smoke scenario`,
    );

    if (mode !== null) {
      const resolved = resolveProductionPluginPackageScenarios([], undefined, mode);
      assert.equal(
        resolved.resolvedMode,
        mode,
        `${scriptName} should keep the exact smoke mode alias accepted by the resolver`,
      );
      assert.ok(
        resolved.canonicalMode,
        `${scriptName} should resolve to a canonical plugin-driver scenario bundle`,
      );
      continue;
    }

    const resolved = resolveProductionPluginPackageScenarios(
      [`--scenario=${scenario}`],
      undefined,
      undefined,
    );
    assert.deepEqual(
      resolved.requestedScenarios,
      [scenario],
      `${scriptName} should keep its direct smoke scenario accepted by the resolver`,
    );
    assert.equal(
      resolved.resolvedMode,
      null,
      `${scriptName} should not infer a smoke mode for direct scenario entrypoints`,
    );
  }
});

test('package scripts keep every guard-proof canonical mode reachable through runtime smoke aliases', () => {
  const driverModeScripts = Object.keys(packageJson.scripts)
    .filter((scriptName) => scriptName.startsWith('test:playground:production-plugin-driver-'))
    .map((scriptName) => packageSmokeMode(scriptName))
    .filter((mode) => mode !== null);
  const reachableCanonicalModes = new Set(
    driverModeScripts.map(
      (mode) => resolveProductionPluginPackageScenarios([], undefined, mode).canonicalMode,
    ),
  );

  assert.deepEqual(guardProofModeNames, [
    'driver-callback-guards',
    'driver-proof',
    'driver-receipt-guards',
    'driver-receipt-registration-guards',
    'driver-registration-guards',
    'driver-registration-shape-guards',
    'driver-release-proof',
    'driver-verifier-guards',
  ]);

  assert.deepEqual(
    [...reachableCanonicalModes]
      .filter((canonicalMode) => guardProofModeNames.includes(canonicalMode))
      .sort(),
    guardProofModeNames,
  );
});

test('package scripts keep every exported guard-proof mode alias reachable through runtime smoke entries', () => {
  const driverModeScripts = Object.keys(packageJson.scripts)
    .filter((scriptName) => scriptName.startsWith('test:playground:production-plugin-driver-'))
    .map((scriptName) => packageSmokeMode(scriptName))
    .filter((mode) => mode !== null);
  const reachableModeAliases = new Set(driverModeScripts);

  for (const canonicalMode of guardProofModeNames) {
    const aliases = guardProofModeAliases[canonicalMode];
    assert.ok(Array.isArray(aliases), `${canonicalMode} should expose a runtime alias list`);
    assert.ok(aliases.length > 0, `${canonicalMode} should expose at least one runtime alias`);
    assert.equal(
      aliases.some((alias) => reachableModeAliases.has(alias)),
      true,
      `${canonicalMode} should stay reachable through at least one exported runtime alias`,
    );
  }
});

test('package scripts keep every exported guard-proof mode alias resolvable to a canonical proof key', () => {
  const driverModeScripts = Object.keys(packageJson.scripts)
    .filter((scriptName) => scriptName.startsWith('test:playground:production-plugin-driver-'))
    .map((scriptName) => packageSmokeMode(scriptName))
    .filter((mode) => mode !== null);

  for (const mode of driverModeScripts) {
    const resolved = resolveProductionPluginPackageModeProofKey(mode);
    if (resolved === null || !guardProofModeNames.includes(resolved.canonicalMode)) {
      continue;
    }

    assert.match(
      resolved.proofKey ?? '',
      /^driver[A-Z]/,
      `${mode} should resolve to one canonical driver proof key`,
    );
  }
});
