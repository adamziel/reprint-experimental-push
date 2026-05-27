import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package scripts pin the bounded plugin-driver guard-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-guard-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-guard-only node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver verifier bundle entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-verifier-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-verifier-guards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver receipt guard scenario entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-receipt-guards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver registration guard bundle entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-registration-guards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver callback guard bundle entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-callback-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-callback-guards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver registration-shape guard bundle entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-shape-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-registration-shape-guards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver delete apply scenario entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-delete-apply'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-delete-apply node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver positive proof scenario entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-positive-proof'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-positive-proof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver release proof entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-release-proof'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-release-proof node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver proof bundle entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-proof'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-delete-apply,driver-verifier-guards node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver verifier-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-verifier-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-verifier-only node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver registration-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-registration-only node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver callback-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-callback-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-callback-only node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver registration-shape-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-registration-shape-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-registration-shape-only node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver receipt-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-receipt-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-receipt-only node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver delete-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-delete-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-delete-only node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver positive-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-positive-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-positive-only node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver release-proof-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-release-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-release-proof-only node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});

test('package scripts pin the bounded plugin-driver proof-only mode entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-proof-only'],
    'REPRINT_PUSH_PACKAGE_SMOKE_MODE=driver-proof-only node ./scripts/playground/production-plugin-package-smoke.mjs',
  );
});
