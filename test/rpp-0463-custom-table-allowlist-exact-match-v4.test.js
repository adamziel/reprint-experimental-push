import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T12:00:00.000Z');
const exactTable = 'wp_reprint_push_forms_lab';
const exactRowId = 'id:1';
const exactResourceKey = `row:["${exactTable}","${exactRowId}"]`;
const rawSentinels = Object.freeze([
  'rpp-0463-v4-base-private-row-value',
  'rpp-0463-v4-local-private-row-value',
  'rpp-0463-v4-near-miss-private-row-value',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function allowedPluginOwnedResource({
  resourceKey = exactResourceKey,
  pluginOwner = 'forms',
  driver = 'fixture-forms-lab-table',
  table = exactTable,
  supportsDelete = false,
} = {}) {
  return {
    resourceKey,
    pluginOwner,
    driver,
    table,
    supportsDelete,
  };
}

function rowNumber(rowId) {
  const match = /^id:([1-9]\d*)$/.exec(rowId);
  assert.ok(match, `test fixture row id must be a positive forms-lab id: ${rowId}`);
  return Number.parseInt(match[1], 10);
}

function baseSite({ table = exactTable, rowId = exactRowId, privateNote = rawSentinels[0] } = {}) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* RPP-0463 forms owner plugin */',
      'wp-content/plugins/reprint-push-forms-fixture/reprint-push-forms-fixture.php':
        '<?php /* RPP-0463 forms-lab table driver fixture */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
      'reprint-push-forms-fixture': { version: '1.0.0', active: true },
    },
    db: {
      [table]: {
        [rowId]: {
          id: rowNumber(rowId),
          form_slug: 'rpp-0463-contact',
          payload: {
            owner: 'forms',
            mode: 'base',
            private_note: privateNote,
          },
          updated_marker: 'base',
          __pluginOwner: 'forms',
        },
      },
    },
  };
}

function editFormsLabRow(site, {
  table = exactTable,
  rowId = exactRowId,
  mode = 'local-exact-allowlist',
  privateNote = rawSentinels[1],
} = {}) {
  site.db[table][rowId].payload.mode = mode;
  site.db[table][rowId].payload.private_note = privateNote;
  site.db[table][rowId].updated_marker = mode;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey = exactResourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey = exactResourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertNoRawSentinels(value) {
  const json = JSON.stringify(value);
  for (const sentinel of rawSentinels) {
    assert.equal(json.includes(sentinel), false, `raw RPP-0463 sentinel leaked: ${sentinel}`);
  }
}

function assertSha256(value) {
  assert.match(value, /^[a-f0-9]{64}$/);
}

test('RPP-0463 exact custom-table allowlist carries one real row mutation through apply', () => {
  const base = baseSite();
  const local = cloneJson(base);
  editFormsLabRow(local);
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);
  const precondition = preconditionFor(plan);
  const beforeMutation = [];

  const result = applyPlan(remote, plan, {
    mutateRemote: true,
    beforeMutation(context) {
      beforeMutation.push({
        mutationIndex: context.mutationIndex,
        resourceKey: context.mutation.resourceKey,
        driverApplyValidation: context.driverApplyValidation,
      });
    },
  });
  const driverApplyValidation = beforeMutation[0].driverApplyValidation;
  const proof = {
    rpp: 'RPP-0463',
    evidenceSource: 'local-production-plugin-driver-test',
    productionBacked: false,
    productionProofShape: 'single-real-custom-table-row-mutation',
    allowlistExact: mutation.pluginOwnedResource.pluginOwner === 'forms'
      && mutation.pluginOwnedResource.driver === 'fixture-forms-lab-table'
      && mutation.pluginOwnedResource.supportsDelete === false
      && mutation.resource.table === exactTable
      && mutation.resource.id === exactRowId
      && mutation.resourceKey === exactResourceKey,
    planner: {
      status: plan.status,
      mutationCount: plan.summary.mutations,
      preconditionCount: plan.preconditions.length,
      blockerCount: plan.blockers.length,
      mutationHash: digest({
        resourceKey: mutation.resourceKey,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      }),
      preconditionHash: digest(precondition),
      auditEvidenceHash: digest(mutation.pluginOwnedResource.auditEvidence),
      driverEvidenceHash: digest(mutation.pluginOwnedResource.driverEvidence),
    },
    apply: {
      appliedMutations: result.appliedMutations,
      journalEntries: result.journal.entries.length,
      beforeMutationHooks: beforeMutation.length,
      driverApplyValidationHash: digest(driverApplyValidation),
      finalRowHash: digest(result.site.db[exactTable][exactRowId]),
    },
  };

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.preconditions.length, 1);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.resourceKey, exactResourceKey);
  assert.equal(mutation.resource.table, exactTable);
  assert.equal(mutation.resource.id, exactRowId);
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'fixture-forms-lab-table');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource.auditEvidence.format, 'hash-only');
  assert.equal(mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource.driverEvidence.source, 'live-remote');
  assert.equal(mutation.pluginOwnedResource.driverEvidence.plugin, 'reprint-push-forms-fixture');
  assert.equal(mutation.pluginOwnedResource.driverEvidence.dryRunValidationEvidence.rawValuesIncluded, false);
  assert.deepEqual(mutation.pluginOwnedResource.driverEvidence.dryRunValidationEvidence.issueCodes, []);
  assertSha256(mutation.baseHash);
  assertSha256(mutation.localHash);
  assert.equal(mutation.remoteBeforeHash, mutation.baseHash);
  assert.equal(precondition.mutationId, mutation.id);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');

  assert.equal(result.site, remote, 'mutateRemote proof should mutate the checked remote object');
  assert.equal(result.appliedMutations, 1);
  assert.equal(remote.db[exactTable][exactRowId].payload.mode, 'local-exact-allowlist');
  assert.equal(remote.db[exactTable][exactRowId].updated_marker, 'local-exact-allowlist');
  assert.equal(result.journal.entries.length, 1);
  assert.equal(result.journal.entries[0].status, 'applied');
  assert.equal(result.journal.entries[0].resourceKey, exactResourceKey);
  assert.equal(beforeMutation.length, 1);
  assert.equal(beforeMutation[0].mutationIndex, 1);
  assert.equal(beforeMutation[0].resourceKey, exactResourceKey);
  assert.equal(driverApplyValidation.reasonCode, 'PLUGIN_DRIVER_APPLY_VALIDATION_ACCEPTED');
  assert.equal(driverApplyValidation.outcome, 'accepted');
  assert.equal(driverApplyValidation.pluginOwner, 'forms');
  assert.equal(driverApplyValidation.driver, 'fixture-forms-lab-table');
  assert.equal(driverApplyValidation.resource.table, exactTable);
  assert.equal(driverApplyValidation.planned.hash, mutation.localHash);
  assert.equal(driverApplyValidation.remote.hash, mutation.remoteBeforeHash);

  assert.equal(proof.allowlistExact, true);
  assert.equal(proof.planner.status, 'ready');
  assert.equal(proof.planner.mutationCount, 1);
  assert.equal(proof.apply.appliedMutations, 1);
  assertNoRawSentinels(mutation.pluginOwnedResource.auditEvidence);
  assertNoRawSentinels(mutation.pluginOwnedResource.driverAuditEvidence);
  assertNoRawSentinels(mutation.pluginOwnedResource.driverEvidence);
  assertNoRawSentinels(driverApplyValidation);
  assertNoRawSentinels(result.journal);
  assertNoRawSentinels(proof);
});

test('RPP-0463 custom-table allowlist near misses fail closed before apply', async (t) => {
  const cases = [
    {
      label: 'wrong plugin owner for exact resource key',
      table: exactTable,
      rowId: exactRowId,
      policyEntry: allowedPluginOwnedResource({ pluginOwner: 'other-forms' }),
      expectedDriver: null,
    },
    {
      label: 'wrong table on exact resource key',
      table: exactTable,
      rowId: exactRowId,
      policyEntry: allowedPluginOwnedResource({ table: 'wp_reprint_push_forms_lab_shadow' }),
      expectedDriver: 'fixture-forms-lab-table',
    },
    {
      label: 'near-miss table name with matching policy entry',
      table: 'wp_reprint_push_forms_lab_shadow',
      rowId: exactRowId,
      policyEntry: allowedPluginOwnedResource({
        resourceKey: 'row:["wp_reprint_push_forms_lab_shadow","id:1"]',
        table: 'wp_reprint_push_forms_lab_shadow',
      }),
      expectedDriver: 'fixture-forms-lab-table',
    },
    {
      label: 'different row id resource key cannot authorize exact row',
      table: exactTable,
      rowId: exactRowId,
      policyEntry: allowedPluginOwnedResource({
        resourceKey: `row:["${exactTable}","id:2"]`,
      }),
      expectedDriver: null,
    },
  ];

  for (const nearMiss of cases) {
    await t.test(nearMiss.label, () => {
      const targetResourceKey = `row:["${nearMiss.table}","${nearMiss.rowId}"]`;
      const base = baseSite({
        table: nearMiss.table,
        rowId: nearMiss.rowId,
        privateNote: rawSentinels[2],
      });
      const local = cloneJson(base);
      editFormsLabRow(local, {
        table: nearMiss.table,
        rowId: nearMiss.rowId,
        mode: 'local-near-miss',
        privateNote: rawSentinels[2],
      });
      local.meta = {
        pushPolicy: pluginOwnedResourcePolicy(nearMiss.policyEntry),
      };
      const remote = cloneJson(base);
      const remoteBefore = cloneJson(remote);

      const plan = planFor(base, local, remote);
      const blocker = plan.blockers.find((entry) => entry.resourceKey === targetResourceKey);
      const error = captureError(() => applyPlan(remote, plan, { mutateRemote: true }));
      const refusalProof = {
        label: nearMiss.label,
        resourceKey: targetResourceKey,
        status: plan.status,
        mutationCount: plan.summary.mutations,
        blockerClass: blocker?.class || null,
        driver: blocker?.driver || null,
        blockerHash: digest(blocker),
        errorCode: error.code,
        errorDetailsHash: digest(error.details),
      };

      assert.equal(plan.status, 'blocked');
      assert.equal(plan.summary.mutations, 0);
      assert.equal(plan.preconditions.length, 0);
      assert.equal(mutationFor(plan, targetResourceKey), undefined);
      assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
      assert.equal(blocker.pluginOwner, 'forms');
      assert.equal(blocker.driver, nearMiss.expectedDriver);
      assertSha256(blocker.baseHash);
      assertSha256(blocker.localHash);
      assert.equal(blocker.remoteHash, blocker.baseHash);
      assert.ok(error instanceof PushPlanError);
      assert.equal(error.code, 'PLAN_NOT_READY');
      assert.deepEqual(remote, remoteBefore);
      assert.equal(refusalProof.status, 'blocked');
      assert.equal(refusalProof.mutationCount, 0);
      assert.equal(refusalProof.errorCode, 'PLAN_NOT_READY');
      assertNoRawSentinels(blocker);
      assertNoRawSentinels(error.details);
      assertNoRawSentinels(refusalProof);
    });
  }
});
