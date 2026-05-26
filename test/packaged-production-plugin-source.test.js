import assert from 'node:assert/strict';
import test from 'node:test';
import { packagedProductionPluginSource } from '../scripts/playground/packaged-production-plugin-source.mjs';
import { resolveSourceDescriptor } from '../src/authenticated-http-push-client.js';

test('packaged production plugin source metadata is reusable', () => {
  const source = packagedProductionPluginSource('/repo');

  assert.equal(source.plugin, 'plugins/reprint-push/reprint-push.php');
  assert.equal(source.packageSource, 'packaged-production-plugin');
  assert.match(source.sourceCommand, /REPRINT_PUSH_DISABLE_LAB_ROUTES=1/);
  assert.match(source.sourceCommand, /REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP=1/);

  const descriptor = resolveSourceDescriptor(source);
  assert.equal(descriptor.packageSource, 'packaged-production-plugin');
  assert.equal(descriptor.labBacked, false);
  assert.equal(descriptor.sourceCommand, source.sourceCommand);
});

test('resolveSourceDescriptor accepts the packaged source command shorthand', () => {
  const descriptor = resolveSourceDescriptor('packaged-production-plugin');

  assert.equal(descriptor.packageSource, 'packaged-production-plugin');
  assert.equal(descriptor.labBacked, false);
  assert.equal(descriptor.sourceCommand, null);
});
