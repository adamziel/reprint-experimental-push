import assert from 'node:assert/strict';
import test from 'node:test';

import {
  productionPluginPackageSourceCommand,
  resolveAuthenticatedHttpPushRouteProfile,
} from '../src/authenticated-http-push-client.js';

test('production plugin package source command is reusable by release-verify paths', () => {
  const sourceCommand = productionPluginPackageSourceCommand('production-shaped');

  assert.deepEqual(sourceCommand, {
    routeProfile: 'production-shaped',
    namespace: 'reprint/v1',
    routePrefix: '/push',
    namespacePath: '/wp-json/reprint/v1/push',
    packageSource: 'production-plugin-package',
  });
});

test('production-shaped route profile resolves to the packaged production source metadata', () => {
  const profile = resolveAuthenticatedHttpPushRouteProfile('production-shaped');

  assert.equal(profile.name, 'production-shaped');
  assert.equal(profile.namespace, 'reprint/v1');
  assert.equal(profile.routePrefix, '/push');
  assert.equal(profile.namespacePath, '/wp-json/reprint/v1/push');
  assert.equal(profile.packageSource, 'production-plugin-package');
});
