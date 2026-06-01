import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-06-02T00:00:00.000Z');
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
          option_value: { mode: 'remote-preserved-contract' },
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

function explicitContract(extra = {}) {
  return {
    contractVersion: 1,
    contractKind: 'plugin-owned-row-driver',
    resourceKey: formsOptionResourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    table: 'wp_options',
    supportsDelete: false,
    ...extra,
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

test('explicit plugin-owned row driver contract carries accepted proof into the mutation', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-contract-accepted';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitContract()),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const contractEvidence = mutation.pluginOwnedResource.contractValidationEvidence;
  const auditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const result = applyPlan(remote, plan);
  const evidenceJson = JSON.stringify(contractEvidence);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(contractEvidence.schemaVersion, 1);
  assert.equal(contractEvidence.operation, 'plugin-driver-contract-validation');
  assert.equal(contractEvidence.contractKind, 'plugin-owned-row-driver');
  assert.equal(contractEvidence.contractVersion, 1);
  assert.equal(contractEvidence.outcome, 'accepted');
  assert.equal(contractEvidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_ACCEPTED');
  assert.deepEqual(contractEvidence.issueCodes, []);
  assert.equal(contractEvidence.rawValuesIncluded, false);
  assert.equal(contractEvidence.resourceKey, formsOptionResourceKey);
  assert.equal(contractEvidence.pluginOwner, 'forms');
  assert.equal(contractEvidence.driver, 'wp-option');
  assert.equal(contractEvidence.table, 'wp_options');
  assert.match(auditEvidence.contractValidationHash, /^[a-f0-9]{64}$/);
  assert.equal(evidenceJson.includes('local-contract-accepted'), false);
  assert.equal(evidenceJson.includes('remote-preserved-contract'), false);
  assert.equal(result.site.db.wp_options['option_name:forms_settings'].option_value.mode, 'local-contract-accepted');
});

test('unsupported explicit plugin-owned row driver contract version fails closed before mutation', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-contract-unsupported';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitContract({ contractVersion: 2 })),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.contractValidationEvidence;
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'invalid-plugin-driver-contract');
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION');
  assert.equal(blocker.reason, 'Explicit plugin-owned row driver contract is invalid.');
  assert.equal(evidence.outcome, 'refused-before-mutation');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION');
  assert.deepEqual(evidence.issueCodes, ['PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION']);
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(blockerJson.includes('local-contract-unsupported'), false);
  assert.equal(blockerJson.includes('remote-preserved-contract'), false);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('explicit plugin-owned row driver contract without a driver fails closed as a contract error', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-contract-missing-driver';
  const malformed = explicitContract();
  delete malformed.driver;
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(malformed),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const evidence = blocker.contractValidationEvidence;

  assert.equal(plan.status, 'blocked');
  assert.equal(blocker.class, 'invalid-plugin-driver-contract');
  assert.equal(blocker.driver, null);
  assert.equal(blocker.reasonCode, 'PLUGIN_DRIVER_CONTRACT_MISSING_DRIVER');
  assert.equal(evidence.reasonCode, 'PLUGIN_DRIVER_CONTRACT_MISSING_DRIVER');
  assert.deepEqual(evidence.issueCodes, ['PLUGIN_DRIVER_CONTRACT_MISSING_DRIVER']);
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, null);
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
});

test('apply refuses forged ready plans that carry refused plugin driver contract evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-contract-forged-apply';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(explicitContract()),
  };
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const forgedPlan = cloneJson(plan);
  const mutation = mutationFor(forgedPlan, formsOptionResourceKey);
  mutation.pluginOwnedResource.contractValidationEvidence = {
    ...mutation.pluginOwnedResource.contractValidationEvidence,
    outcome: 'refused-before-mutation',
    reasonCode: 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION',
    issueCodes: ['PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION'],
  };

  let error;
  try {
    applyPlan(remote, forgedPlan);
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION');
  assert.equal(error.details.resourceKey, formsOptionResourceKey);
  assert.equal(error.details.pluginOwner, 'forms');
  assert.equal(error.details.driver, 'wp-option');
  assert.equal(
    error.details.contractValidationEvidence.reasonCode,
    'PLUGIN_DRIVER_CONTRACT_UNSUPPORTED_VERSION',
  );
  assert.equal(error.details.contractValidationEvidence.rawValuesIncluded, false);
  assert.equal(JSON.stringify(error.details).includes('local-contract-forged-apply'), false);
  assert.equal(JSON.stringify(error.details).includes('remote-preserved-contract'), false);
  assert.equal(JSON.stringify(remote), remoteBefore);
});
