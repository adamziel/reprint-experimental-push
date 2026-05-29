import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const rowId = 'umeta_id:7';
const resourceKey = 'row:["wp_usermeta","umeta_id:7"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite(row = usermetaRow({ state: 'base-secret' })) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_users: {
        'ID:1': { ID: 1, user_login: 'base-user', user_email: 'base@example.test' },
      },
      wp_usermeta: {
        [rowId]: row,
      },
    },
  };
}

function usermetaRow(metaValue, extra = {}) {
  return {
    umeta_id: 7,
    user_id: 1,
    meta_key: '_forms_user_payload',
    meta_value: metaValue,
    __pluginOwner: 'forms',
    ...extra,
  };
}

function allowedUsermetaResource(driver = 'wp-usermeta', key = resourceKey) {
  return {
    resourceKey: key,
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

test('RPP-0407 wp_usermeta driver accepts an exact umeta_id row and emits redacted driver evidence', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_usermeta[rowId].meta_value = { state: 'local-private-usermeta' };
  local.pushIntents = [
    {
      id: 'update-forms-usermeta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedUsermetaResource()),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.atomicGroupId, 'update-forms-usermeta');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-usermeta');
  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-usermeta');
  assert.equal(evidence.table, 'wp_usermeta');
  assert.equal(evidence.resourceKey, resourceKey);
  assert.equal(evidence.rowId, rowId);
  assert.equal(evidence.rowIdKind, 'umeta_id');
  assert.equal(evidence.userId, 1);
  assert.equal(evidence.metaKey, '_forms_user_payload');
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.policySource, 'push-intent:update-forms-usermeta');
  assert.equal(evidence.evidenceScope, 'local-candidate');
  assert.equal(evidence.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(evidenceJson.includes('base-secret'), false);
  assert.equal(evidenceJson.includes('local-private-usermeta'), false);
  assert.equal(Object.hasOwn(evidence, 'meta_value'), false);
  assert.equal(Object.hasOwn(evidence, 'metaValue'), false);
});

test('RPP-0407 wp_usermeta driver carries production-backed release evidence from explicit remote policy metadata', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_usermeta[rowId].meta_value = { state: 'local-production-shaped-usermeta' };
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [allowedUsermetaResource()],
    },
  };

  const plan = planFor(base, local, remote);
  const evidence = mutationFor(plan, resourceKey).pluginOwnedResource.driverEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(evidence.policySource, 'remote-snapshot');
  assert.equal(evidence.evidenceScope, 'production-backed');
  assert.equal(evidence.releaseGateEvidenceScope, 'production-backed');
  assert.equal(evidence.rowIdKind, 'umeta_id');
  assert.equal(evidence.userId, 1);
  assert.equal(evidence.metaKey, '_forms_user_payload');
  assert.equal(JSON.stringify(evidence).includes('local-production-shaped-usermeta'), false);
});

test('RPP-0407 wp-user-meta alias preserves exact umeta_id row semantics', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_usermeta[rowId].meta_value = { state: 'local-alias-private' };
  local.pushIntents = [
    {
      id: 'update-forms-usermeta-alias',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedUsermetaResource('wp-user-meta')),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const evidence = mutationFor(plan, resourceKey).pluginOwnedResource.driverEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(evidence.driver, 'wp-user-meta');
  assert.equal(evidence.table, 'wp_usermeta');
  assert.equal(evidence.rowIdKind, 'umeta_id');
  assert.equal(evidence.userId, 1);
  assert.equal(evidence.metaKey, '_forms_user_payload');
  assert.equal(evidence.evidenceScope, 'local-candidate');
  assert.equal(evidence.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(JSON.stringify(evidence).includes('local-alias-private'), false);
});

test('RPP-0407 wp_usermeta driver fails closed when row umeta_id does not match the resource id', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_usermeta[rowId] = usermetaRow({ state: 'local-private-mismatch' }, { umeta_id: 8 });
  local.pushIntents = [
    {
      id: 'update-forms-usermeta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedUsermetaResource()),
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
  assert.equal(blocker.driver, 'wp-usermeta');
  assert.equal(blocker.driverEvidence.supported, false);
  assert.equal(blocker.driverEvidence.driver, 'wp-usermeta');
  assert.equal(blocker.driverEvidence.rowId, rowId);
  assert.equal(blocker.driverEvidence.rowIdKind, 'umeta_id');
  assert.equal(blocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(blocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(blocker.reason, /umeta_id to match the resource id/);
  assert.equal(blockerJson.includes('base-secret'), false);
  assert.equal(blockerJson.includes('local-private-mismatch'), false);
  assert.equal(blockerJson.includes('meta_value'), false);
});

test('RPP-0407 wp_usermeta driver rejects non-umeta_id row identifiers before mutation', () => {
  const unsupportedRowId = 'user_id:1:meta_key:_forms_user_payload';
  const unsupportedResourceKey = 'row:["wp_usermeta","user_id:1:meta_key:_forms_user_payload"]';
  const base = baseSite();
  base.db.wp_usermeta = {
    [unsupportedRowId]: usermetaRow({ state: 'base-unsupported-row-id-secret' }),
  };
  const local = cloneJson(base);
  local.db.wp_usermeta[unsupportedRowId].meta_value = { state: 'local-unsupported-row-id-private' };
  local.pushIntents = [
    {
      id: 'update-forms-usermeta-unsupported-row-id',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [unsupportedResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedUsermetaResource('wp-usermeta', unsupportedResourceKey)),
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
  assert.equal(blocker.driverEvidence.driver, 'wp-usermeta');
  assert.equal(blocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(blocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(blocker.reason, /row id umeta_id:<positive-int>/);
  assert.equal(blockerJson.includes('base-unsupported-row-id-secret'), false);
  assert.equal(blockerJson.includes('local-unsupported-row-id-private'), false);
  assert.equal(blockerJson.includes('meta_value'), false);
});
