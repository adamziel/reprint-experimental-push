import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
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
          option_value: { mode: 'remote-preserved-apply-hook' },
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

test('passing plugin driver apply validation hook carries one real mutation through apply', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-validated-apply';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option', {
        applyValidation: { hook: 'wp-option:validate-apply', status: 'passed' },
      }),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const evidence = mutation.pluginOwnedResource.applyValidationEvidence;
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.blockers.length, 0);
  assert.equal(mutation.action, 'put');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_PASSED');
  assert.equal(evidence.operation, 'apply-validation');
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'wp-option');
  assert.equal(evidence.hook, 'wp-option:validate-apply');
  assert.equal(evidence.supportedHook, true);
  assert.equal(evidence.status, 'passed');
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'local-validated-apply');
});

test('failing plugin driver apply validation hook refuses before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-apply';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option', {
        applyValidation: { hook: 'wp-option:validate-apply', status: 'failed' },
      }),
    ),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const error = captureError(() => applyPlan(remote, plan));
  const detailsJson = JSON.stringify(error.details);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.applyValidationEvidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_FAILED');
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLUGIN_DRIVER_APPLY_VALIDATION_FAILED');
  assert.equal(error.details.resourceKey, formsOptionResourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'wp-option');
  assert.deepEqual(error.details.applyValidationEvidence, {
    reasonCode: 'PLUGIN_DRIVER_APPLY_VALIDATION_FAILED',
    operation: 'apply-validation',
    resourceKey: formsOptionResourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    policySource: 'local-snapshot',
    hook: 'wp-option:validate-apply',
    supportedHook: true,
    status: 'failed',
  });
  assert.equal(detailsJson.includes('local-private-apply'), false);
  assert.equal(detailsJson.includes('remote-preserved-apply-hook'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
  assert.equal(remote.db.wp_options['option_name:forms_settings'].option_value.mode, 'remote-preserved-apply-hook');
});

test('unsupported plugin driver apply validation hook refuses before mutation with stable evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-apply';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option', {
        applyValidation: { hook: 'wp-option:unsupported-apply', status: 'passed' },
      }),
    ),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const error = captureError(() => applyPlan(remote, plan));

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.pluginOwnedResource.applyValidationEvidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_UNSUPPORTED');
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLUGIN_DRIVER_APPLY_VALIDATION_UNSUPPORTED');
  assert.equal(error.details.applyValidationEvidence.hook, 'wp-option:unsupported-apply');
  assert.equal(error.details.applyValidationEvidence.supportedHook, false);
  assert.equal(error.details.applyValidationEvidence.status, 'passed');
  assert.equal(JSON.stringify(remote), remoteBefore);
});
