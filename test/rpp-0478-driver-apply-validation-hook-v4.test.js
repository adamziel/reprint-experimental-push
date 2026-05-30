import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T15:00:00.000Z');
const optionName = 'rpp_0478_forms_settings';
const optionRowId = `option_name:${optionName}`;
const optionResourceKey = `row:["wp_options","${optionRowId}"]`;
const rawSentinels = Object.freeze([
  'rpp-0478-base-private-apply-token',
  'rpp-0478-local-private-apply-token',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* RPP-0478 forms owner plugin */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        [optionRowId]: {
          option_name: optionName,
          option_value: {
            mode: 'base-apply-validation-proof',
            token: rawSentinels[0],
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
    resourceKey: optionResourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    supportsDelete: false,
    ...extra,
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan) {
  return plan.mutations.find((mutation) => mutation.resourceKey === optionResourceKey);
}

function preconditionFor(plan) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === optionResourceKey);
}

function assertSha256(value) {
  assert.match(value, /^[a-f0-9]{64}$/);
}

function assertNoRawSentinels(value) {
  const json = JSON.stringify(value);
  for (const sentinel of rawSentinels) {
    assert.equal(json.includes(sentinel), false, `raw RPP-0478 sentinel leaked: ${sentinel}`);
  }
  assert.equal(json.includes('base-apply-validation-proof'), false);
  assert.equal(json.includes('local-apply-validation-proof'), false);
}

test('RPP-0478 variant 4 driver apply validation carries one real wp-option mutation through apply', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options[optionRowId].option_value = {
    mode: 'local-apply-validation-proof',
    token: rawSentinels[1],
  };
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource({
        applyValidation: { hook: 'wp-option:validate-apply', status: 'passed' },
      }),
    ),
  };
  const remote = cloneJson(base);
  const remoteBeforeHash = digest(remote);
  const rowBeforeHash = digest(remote.db.wp_options[optionRowId]);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);
  const precondition = preconditionFor(plan);
  const hookEvents = [];

  const result = applyPlan(remote, plan, {
    mutateRemote: true,
    beforeMutation({ mutation: appliedMutation, mutationIndex, remote: liveRemote, driverApplyValidation }) {
      hookEvents.push({
        mutationIndex,
        resourceKey: appliedMutation.resourceKey,
        liveRemoteHash: digest(liveRemote),
        driverApplyValidation,
      });
    },
  });
  const driverApplyValidation = hookEvents[0].driverApplyValidation;
  const remoteAfterHash = digest(remote);
  const rowAfterHash = digest(remote.db.wp_options[optionRowId]);
  const proof = {
    rpp: 'RPP-0478',
    evidenceSource: 'local-production-plugin-driver-test',
    evidenceScope: 'local-production-shaped',
    productionBacked: false,
    releaseGate: 'NO-GO',
    productionProofShape: 'single-real-wp-option-mutation-through-mutateRemote',
    rawValuesIncluded: false,
    planner: {
      status: plan.status,
      mutationCount: plan.summary.mutations,
      blockerCount: plan.summary.blockers,
      conflictCount: plan.summary.conflicts,
      preconditionCount: plan.preconditions.length,
      mutationHash: digest({
        id: mutation.id,
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      }),
      preconditionHash: digest(precondition),
      applyValidationEvidenceHash: digest(mutation.pluginOwnedResource.applyValidationEvidence),
    },
    apply: {
      mutateRemote: result.site === remote,
      remoteChanged: remoteBeforeHash !== remoteAfterHash,
      rowChanged: rowBeforeHash !== rowAfterHash,
      hookCount: hookEvents.length,
      appliedMutations: result.appliedMutations,
      journalEntries: result.journal.entries.length,
      driverApplyValidationHash: digest(driverApplyValidation),
      finalRowHash: rowAfterHash,
    },
  };

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.preconditions.length, 1);
  assert.ok(mutation, 'RPP-0478 should plan the plugin-owned option mutation');
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.resourceKey, optionResourceKey);
  assert.equal(mutation.resource.table, 'wp_options');
  assert.equal(mutation.resource.id, optionRowId);
  assert.equal(mutation.remoteBeforeHash, mutation.baseHash);
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.deepEqual(mutation.pluginOwnedResource.applyValidationEvidence, {
    reasonCode: 'PLUGIN_DRIVER_APPLY_VALIDATION_PASSED',
    operation: 'apply-validation',
    resourceKey: optionResourceKey,
    pluginOwner: 'forms',
    driver: 'wp-option',
    policySource: 'local-snapshot',
    hook: 'wp-option:validate-apply',
    supportedHook: true,
    status: 'passed',
  });
  assert.equal(mutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
  assertSha256(mutation.baseHash);
  assertSha256(mutation.localHash);
  assertSha256(mutation.remoteBeforeHash);

  assert.equal(hookEvents.length, 1);
  assert.equal(hookEvents[0].mutationIndex, 1);
  assert.equal(hookEvents[0].resourceKey, optionResourceKey);
  assert.equal(hookEvents[0].liveRemoteHash, remoteBeforeHash);
  assert.equal(driverApplyValidation.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED');
  assert.equal(driverApplyValidation.operation, 'driver-apply-validation');
  assert.equal(driverApplyValidation.outcome, 'accepted');
  assert.equal(driverApplyValidation.resourceKey, optionResourceKey);
  assert.equal(driverApplyValidation.pluginOwner, 'forms');
  assert.equal(driverApplyValidation.driver, 'wp-option');
  assert.equal(driverApplyValidation.supportsDelete, false);
  assert.equal(driverApplyValidation.action, 'put');
  assert.equal(driverApplyValidation.resource.table, 'wp_options');
  assert.equal(driverApplyValidation.resource.id, optionRowId);
  assert.equal(driverApplyValidation.planned.state, 'present');
  assert.equal(driverApplyValidation.planned.hash, mutation.localHash);
  assert.equal(driverApplyValidation.remote.state, 'present');
  assert.equal(driverApplyValidation.remote.hash, mutation.remoteBeforeHash);

  assert.equal(result.site, remote, 'mutateRemote proof must mutate the checked remote object');
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.journal.entries.length, 1);
  assert.equal(result.journal.entries[0].status, 'applied');
  assert.equal(result.journal.entries[0].resourceKey, optionResourceKey);
  assert.notEqual(remoteAfterHash, remoteBeforeHash);
  assert.notEqual(rowAfterHash, rowBeforeHash);
  assert.equal(remote.db.wp_options[optionRowId].option_value.mode, 'local-apply-validation-proof');
  assert.equal(remote.db.wp_options[optionRowId].option_value.token, rawSentinels[1]);
  assert.equal(remote.plugins.forms.active, true);

  assert.equal(proof.evidenceScope, 'local-production-shaped');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseGate, 'NO-GO');
  assert.equal(proof.planner.status, 'ready');
  assert.equal(proof.planner.mutationCount, 1);
  assert.equal(proof.apply.mutateRemote, true);
  assert.equal(proof.apply.remoteChanged, true);
  assert.equal(proof.apply.rowChanged, true);
  assert.equal(proof.apply.hookCount, 1);
  assert.equal(proof.apply.appliedMutations, 1);
  assertSha256(proof.planner.mutationHash);
  assertSha256(proof.planner.preconditionHash);
  assertSha256(proof.planner.applyValidationEvidenceHash);
  assertSha256(proof.apply.driverApplyValidationHash);
  assertSha256(proof.apply.finalRowHash);
  assertNoRawSentinels(mutation.pluginOwnedResource.auditEvidence);
  assertNoRawSentinels(mutation.pluginOwnedResource.driverAuditEvidence);
  assertNoRawSentinels(mutation.pluginOwnedResource.applyValidationEvidence);
  assertNoRawSentinels(driverApplyValidation);
  assertNoRawSentinels(result.journal);
  assertNoRawSentinels(proof);
});
