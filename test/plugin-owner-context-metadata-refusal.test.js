import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const formsPluginResourceKey = 'plugin:forms';
const formsPluginFileResourceKey = 'file:wp-content/plugins/forms/forms.php';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms base plugin file */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'remote-preserved-option' },
          __pluginOwner: 'forms',
        },
      },
    },
  };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  return { resourceKey, pluginOwner, driver, ...extra };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

test('stale plugin metadata owner context refuses plugin-owned row before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);
  remote.plugins.forms = { version: '1.1.0', active: false };
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.ownerMetadataRefusalEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.reason, `Plugin-owned resource ${formsOptionResourceKey} cannot be applied because live remote plugin context for forms changed since the pull base.`);
  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.deepEqual(evidence.stalePluginMetadataResourceKeys, [formsPluginResourceKey]);
  assert.equal(evidence.context[0].resourceKey, formsPluginResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'update');
  assert.match(evidence.context[0].baseHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.context[0].remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(blocker.ownerContext[0].resourceKey, formsPluginResourceKey);
  assert.equal(blockerJson.includes('local-private-option'), false);
  assert.equal(blockerJson.includes('remote-preserved-option'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('stale plugin file owner context refuses plugin-owned row before mutation with redacted evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote private plugin file */';
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.ownerFileRefusalEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.reason, `Plugin-owned resource ${formsOptionResourceKey} cannot be applied because live remote plugin context for forms changed since the pull base.`);
  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_FILE_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.deepEqual(evidence.stalePluginFileResourceKeys, [formsPluginFileResourceKey]);
  assert.equal(evidence.context[0].resourceKey, formsPluginFileResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'update');
  assert.match(evidence.context[0].baseHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.context[0].remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(blocker.ownerContext[0].resourceKey, formsPluginFileResourceKey);
  assert.equal(blockerJson.includes('local-private-option'), false);
  assert.equal(blockerJson.includes('remote-preserved-option'), false);
  assert.equal(blockerJson.includes('remote private plugin file'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('stale plugin metadata owner context refuses plugin file mutation before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* local private plugin file */';
  const remote = cloneJson(base);
  remote.plugins.forms = { version: '1.1.0', active: false };
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsPluginFileResourceKey);
  const evidence = blocker.ownerMetadataRefusalEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, formsPluginFileResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(evidence.reasonCode, 'STALE_PLUGIN_METADATA_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.deepEqual(evidence.stalePluginMetadataResourceKeys, [formsPluginResourceKey]);
  assert.equal(evidence.context[0].remoteChange, 'update');
  assert.equal(blockerJson.includes('local private plugin file'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('executor rejects stale plugin file owner context before plugin-owned row mutation', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const ready = planFor(base, local, cloneJson(base));
  const staleRemote = cloneJson(base);
  staleRemote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote private plugin file */';
  const staleBefore = JSON.stringify(staleRemote);

  const mutation = mutationFor(ready, formsOptionResourceKey);
  const error = captureError(() => applyPlan(staleRemote, ready));
  const errorJson = JSON.stringify(error.details);

  assert.equal(ready.status, 'ready');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(
    mutation.pluginOwnedResource.ownerContext.some((context) =>
      context.resourceKey === formsPluginFileResourceKey),
    true,
  );
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(error.details.resourceKey, formsOptionResourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.contextResourceKey, formsPluginFileResourceKey);
  assert.match(error.details.expectedHash, /^[a-f0-9]{64}$/);
  assert.match(error.details.actualHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(staleRemote), staleBefore);
  assert.equal(errorJson.includes('local-private-option'), false);
  assert.equal(errorJson.includes('remote private plugin file'), false);
});

test('allowed plugin driver row update remains ready when owner metadata independently matches remote', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.plugins.forms = { version: '1.1.0', active: true };
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-allowed-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);
  remote.plugins.forms = { version: '1.1.0', active: true };

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(plan.blockers.length, 0);
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'local-allowed-option');
});
