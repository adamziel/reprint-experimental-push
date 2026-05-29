import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const rowId = 'meta_id:7';
const resourceKey = 'row:[\"wp_termmeta\",\"meta_id:7\"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite(row = termmetaRow({ state: 'base-secret' })) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_terms: {
        'term_id:10': { term_id: 10, name: 'Base term', slug: 'base-term' },
      },
      wp_termmeta: {
        [rowId]: row,
      },
    },
  };
}

function termmetaRow(metaValue, extra = {}) {
  return {
    meta_id: 7,
    term_id: 10,
    meta_key: '_forms_term_payload',
    meta_value: metaValue,
    __pluginOwner: 'forms',
    ...extra,
  };
}

function allowedTermmetaResource(driver = 'wp-termmeta') {
  return {
    resourceKey,
    pluginOwner: 'forms',
    driver,
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

test('RPP-0406 wp_termmeta driver accepts an exact meta_id row and emits redacted driver evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_termmeta[rowId].meta_value = { state: 'local-private-termmeta' };
  local.pushIntents = [
    {
      id: 'update-forms-termmeta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedTermmetaResource()),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.atomicGroupId, 'update-forms-termmeta');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-termmeta');
  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-termmeta');
  assert.equal(evidence.table, 'wp_termmeta');
  assert.equal(evidence.resourceKey, resourceKey);
  assert.equal(evidence.rowId, rowId);
  assert.equal(evidence.rowIdKind, 'meta_id');
  assert.equal(evidence.termId, 10);
  assert.equal(evidence.metaKey, '_forms_term_payload');
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.policySource, 'push-intent:update-forms-termmeta');
  assert.equal(evidence.evidenceScope, 'local-candidate');
  assert.equal(evidence.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(evidenceJson.includes('base-secret'), false);
  assert.equal(evidenceJson.includes('local-private-termmeta'), false);
  assert.equal(Object.hasOwn(evidence, 'meta_value'), false);
  assert.equal(Object.hasOwn(evidence, 'metaValue'), false);
});

test('RPP-0406 wp_termmeta driver carries production-backed release evidence from explicit remote policy metadata', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_termmeta[rowId].meta_value = { state: 'local-production-shaped-termmeta' };
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [allowedTermmetaResource()],
    },
  };

  const plan = planFor(base, local, remote);
  const evidence = mutationFor(plan, resourceKey).pluginOwnedResource.driverEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(evidence.policySource, 'remote-snapshot');
  assert.equal(evidence.evidenceScope, 'production-backed');
  assert.equal(evidence.releaseGateEvidenceScope, 'production-backed');
  assert.equal(evidence.rowIdKind, 'meta_id');
  assert.equal(evidence.termId, 10);
  assert.equal(evidence.metaKey, '_forms_term_payload');
  assert.equal(JSON.stringify(evidence).includes('local-production-shaped-termmeta'), false);
});

test('RPP-0406 wp_termmeta driver alias preserves exact meta_id row semantics', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_termmeta[rowId].meta_value = { state: 'local-alias-private' };
  local.pushIntents = [
    {
      id: 'update-forms-termmeta-alias',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedTermmetaResource('wp-term-meta')),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const evidence = mutationFor(plan, resourceKey).pluginOwnedResource.driverEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(evidence.driver, 'wp-term-meta');
  assert.equal(evidence.rowIdKind, 'meta_id');
  assert.equal(evidence.termId, 10);
  assert.equal(evidence.metaKey, '_forms_term_payload');
  assert.equal(evidence.evidenceScope, 'local-candidate');
  assert.equal(evidence.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(JSON.stringify(evidence).includes('local-alias-private'), false);
});

test('RPP-0406 wp_termmeta driver fails closed when row meta_id does not match the resource id', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_termmeta[rowId] = termmetaRow({ state: 'local-private-mismatch' }, { meta_id: 8 });
  local.pushIntents = [
    {
      id: 'update-forms-termmeta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedTermmetaResource()),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, resourceKey);
  assert.equal(blocker.driver, 'wp-termmeta');
  assert.equal(blocker.driverEvidence.supported, false);
  assert.equal(blocker.driverEvidence.driver, 'wp-termmeta');
  assert.equal(blocker.driverEvidence.rowId, rowId);
  assert.equal(blocker.driverEvidence.rowIdKind, 'meta_id');
  assert.equal(blocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(blocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(blocker.reason, /meta_id to match the resource id/);
  assert.equal(blockerJson.includes('base-secret'), false);
  assert.equal(blockerJson.includes('local-private-mismatch'), false);
  assert.equal(blockerJson.includes('meta_value'), false);
});

test('RPP-0406 wp_termmeta driver rejects non-meta_id row identifiers before mutation', () => {
  const unsupportedRowId = 'term_id:10:meta_key:_forms_term_payload';
  const unsupportedResourceKey = 'row:["wp_termmeta","term_id:10:meta_key:_forms_term_payload"]';
  const base = baseSite();
  base.db.wp_termmeta = {
    [unsupportedRowId]: termmetaRow({ state: 'base-unsupported-row-id-secret' }),
  };
  const local = cloneJson(base);
  local.db.wp_termmeta[unsupportedRowId].meta_value = { state: 'local-unsupported-row-id-private' };
  local.pushIntents = [
    {
      id: 'update-forms-termmeta-unsupported-row-id',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [unsupportedResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy({
        ...allowedTermmetaResource(),
        resourceKey: unsupportedResourceKey,
      }),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, unsupportedResourceKey);
  assert.equal(blocker.driverEvidence.supported, false);
  assert.equal(blocker.driverEvidence.driver, 'wp-termmeta');
  assert.equal(blocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(blocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(blocker.reason, /row id meta_id:<positive-int>/);
  assert.equal(blockerJson.includes('base-unsupported-row-id-secret'), false);
  assert.equal(blockerJson.includes('local-unsupported-row-id-private'), false);
  assert.equal(blockerJson.includes('meta_value'), false);
});
