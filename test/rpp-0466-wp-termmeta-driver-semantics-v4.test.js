import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const metaId = 9466;
const rowId = `meta_id:${metaId}`;
const resourceKey = `row:["wp_termmeta","${rowId}"]`;
const owner = 'forms';
const metaKey = '_forms_rpp_0466_term_payload';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function termmetaRow({
  rowMetaId = metaId,
  termId = 466,
  rowMetaKey = metaKey,
  metaValue = 'rpp-0466-base-row-payload',
} = {}) {
  return {
    meta_id: rowMetaId,
    term_id: termId,
    meta_key: rowMetaKey,
    meta_value: metaValue,
    __pluginOwner: owner,
  };
}

function baseSite(wpTermmeta = { [rowId]: termmetaRow() }) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms fixture 1.0 */',
    },
    plugins: {
      [owner]: { version: '1.0.0', active: true },
    },
    db: {
      wp_terms: {
        'term_id:466': { term_id: 466, name: 'Forms term', slug: 'forms-term' },
        'term_id:467': { term_id: 467, name: 'Other forms term', slug: 'other-forms-term' },
      },
      wp_termmeta: wpTermmeta,
    },
  };
}

function allowedTermmetaResource({
  allowedResourceKey = resourceKey,
  driver = 'wp-termmeta',
  table = 'wp_termmeta',
} = {}) {
  return {
    resourceKey: allowedResourceKey,
    pluginOwner: owner,
    driver,
    table,
  };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, key) {
  return plan.mutations.find((mutation) => mutation.resourceKey === key);
}

function assertSha256(value, label) {
  assert.match(value, sha256Pattern, `${label} should be a sha256 hex digest`);
}

function assertNoRawMetaPayloads(value, forbiddenValues) {
  const json = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(json.includes(forbiddenValue), false, `leaked raw meta payload ${forbiddenValue}`);
  }
  assert.equal(json.includes('meta_value'), false, 'driver evidence must not include raw meta_value fields');
  assert.equal(json.includes('metaValue'), false, 'driver evidence must not include raw metaValue fields');
}

test('RPP-0466 wp_termmeta driver applies only an exact production-backed meta_id row', () => {
  const basePayload = 'rpp-0466-supported-base-payload';
  const localPayload = 'rpp-0466-supported-local-payload';
  const base = baseSite({
    [rowId]: termmetaRow({ metaValue: basePayload }),
  });
  const local = cloneJson(base);
  local.db.wp_termmeta[rowId].meta_value = localPayload;
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [allowedTermmetaResource()],
    },
  };

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;
  const auditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const driverAuditEvidence = mutation.pluginOwnedResource.driverAuditEvidence;
  const result = applyPlan(remote, plan, { mutateRemote: true });
  const journalEntry = result.journal.entries[0];

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.mutations.length, 1);
  assert.equal(plan.preconditions.length, 1);
  assert.equal(plan.preconditions[0].resourceKey, resourceKey);
  assert.equal(plan.preconditions[0].checkedAgainst, 'live-remote');

  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, owner);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-termmeta');
  assert.equal(mutation.pluginOwnedResource.policySource, 'remote-snapshot');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.ok(mutation.pluginOwnedResource.ownerContext.length >= 2);

  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-termmeta');
  assert.equal(evidence.table, 'wp_termmeta');
  assert.equal(evidence.resourceKey, resourceKey);
  assert.equal(evidence.rowId, rowId);
  assert.equal(evidence.rowIdKind, 'meta_id');
  assert.equal(evidence.termId, 466);
  assert.equal(evidence.metaKey, metaKey);
  assert.equal(evidence.pluginOwner, owner);
  assert.equal(evidence.policySource, 'remote-snapshot');
  assert.equal(evidence.evidenceScope, 'production-backed');
  assert.equal(evidence.releaseGateEvidenceScope, 'production-backed');
  assertNoRawMetaPayloads(evidence, [basePayload, localPayload]);

  assert.equal(auditEvidence.format, 'hash-only');
  assert.equal(auditEvidence.rawValuesIncluded, false);
  assert.equal(auditEvidence.resourceKey, resourceKey);
  assert.equal(auditEvidence.pluginOwner, owner);
  assert.equal(auditEvidence.driver, 'wp-termmeta');
  assertSha256(auditEvidence.baseHash, 'audit baseHash');
  assertSha256(auditEvidence.localHash, 'audit localHash');
  assertSha256(auditEvidence.remoteHash, 'audit remoteHash');
  assertSha256(auditEvidence.ownerContextHash, 'audit ownerContextHash');
  assertSha256(auditEvidence.driverEvidenceHash, 'audit driverEvidenceHash');
  assertNoRawMetaPayloads(auditEvidence, [basePayload, localPayload]);

  assert.equal(driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(driverAuditEvidence.decision, 'supported');
  assert.equal(driverAuditEvidence.redaction, 'hash-only');
  assert.equal(driverAuditEvidence.rawValuesIncluded, false);
  assertSha256(driverAuditEvidence.hashes.baseHash, 'driver audit baseHash');
  assertSha256(driverAuditEvidence.hashes.localHash, 'driver audit localHash');
  assertSha256(driverAuditEvidence.hashes.remoteHash, 'driver audit remoteHash');
  assertNoRawMetaPayloads(driverAuditEvidence, [basePayload, localPayload]);

  assert.equal(result.appliedMutations, 1);
  assert.equal(result.recoveryState.status, 'fully-updated-remote');
  assert.deepEqual(result.site.db.wp_termmeta[rowId], local.db.wp_termmeta[rowId]);
  assert.deepEqual(remote.db.wp_termmeta[rowId], local.db.wp_termmeta[rowId]);
  assert.equal(remote.db.wp_termmeta[rowId].meta_id, metaId);
  assert.equal(remote.db.wp_termmeta[rowId].term_id, 466);
  assert.equal(remote.db.wp_termmeta[rowId].meta_key, metaKey);
  assert.equal(remote.db.wp_termmeta[rowId].meta_value, localPayload);

  assert.equal(result.journal.status, 'completed');
  assert.equal(journalEntry.resourceKey, resourceKey);
  assert.equal(journalEntry.action, 'put');
  assert.equal(journalEntry.status, 'applied');
  assertSha256(journalEntry.beforeHash, 'journal beforeHash');
  assertSha256(journalEntry.afterHash, 'journal afterHash');
  assertNoRawMetaPayloads(result.journal, [basePayload, localPayload]);
});

test('RPP-0466 wp_termmeta driver rejects non-exact termmeta identities before mutation', () => {
  const cases = [
    {
      name: 'payload meta_id differs from resource id',
      caseRowId: rowId,
      caseResourceKey: resourceKey,
      baseRows: {
        [rowId]: termmetaRow({ metaValue: 'rpp-0466-mismatch-base-payload' }),
      },
      mutateLocal(local) {
        local.db.wp_termmeta[rowId] = termmetaRow({
          rowMetaId: metaId + 1,
          metaValue: 'rpp-0466-mismatch-local-payload',
        });
      },
      policy: allowedTermmetaResource(),
      reason: /meta_id to match the resource id/,
      assertBlocker(blocker) {
        assert.equal(blocker.driverEvidence.supported, false);
        assert.equal(blocker.driverEvidence.table, 'wp_termmeta');
        assert.equal(blocker.driverEvidence.rowId, rowId);
        assert.equal(blocker.driverEvidence.rowIdKind, 'meta_id');
        assert.equal(blocker.driverEvidence.termId, 466);
        assert.equal(blocker.driverEvidence.metaKey, metaKey);
      },
      forbidden: ['rpp-0466-mismatch-base-payload', 'rpp-0466-mismatch-local-payload'],
    },
    {
      name: 'resource id is not a meta_id row id',
      caseRowId: `term_id:466:meta_key:${metaKey}`,
      caseResourceKey: `row:["wp_termmeta","term_id:466:meta_key:${metaKey}"]`,
      baseRows: {
        [`term_id:466:meta_key:${metaKey}`]: termmetaRow({
          metaValue: 'rpp-0466-row-id-base-payload',
        }),
      },
      mutateLocal(local) {
        local.db.wp_termmeta[`term_id:466:meta_key:${metaKey}`].meta_value = 'rpp-0466-row-id-local-payload';
      },
      policy: allowedTermmetaResource({
        allowedResourceKey: `row:["wp_termmeta","term_id:466:meta_key:${metaKey}"]`,
      }),
      reason: /row id meta_id:<positive-int>/,
      assertBlocker(blocker) {
        assert.equal(blocker.driverEvidence.supported, false);
        assert.equal(blocker.driverEvidence.table, 'wp_termmeta');
        assert.equal(blocker.driverEvidence.rowId, `term_id:466:meta_key:${metaKey}`);
        assert.equal(blocker.driverEvidence.resourceKey, `row:["wp_termmeta","term_id:466:meta_key:${metaKey}"]`);
        assert.equal(Object.hasOwn(blocker.driverEvidence, 'termId'), false);
        assert.equal(Object.hasOwn(blocker.driverEvidence, 'metaKey'), false);
      },
      forbidden: ['rpp-0466-row-id-base-payload', 'rpp-0466-row-id-local-payload'],
    },
    {
      name: 'explicit policy table does not exactly match wp_termmeta',
      caseRowId: rowId,
      caseResourceKey: resourceKey,
      baseRows: {
        [rowId]: termmetaRow({ metaValue: 'rpp-0466-table-base-payload' }),
      },
      mutateLocal(local) {
        local.db.wp_termmeta[rowId].meta_value = 'rpp-0466-table-local-payload';
      },
      policy: allowedTermmetaResource({ table: 'wp_postmeta' }),
      reason: /driver does not match/,
      assertBlocker(blocker) {
        assert.equal(Object.hasOwn(blocker, 'driverEvidence'), false);
      },
      forbidden: ['rpp-0466-table-base-payload', 'rpp-0466-table-local-payload'],
    },
  ];

  for (const testCase of cases) {
    const base = baseSite(testCase.baseRows);
    const local = cloneJson(base);
    testCase.mutateLocal(local);
    local.pushIntents = [
      {
        id: `rpp-0466-${testCase.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`,
        kind: 'plugin-data-update',
        requireAtomic: true,
        resources: [testCase.caseResourceKey],
        resourcePolicy: pluginOwnedResourcePolicy(testCase.policy),
      },
    ];
    const remote = cloneJson(base);

    const plan = planFor(base, local, remote);
    const blocker = plan.blockers[0];

    assert.equal(plan.status, 'blocked', testCase.name);
    assert.equal(plan.summary.mutations, 0, testCase.name);
    assert.equal(plan.mutations.length, 0, testCase.name);
    assert.equal(plan.preconditions.length, 0, testCase.name);
    assert.equal(blocker.class, 'unsupported-plugin-owned-resource', testCase.name);
    assert.equal(blocker.resourceKey, testCase.caseResourceKey, testCase.name);
    assert.equal(blocker.driver, 'wp-termmeta', testCase.name);
    assert.match(blocker.reason, testCase.reason, testCase.name);
    assert.equal(blocker.policySource.startsWith('push-intent:rpp-0466-'), true, testCase.name);
    testCase.assertBlocker(blocker);
    assertNoRawMetaPayloads(blocker, testCase.forbidden);
    assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/, testCase.name);
    assert.deepEqual(remote, base, testCase.name);
  }
});
