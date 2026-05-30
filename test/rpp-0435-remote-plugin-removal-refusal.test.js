import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const formsPluginResourceKey = 'plugin:forms';
const formsPluginFileResourceKey = 'file:wp-content/plugins/forms/forms.php';
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* rpp0435 forms base plugin file */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: {
            mode: 'rpp0435-remote-owned-data-preserved',
          },
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

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

test('RPP-0435 planner refuses remote plugin removal before plugin-owned data mutation with local release-gate note', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'rpp0435-local-private-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);
  delete remote.plugins.forms;
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.remotePluginRemovalRefusalEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(decisionFor(plan, formsPluginResourceKey).decision, 'keep-remote');
  assert.equal(decisionFor(plan, formsPluginFileResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(
    blocker.reason,
    `Plugin-owned resource ${formsOptionResourceKey} cannot be applied because live remote plugin context for forms changed since the pull base.`,
  );
  assert.equal(evidence.reasonCode, 'REMOTE_PLUGIN_REMOVAL_OWNER_CONTEXT');
  assert.equal(evidence.operation, 'refuse-before-mutation');
  assert.equal(evidence.proofScope, 'local-focused');
  assert.equal(evidence.productionBacked, false);
  assert.equal(
    evidence.releaseGateNote,
    'Local proof only; production-backed release gate evidence is still required.',
  );
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.deepEqual(evidence.removedPluginResourceKeys, [formsPluginResourceKey]);
  assert.deepEqual(blocker.ownerContextRefusalEvidence, evidence);
  assert.equal(evidence.context.length, 1);
  assert.equal(evidence.context[0].resourceKey, formsPluginResourceKey);
  assert.equal(evidence.context[0].localChange, 'unchanged');
  assert.equal(evidence.context[0].remoteChange, 'delete');
  assert.match(evidence.context[0].baseHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.context[0].localHash, /^[a-f0-9]{64}$/);
  assert.match(evidence.context[0].remoteHash, /^[a-f0-9]{64}$/);
  assert.equal(blockerJson.includes('rpp0435-local-private-option'), false);
  assert.equal(blockerJson.includes('rpp0435-remote-owned-data-preserved'), false);

  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
  assert.equal(
    remote.db.wp_options['option_name:forms_settings'].option_value.mode,
    'rpp0435-remote-owned-data-preserved',
  );
});

test('RPP-0435 executor refuses stale ready-plan local plugin assumptions before mutation and preserves remote data', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'rpp0435-local-private-option';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const readyRemote = cloneJson(base);
  const readyPlan = planFor(base, local, readyRemote);
  const readyMutation = mutationFor(readyPlan, formsOptionResourceKey);
  const ownerContextKeys = readyMutation.pluginOwnedResource.ownerContext.map((context) => context.resourceKey);
  const staleRemote = cloneJson(base);
  delete staleRemote.plugins.forms;
  const staleRemoteBefore = JSON.stringify(staleRemote);
  let beforeMutationCalls = 0;

  const error = captureError(() => applyPlan(staleRemote, readyPlan, {
    beforeMutation() {
      beforeMutationCalls++;
    },
  }));
  const errorJson = JSON.stringify(error.details);

  assert.equal(readyPlan.status, 'ready');
  assert.equal(readyPlan.summary.mutations, 1);
  assert.equal(readyMutation.action, 'put');
  assert.equal(readyMutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(readyMutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(readyMutation.pluginOwnedResource.ownerContextRequired, true);
  assert.deepEqual(ownerContextKeys.sort(), [
    formsPluginFileResourceKey,
    formsPluginResourceKey,
  ].sort());
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'STALE_PLUGIN_OWNER_CONTEXT');
  assert.equal(error.details.mutationId, readyMutation.id);
  assert.equal(error.details.resourceKey, formsOptionResourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.contextResourceKey, formsPluginResourceKey);
  assert.match(error.details.expectedHash, /^[a-f0-9]{64}$/);
  assert.match(error.details.actualHash, /^[a-f0-9]{64}$/);
  assert.equal(beforeMutationCalls, 0);
  assert.equal(JSON.stringify(staleRemote), staleRemoteBefore);
  assert.equal(
    staleRemote.db.wp_options['option_name:forms_settings'].option_value.mode,
    'rpp0435-remote-owned-data-preserved',
  );
  assert.equal(errorJson.includes('rpp0435-local-private-option'), false);
  assert.equal(errorJson.includes('rpp0435-remote-owned-data-preserved'), false);
});
