import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const metaIdRowId = 'meta_id:706';
const metaIdResourceKey = 'row:["wp_termmeta","meta_id:706"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function termmetaRow({
  termId = 10,
  metaKey = '_forms_term_payload',
  metaId = 706,
  metaValue = 'base-termmeta-payload',
} = {}) {
  return {
    meta_id: metaId,
    term_id: termId,
    meta_key: metaKey,
    meta_value: metaValue,
    __pluginOwner: 'forms',
  };
}

function baseSite(wpTermmeta) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_terms: {
        'term_id:10': { term_id: 10, name: 'Forms term', slug: 'forms-term' },
        'term_id:11': { term_id: 11, name: 'Other term', slug: 'other-term' },
      },
      wp_termmeta: wpTermmeta,
    },
  };
}

function allowedTermmetaResource({
  resourceKey = metaIdResourceKey,
  driver = 'wp-termmeta',
  table = undefined,
} = {}) {
  return {
    resourceKey,
    pluginOwner: 'forms',
    driver,
    ...(table === undefined ? {} : { table }),
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

function assertNoRawMetaPayloads(value, forbiddenValues) {
  const json = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(json.includes(forbiddenValue), false, `leaked raw meta payload ${forbiddenValue}`);
  }
  assert.equal(json.includes('meta_value'), false, 'driver evidence must not include raw meta_value fields');
  assert.equal(json.includes('metaValue'), false, 'driver evidence must not include raw metaValue fields');
}

test('RPP-0426 wp_termmeta driver proves local-candidate exact meta_id semantics', () => {
  const basePayload = 'rpp-0426-base-local-candidate-payload';
  const localPayload = 'rpp-0426-local-candidate-payload';
  const base = baseSite({
    [metaIdRowId]: termmetaRow({ metaValue: basePayload }),
  });
  const local = cloneJson(base);
  local.db.wp_termmeta[metaIdRowId].meta_value = localPayload;
  local.pushIntents = [
    {
      id: 'rpp-0426-update-termmeta-meta-id',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [metaIdResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedTermmetaResource({ driver: 'wp-term-meta', table: 'wp_termmeta' }),
      ),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, metaIdResourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.atomicGroupId, 'rpp-0426-update-termmeta-meta-id');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-term-meta');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-term-meta');
  assert.equal(evidence.table, 'wp_termmeta');
  assert.equal(evidence.resourceKey, metaIdResourceKey);
  assert.equal(evidence.rowId, metaIdRowId);
  assert.equal(evidence.rowIdKind, 'meta_id');
  assert.equal(evidence.termId, 10);
  assert.equal(evidence.metaKey, '_forms_term_payload');
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.policySource, 'push-intent:rpp-0426-update-termmeta-meta-id');
  assert.equal(evidence.evidenceScope, 'local-candidate');
  assert.equal(evidence.releaseGateEvidenceScope, 'local-candidate');
  assertNoRawMetaPayloads(evidence, [basePayload, localPayload]);
});

test('RPP-0426 wp_termmeta driver carries production-backed exact meta_id semantics from remote policy', () => {
  const basePayload = 'rpp-0426-base-production-backed-payload';
  const localPayload = 'rpp-0426-local-production-backed-payload';
  const base = baseSite({
    [metaIdRowId]: termmetaRow({
      termId: 11,
      metaKey: '_forms_other_term_payload',
      metaValue: basePayload,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_termmeta[metaIdRowId].meta_value = localPayload;
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [allowedTermmetaResource({ table: 'wp_termmeta' })],
    },
  };

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, metaIdResourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-termmeta');
  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-termmeta');
  assert.equal(evidence.table, 'wp_termmeta');
  assert.equal(evidence.resourceKey, metaIdResourceKey);
  assert.equal(evidence.rowId, metaIdRowId);
  assert.equal(evidence.rowIdKind, 'meta_id');
  assert.equal(evidence.termId, 11);
  assert.equal(evidence.metaKey, '_forms_other_term_payload');
  assert.equal(evidence.policySource, 'remote-snapshot');
  assert.equal(evidence.evidenceScope, 'production-backed');
  assert.equal(evidence.releaseGateEvidenceScope, 'production-backed');
  assertNoRawMetaPayloads(evidence, [basePayload, localPayload]);
});

test('RPP-0426 wp_termmeta driver rejects rows whose payload meta_id differs from the resource id', () => {
  const basePayload = 'rpp-0426-base-mismatch-payload';
  const localPayload = 'rpp-0426-local-mismatch-payload';
  const base = baseSite({
    [metaIdRowId]: termmetaRow({ metaValue: basePayload }),
  });
  const local = cloneJson(base);
  local.db.wp_termmeta[metaIdRowId] = termmetaRow({
    metaId: 707,
    metaValue: localPayload,
  });
  local.pushIntents = [
    {
      id: 'rpp-0426-update-mismatched-meta-id',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [metaIdResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedTermmetaResource({ table: 'wp_termmeta' }),
      ),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, metaIdResourceKey);
  assert.equal(blocker.driver, 'wp-termmeta');
  assert.equal(blocker.policySource, 'push-intent:rpp-0426-update-mismatched-meta-id');
  assert.equal(blocker.driverEvidence.supported, false);
  assert.equal(blocker.driverEvidence.driver, 'wp-termmeta');
  assert.equal(blocker.driverEvidence.table, 'wp_termmeta');
  assert.equal(blocker.driverEvidence.rowId, metaIdRowId);
  assert.equal(blocker.driverEvidence.rowIdKind, 'meta_id');
  assert.equal(blocker.driverEvidence.termId, 10);
  assert.equal(blocker.driverEvidence.metaKey, '_forms_term_payload');
  assert.equal(blocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(blocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(blocker.reason, /meta_id to match the resource id/);
  assertNoRawMetaPayloads(blocker, [basePayload, localPayload]);
});

test('RPP-0426 wp_termmeta driver rejects non-meta_id row identifiers before mutation', () => {
  const unsupportedRowId = 'term_id:10:meta_key:_forms_term_payload';
  const unsupportedResourceKey = 'row:["wp_termmeta","term_id:10:meta_key:_forms_term_payload"]';
  const basePayload = 'rpp-0426-base-row-id-payload';
  const localPayload = 'rpp-0426-local-row-id-payload';
  const base = baseSite({
    [unsupportedRowId]: termmetaRow({ metaValue: basePayload }),
  });
  const local = cloneJson(base);
  local.db.wp_termmeta[unsupportedRowId].meta_value = localPayload;
  local.pushIntents = [
    {
      id: 'rpp-0426-unsupported-row-id',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [unsupportedResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedTermmetaResource({ resourceKey: unsupportedResourceKey, table: 'wp_termmeta' }),
      ),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, unsupportedResourceKey);
  assert.equal(blocker.driver, 'wp-termmeta');
  assert.equal(blocker.policySource, 'push-intent:rpp-0426-unsupported-row-id');
  assert.equal(blocker.driverEvidence.supported, false);
  assert.equal(blocker.driverEvidence.driver, 'wp-termmeta');
  assert.equal(blocker.driverEvidence.table, 'wp_termmeta');
  assert.equal(blocker.driverEvidence.resourceKey, unsupportedResourceKey);
  assert.equal(blocker.driverEvidence.rowId, unsupportedRowId);
  assert.equal(blocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(blocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(blocker.reason, /row id meta_id:<positive-int>/);
  assertNoRawMetaPayloads(blocker, [basePayload, localPayload]);
});

test('RPP-0426 wp_termmeta driver rejects explicit policy table mismatches before mutation', () => {
  const basePayload = 'rpp-0426-base-table-mismatch-payload';
  const localPayload = 'rpp-0426-local-table-mismatch-payload';
  const base = baseSite({
    [metaIdRowId]: termmetaRow({ metaValue: basePayload }),
  });
  const local = cloneJson(base);
  local.db.wp_termmeta[metaIdRowId].meta_value = localPayload;
  local.pushIntents = [
    {
      id: 'rpp-0426-wrong-table-policy',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [metaIdResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedTermmetaResource({ table: 'wp_postmeta' }),
      ),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, metaIdResourceKey);
  assert.equal(blocker.driver, 'wp-termmeta');
  assert.equal(blocker.policySource, 'push-intent:rpp-0426-wrong-table-policy');
  assert.match(blocker.reason, /driver does not match/);
  assert.equal(Object.hasOwn(blocker, 'driverEvidence'), false);
  assertNoRawMetaPayloads(blocker, [basePayload, localPayload]);
});
