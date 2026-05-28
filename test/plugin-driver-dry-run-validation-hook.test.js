import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';

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
          option_value: { mode: 'remote-preserved-validation-hook' },
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

test('supported plugin driver dry-run validation hook allows the mutation and records stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-validated-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option', {
        dryRunValidation: { hook: 'wp-option:validate-row', status: 'passed' },
      }),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const evidence = mutation.pluginOwnedResource.dryRunValidationEvidence;
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.blockers.length, 0);
  assert.equal(mutation.action, 'put');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_PASSED');
  assert.equal(evidence.operation, 'dry-run-validation');
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'wp-option');
  assert.equal(evidence.hook, 'wp-option:validate-row');
  assert.equal(evidence.supportedHook, true);
  assert.equal(evidence.status, 'passed');
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'local-validated-option');
});

test('unsupported plugin driver dry-run validation hook fails closed before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option', {
        dryRunValidation: { hook: 'wp-option:unsupported-hook', status: 'passed' },
      }),
    ),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.dryRunValidationEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.reason, 'Plugin-owned resource driver dry-run validation hook is not supported.');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_UNSUPPORTED');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'wp-option');
  assert.equal(evidence.hook, 'wp-option:unsupported-hook');
  assert.equal(evidence.supportedHook, false);
  assert.equal(evidence.status, 'passed');
  assert.equal(blockerJson.includes('local-private-option'), false);
  assert.equal(blockerJson.includes('remote-preserved-validation-hook'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('failing supported dry-run validation hook fails closed before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option', {
        dryRunValidation: { hook: 'wp-option:validate-row', status: 'failed' },
      }),
    ),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.dryRunValidationEvidence;

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.reason, 'Plugin-owned resource driver dry-run validation hook did not pass.');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_DRY_RUN_VALIDATION_FAILED');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.hook, 'wp-option:validate-row');
  assert.equal(evidence.supportedHook, true);
  assert.equal(evidence.status, 'failed');
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});
