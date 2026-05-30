import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const formsOptionRowId = 'option_name:rpp_0476_forms_settings';
const formsOptionResourceKey = `row:["wp_options","${formsOptionRowId}"]`;
const rawOptionMarkers = [
  'rpp-0476-base-driver-delete-support',
  'rpp-0476-local-delete-candidate',
];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite(mode = rawOptionMarkers[0]) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* rpp-0476 forms plugin */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        [formsOptionRowId]: {
          option_name: 'rpp_0476_forms_settings',
          option_value: {
            mode,
            nested: { marker: rawOptionMarkers[1] },
          },
          autoload: 'no',
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

function allowedPluginOwnedResource(extra = {}) {
  return {
    resourceKey: formsOptionResourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    ...extra,
  };
}

function deleteScenario(...allowedResources) {
  const base = baseSite();
  const local = cloneJson(base);
  delete local.db.wp_options[formsOptionRowId];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(...allowedResources),
  };
  return { base, local, remote: cloneJson(base) };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan) {
  return plan.mutations.find((mutation) => mutation.resourceKey === formsOptionResourceKey);
}

function blockerFor(plan) {
  return plan.blockers.find((blocker) => blocker.resourceKey === formsOptionResourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertNoRawOptionEvidence(value) {
  const json = JSON.stringify(value);
  for (const marker of rawOptionMarkers) {
    assert.equal(json.includes(marker), false, `evidence leaked raw option marker ${marker}`);
  }
  assert.equal(json.includes('option_value'), false, 'evidence must not include raw option_value fields');
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(value, { label: 'RPP-0476 evidence' }));
}

test('RPP-0476 delete support is bound to the exact matched driver entry', () => {
  const { base, local, remote } = deleteScenario(
    allowedPluginOwnedResource({
      driver: 'wp-postmeta',
      table: 'wp_postmeta',
      supportsDelete: true,
    }),
    allowedPluginOwnedResource({ driver: 'wp-option' }),
  );
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = blockerFor(plan);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.summary.blockers, 1);
  assert.equal(mutationFor(plan), undefined);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.reason, 'Plugin-owned resource driver does not support delete mutations.');
  assert.equal(blocker.resource.table, 'wp_options');
  assert.equal(blocker.resource.id, formsOptionRowId);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.driver, 'wp-option');
  assert.equal(blocker.supportsDelete, false);
  assert.equal(blocker.deleteSupportRefusalEvidence.reasonCode, 'PLUGIN_DRIVER_DELETE_UNSUPPORTED');
  assert.equal(blocker.deleteSupportRefusalEvidence.operation, 'refuse-before-mutation');
  assert.equal(blocker.deleteSupportRefusalEvidence.attemptedAction, 'delete');
  assert.equal(blocker.deleteSupportRefusalEvidence.resourceKey, formsOptionResourceKey);
  assert.equal(blocker.deleteSupportRefusalEvidence.pluginOwner, 'forms');
  assert.equal(blocker.deleteSupportRefusalEvidence.driver, 'wp-option');
  assert.equal(blocker.deleteSupportRefusalEvidence.supportsDelete, false);
  assert.equal(blocker.deleteRefusalEvidence.reasonCode, 'PLUGIN_OWNED_RESOURCE_DELETE_UNSUPPORTED');
  assert.equal(blocker.deleteRefusalEvidence.supportsDelete, false);
  assert.equal(JSON.stringify(blocker).includes('wp-postmeta'), false);
  assertNoRawOptionEvidence(blocker);

  const error = captureError(() => applyPlan(remote, plan));
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('RPP-0476 explicit boolean delete support on the exact wp-option driver applies the delete', () => {
  const { base, local, remote } = deleteScenario(
    allowedPluginOwnedResource({ supportsDelete: true }),
  );

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);
  const applied = applyPlan(cloneJson(remote), plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.preconditions.length, 1);
  assert.equal(mutation.action, 'delete');
  assert.equal(mutation.resource.table, 'wp_options');
  assert.equal(mutation.resource.id, formsOptionRowId);
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, true);
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(mutation.pluginOwnedResource.auditEvidence.supportsDelete, true);
  assert.equal(mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.decision, 'supported');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.action, 'delete');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
  assertNoRawOptionEvidence(mutation.pluginOwnedResource);
  assert.equal(Object.hasOwn(applied.site.db.wp_options, formsOptionRowId), false);
  assert.equal(applied.site.plugins.forms.active, true);
  assert.equal(applied.appliedMutations, 1);
  assert.equal(JSON.stringify(applied.journal).includes(rawOptionMarkers[0]), false);
  assert.equal(JSON.stringify(applied.journal).includes(rawOptionMarkers[1]), false);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(applied.journal, { label: 'RPP-0476 apply journal' }));
});

test('RPP-0476 apply rejects a forged delete whose driver no longer matches the resource', () => {
  const { base, local, remote } = deleteScenario(
    allowedPluginOwnedResource({ supportsDelete: true }),
  );
  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);
  assert.equal(plan.status, 'ready');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, true);

  const forgedPlan = cloneJson(plan);
  const forgedMutation = mutationFor(forgedPlan);
  forgedMutation.pluginOwnedResource.driver = 'wp-postmeta';
  forgedMutation.pluginOwnedResource.supportsDelete = true;
  const forgedRemote = cloneJson(base);
  const remoteBefore = JSON.stringify(forgedRemote);

  const error = captureError(() => applyPlan(forgedRemote, forgedPlan));

  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
  assert.equal(error.details.resourceKey, formsOptionResourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'wp-postmeta');
  assert.equal(error.details.applyValidationEvidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED');
  assert.equal(error.details.applyValidationEvidence.outcome, 'refused-before-mutation');
  assert.equal(error.details.applyValidationEvidence.action, 'delete');
  assert.equal(error.details.applyValidationEvidence.supportsDelete, true);
  assert.equal(error.details.applyValidationEvidence.driver, 'wp-postmeta');
  assert.equal(error.details.applyValidationEvidence.resource.table, 'wp_options');
  assert.equal(error.details.applyValidationEvidence.resource.id, formsOptionRowId);
  assert.equal(error.details.applyValidationEvidence.planned.state, 'absent');
  assert.equal(error.details.applyValidationEvidence.remote.state, 'present');
  assertNoRawOptionEvidence(error.details);
  assert.equal(JSON.stringify(forgedRemote), remoteBefore);
});
