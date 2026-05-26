import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveProductionPluginSource,
  resolveProductionPluginSourceCommand,
  resolveRouteProfile,
  isPackagedProductionPluginSource,
} from '../src/production-plugin-source.js';

test('production plugin source resolves packaged production mode when auth session is required', () => {
  const source = resolveProductionPluginSource({ routeProfile: 'lab-authenticated', requireProductionAuthSession: true });

  assert.equal(source.name, 'production-shaped');
  assert.equal(source.namespace, 'reprint/v1');
  assert.equal(source.routePrefix, '/push');
  assert.equal(source.namespacePath, '/wp-json/reprint/v1/push');
  assert.equal(source.sourceMode, 'packaged-production-plugin');
  assert.equal(source.requestedProfile, 'lab-authenticated');
  assert.equal(source.requireProductionAuthSession, true);
  assert.equal(isPackagedProductionPluginSource(source), true);
});

test('production plugin source preserves explicit production profile without requiring auth session override', () => {
  const source = resolveProductionPluginSource({ routeProfile: 'production-shaped' });

  assert.equal(source.name, 'production-shaped');
  assert.equal(resolveRouteProfile('production').name, 'production-shaped');
  assert.equal(isPackagedProductionPluginSource(source), true);
});

test('production plugin source command exposes the release verify env for packaged production mode', () => {
  const sourceCommand = resolveProductionPluginSourceCommand({
    routeProfile: 'lab-authenticated',
    requireProductionAuthSession: true,
  });

  assert.equal(sourceCommand.command, 'npm run verify:release');
  assert.deepEqual(sourceCommand.env, { REPRINT_PUSH_REQUIRE_PRODUCTION_AUTH_SESSION: '1' });
  assert.equal(sourceCommand.source.name, 'production-shaped');
  assert.equal(sourceCommand.packagedProductionPluginSource, true);
});
