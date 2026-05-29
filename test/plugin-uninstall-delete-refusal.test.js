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
      'wp-content/plugins/forms/forms.php': '<?php /* forms base secret code */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'base-secret-option' },
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

test('plugin uninstall metadata delete fails closed with stable refusal evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  delete local.plugins.forms;
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsPluginResourceKey);
  const blockerJson = JSON.stringify(blocker);
  const remoteBefore = JSON.stringify(remote);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, formsPluginResourceKey), undefined);
  assert.equal(blocker.class, 'plugin-uninstall-delete-refusal');
  assert.equal(blocker.reason, 'Plugin context resource plugin:forms cannot be deleted by push; plugin uninstall/delete/remove is not supported for plugin-owned resources.');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-plugin-context-and-stop');
  assert.deepEqual(blocker.deleteRefusalEvidence, {
    reasonCode: 'PLUGIN_UNINSTALL_DELETE_REFUSED',
    operation: 'delete',
    resourceType: 'plugin',
    resourceKey: formsPluginResourceKey,
    pluginOwner: 'forms',
    supportsDelete: false,
  });
  assert.equal(blockerJson.includes('base-secret-option'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('plugin file removal fails closed with stable refusal evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  delete local.files['wp-content/plugins/forms/forms.php'];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsPluginFileResourceKey);
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, formsPluginFileResourceKey), undefined);
  assert.equal(blocker.class, 'plugin-uninstall-delete-refusal');
  assert.equal(blocker.deleteRefusalEvidence.reasonCode, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(blocker.deleteRefusalEvidence.operation, 'delete');
  assert.equal(blocker.deleteRefusalEvidence.resourceType, 'file');
  assert.equal(blocker.deleteRefusalEvidence.resourceKey, formsPluginFileResourceKey);
  assert.equal(blocker.deleteRefusalEvidence.pluginOwner, 'forms');
  assert.equal(blockerJson.includes('forms base secret code'), false);
});

test('plugin-owned row delete fails closed with driver delete-refusal evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  delete local.db.wp_options['option_name:forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.reason, 'Plugin-owned resource driver does not support delete mutations.');
  assert.deepEqual(blocker.deleteRefusalEvidence, {
    reasonCode: 'PLUGIN_OWNED_RESOURCE_DELETE_UNSUPPORTED',
    operation: 'delete',
    resourceType: 'row',
    resourceKey: formsOptionResourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    policySource: 'local-snapshot',
    supportsDelete: false,
  });
  assert.equal(blockerJson.includes('base-secret-option'), false);
  assert.equal(blockerJson.includes('option_value'), false);
});

test('executor rejects forged ready plugin delete before mutation', () => {
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const forgedPlan = {
    schemaVersion: 1,
    id: 'forged-plugin-delete-plan',
    generatedAt: fixedNow.toISOString(),
    status: 'ready',
    summary: { mutations: 1, decisions: 0, conflicts: 0, blockers: 0, atomicGroups: 0 },
    mutations: [
      {
        id: 'mutation-1',
        resource: { type: 'plugin', name: 'forms', key: formsPluginResourceKey },
        resourceKey: formsPluginResourceKey,
        action: 'delete',
        value: { absent: true },
        remoteBeforeHash: 'forged',
      },
    ],
    preconditions: [],
    decisions: [],
    conflicts: [],
    blockers: [],
    atomicGroups: [],
  };

  const error = captureError(() => applyPlan(remote, forgedPlan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(error.details.reasonCode, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.equal(error.details.resourceKey, formsPluginResourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(JSON.stringify(remote), before);
});

test('executor rejects forged ready plugin package file delete before mutation', () => {
  const remote = baseSite();
  const before = JSON.stringify(remote);
  const forgedPlan = {
    schemaVersion: 1,
    id: 'forged-plugin-package-file-delete-plan',
    generatedAt: fixedNow.toISOString(),
    status: 'ready',
    summary: { mutations: 1, decisions: 0, conflicts: 0, blockers: 0, atomicGroups: 0 },
    mutations: [
      {
        id: 'mutation-1',
        resource: {
          type: 'file',
          path: 'wp-content/plugins/forms/forms.php',
          key: formsPluginFileResourceKey,
        },
        resourceKey: formsPluginFileResourceKey,
        action: 'delete',
        value: { absent: true },
        remoteBeforeHash: 'forged',
      },
    ],
    preconditions: [],
    decisions: [],
    conflicts: [],
    blockers: [],
    atomicGroups: [],
  };

  const error = captureError(() => applyPlan(remote, forgedPlan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLUGIN_UNINSTALL_DELETE_REFUSED');
  assert.deepEqual(error.details, {
    mutationId: 'mutation-1',
    resourceKey: formsPluginFileResourceKey,
    pluginOwner: 'forms',
    reasonCode: 'PLUGIN_UNINSTALL_DELETE_REFUSED',
    operation: 'delete',
    resourceType: 'file',
    supportsDelete: false,
  });
  assert.equal(JSON.stringify(remote), before);
});

test('allowed non-delete plugin and plugin-owned data paths remain ready', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.plugins.forms = { version: '1.1.0', active: true };
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-non-delete';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, formsPluginResourceKey).action, 'put');
  assert.equal(mutationFor(plan, formsOptionResourceKey).action, 'put');
  assert.equal(result.site.plugins.forms.version, '1.1.0');
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'local-non-delete');
});
