import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('package scripts pin the bounded plugin-driver verifier bundle entrypoint', () => {
  assert.equal(
    packageJson.scripts['test:playground:production-plugin-driver-verifier-guards'],
    'REPRINT_PUSH_PACKAGE_SMOKE_SCENARIO=driver-verifier-guards node ./scripts/playground/production-plugin-package-smoke.mjs',
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
