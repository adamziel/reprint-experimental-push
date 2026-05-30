import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const formsOptionResourceKey = 'row:["wp_options","option_name:rpp_0436_forms_settings"]';
const rawSentinel = 'RPP-0436-RAW-DELETE-SUPPORT-SENTINEL';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* rpp-0436 forms plugin */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:rpp_0436_forms_settings': {
          option_name: 'rpp_0436_forms_settings',
          option_value: {
            mode: 'delete-support-proof',
            secret: rawSentinel,
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

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan) {
  return plan.mutations.find((mutation) => mutation.resourceKey === formsOptionResourceKey);
}

function deleteScenario(policyEntryExtra) {
  const base = baseSite();
  const local = cloneJson(base);
  delete local.db.wp_options['option_name:rpp_0436_forms_settings'];
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(policyEntryExtra),
    ),
  };
  return { base, local, remote: cloneJson(base) };
}

function assertNoRawRowEvidence(value) {
  const json = JSON.stringify(value);
  assert.equal(json.includes(rawSentinel), false);
  assert.equal(json.includes('delete-support-proof'), false);
  assert.equal(json.includes('option_value'), false);
  assert.equal(json.includes('autoload'), false);
}

test('RPP-0436 unsupported delete support flag values fail closed before mutation with redacted evidence', async (t) => {
  const unsupportedCases = [
    ['omitted supportsDelete', {}],
    ['explicit supportsDelete false', { supportsDelete: false }],
    ['delete alias false', { delete: false }],
    ['allowDelete alias false', { allowDelete: false }],
    ['string supportsDelete is not accepted', { supportsDelete: 'true' }],
    ['numeric delete alias is not accepted', { delete: 1 }],
  ];

  for (const [label, policyEntryExtra] of unsupportedCases) {
    await t.test(label, () => {
      const { base, local, remote } = deleteScenario(policyEntryExtra);
      const remoteBefore = JSON.stringify(remote);

      const plan = planFor(base, local, remote);
      const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
      const deleteSupportEvidence = blocker?.deleteSupportRefusalEvidence;

      assert.equal(plan.status, 'blocked');
      assert.equal(plan.summary.mutations, 0);
      assert.equal(mutationFor(plan), undefined);
      assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
      assert.equal(blocker.reason, 'Plugin-owned resource driver does not support delete mutations.');
      assert.equal(blocker.driver, 'wp-option');
      assert.equal(blocker.supportsDelete, false);
      assert.equal(deleteSupportEvidence.schemaVersion, 1);
      assert.equal(deleteSupportEvidence.reasonCode, 'PLUGIN_DRIVER_DELETE_UNSUPPORTED');
      assert.equal(deleteSupportEvidence.operation, 'refuse-before-mutation');
      assert.equal(deleteSupportEvidence.attemptedAction, 'delete');
      assert.equal(deleteSupportEvidence.redaction, 'metadata-only');
      assert.equal(deleteSupportEvidence.rawValuesIncluded, false);
      assert.equal(deleteSupportEvidence.resourceKey, formsOptionResourceKey);
      assert.equal(deleteSupportEvidence.pluginOwner, 'forms');
      assert.equal(deleteSupportEvidence.driver, 'wp-option');
      assert.equal(deleteSupportEvidence.supportsDelete, false);
      assert.equal(blocker.deleteRefusalEvidence.reasonCode, 'PLUGIN_OWNED_RESOURCE_DELETE_UNSUPPORTED');
      assert.equal(blocker.deleteRefusalEvidence.supportsDelete, false);
      assertNoRawRowEvidence(blocker);

      assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
      assert.equal(JSON.stringify(remote), remoteBefore);
    });
  }
});

test('RPP-0436 boolean true delete support flags are the only planner opt-ins that emit delete mutations', async (t) => {
  const supportedCases = [
    ['supportsDelete true', { supportsDelete: true }],
    ['delete alias true', { delete: true }],
    ['allowDelete alias true', { allowDelete: true }],
  ];

  for (const [label, policyEntryExtra] of supportedCases) {
    await t.test(label, () => {
      const { base, local, remote } = deleteScenario(policyEntryExtra);

      const plan = planFor(base, local, remote);
      const mutation = mutationFor(plan);
      const result = applyPlan(remote, plan);

      assert.equal(plan.status, 'ready');
      assert.equal(plan.blockers.length, 0);
      assert.equal(plan.summary.mutations, 1);
      assert.equal(mutation.action, 'delete');
      assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
      assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
      assert.equal(mutation.pluginOwnedResource.supportsDelete, true);
      assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.action, 'delete');
      assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
      assert.equal(
        Object.hasOwn(result.site.db.wp_options, 'option_name:rpp_0436_forms_settings'),
        false,
      );
      assert.equal(result.site.plugins.forms.active, true);
      assertNoRawRowEvidence(mutation.pluginOwnedResource);
    });
  }
});

test('RPP-0436 forged ready deletes still fail closed at apply when the explicit boolean flag is missing', () => {
  const { base, local, remote } = deleteScenario({ supportsDelete: true });
  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.action, 'delete');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, true);

  const forgedCases = [
    ['supportsDelete false', false],
    ['supportsDelete missing', undefined],
    ['supportsDelete string true', 'true'],
    ['supportsDelete numeric one', 1],
  ];

  for (const [, forgedSupportsDelete] of forgedCases) {
    const forgedPlan = cloneJson(plan);
    const forgedMutation = mutationFor(forgedPlan);
    if (forgedSupportsDelete === undefined) {
      delete forgedMutation.pluginOwnedResource.supportsDelete;
    } else {
      forgedMutation.pluginOwnedResource.supportsDelete = forgedSupportsDelete;
    }
    const forgedRemote = cloneJson(base);
    const remoteBefore = JSON.stringify(forgedRemote);

    assert.throws(
      () => applyPlan(forgedRemote, forgedPlan),
      (error) => {
        assert.equal(error.code, 'UNSUPPORTED_PLUGIN_OWNED_RESOURCE');
        assert.equal(error.details.resourceKey, formsOptionResourceKey);
        assert.equal(error.details.pluginOwner, 'forms');
        assert.equal(error.details.driver, 'wp-option');
        assert.equal(error.details.applyValidationEvidence.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_REFUSED');
        assert.equal(error.details.applyValidationEvidence.outcome, 'refused-before-mutation');
        assert.equal(error.details.applyValidationEvidence.action, 'delete');
        assert.equal(error.details.applyValidationEvidence.supportsDelete, false);
        assert.equal(error.details.applyValidationEvidence.planned.state, 'absent');
        assert.equal(error.details.applyValidationEvidence.remote.state, 'present');
        assert.match(error.details.applyValidationEvidence.planned.hash, /^[a-f0-9]{64}$/);
        assert.match(error.details.applyValidationEvidence.remote.hash, /^[a-f0-9]{64}$/);
        assertNoRawRowEvidence(error.details);
        return true;
      },
    );
    assert.equal(JSON.stringify(forgedRemote), remoteBefore);
  }
});
