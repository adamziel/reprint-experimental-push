import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package scripts pin the bounded plugin-driver guard-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-guard-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
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
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverVerifierGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver verifier-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-verifier-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverVerifierGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver registration-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRegistrationGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver registration-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRegistrationGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver receipt-registration-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-registration-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptRegistrationGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver receipt-registration-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-registration-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptRegistrationGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver callback-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-callback-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverCallbackGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver callback-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-callback-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverCallbackGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver registration-shape-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-shape-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRegistrationShapeGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver registration-shape-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-shape-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRegistrationShapeGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver receipt-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver receipt-guards-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-guards-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReceiptGuards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver delete-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-delete-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverDeleteApplyProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver delete-apply-proof-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-delete-apply-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverDeleteApplyProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver route-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-route-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRouteProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver route-proof-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-route-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverRouteProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver positive-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-positive-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverPositiveProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the exact plugin-driver positive-proof-only mode alias entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-positive-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverPositiveProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver release-proof-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-release-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverReleaseProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver proof-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driverProof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});
