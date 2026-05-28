import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
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
          option_value: { mode: 'remote-owned-data-preserved' },
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

test('plugin driver supported audit evidence is hash-only and excludes row values', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-driver-audit';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const evidence = mutation.pluginOwnedResource.driverAuditEvidence;
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'ready');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(evidence.operation, 'plugin-driver-audit');
  assert.equal(evidence.decision, 'supported');
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'wp-option');
  assert.equal(evidence.policySource, 'local-snapshot');
  assert.equal(evidence.action, 'put');
  assert.equal(evidence.redaction, 'hash-only');
  assert.match(evidence.hashes.baseHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.hashes.localHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.hashes.remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(evidenceJson.includes('local-private-driver-audit'), false);
  assert.equal(evidenceJson.includes('remote-owned-data-preserved'), false);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(evidence, { label: 'plugin driver supported audit evidence' }));
});

test('remote plugin drift blocks plugin driver decision with hash-only audit evidence and preserves remote data', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-driver-audit';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-plugin-drift */';
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.driverAuditEvidence;
  const evidenceJson = JSON.stringify(evidence);
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.ownerContext[0].resourceKey, formsPluginFileResourceKey);
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED');
  assert.equal(evidence.operation, 'plugin-driver-audit');
  assert.equal(evidence.decision, 'blocked');
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'wp-option');
  assert.equal(evidence.policySource, 'local-snapshot');
  assert.equal(evidence.action, 'put');
  assert.equal(evidence.redaction, 'hash-only');
  assert.match(evidence.hashes.baseHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.hashes.localHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.hashes.remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(evidenceJson.includes('local-private-driver-audit'), false);
  assert.equal(evidenceJson.includes('remote-owned-data-preserved'), false);
  assert.equal(evidenceJson.includes('remote-private-plugin-drift'), false);
  assert.equal(blockerJson.includes('local-private-driver-audit'), false);
  assert.equal(blockerJson.includes('remote-owned-data-preserved'), false);
  assert.equal(blockerJson.includes('remote-private-plugin-drift'), false);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(evidence, { label: 'plugin driver blocked audit evidence' }));
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
  assert.equal(remote.db.wp_options['option_name:forms_settings'].option_value.mode, 'remote-owned-data-preserved');
});
