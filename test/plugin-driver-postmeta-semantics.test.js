import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const rowId = 'post_id:1:meta_key:_forms_payload';
const resourceKey = 'row:["wp_postmeta","post_id:1:meta_key:_forms_payload"]';
const metaIdRowId = 'meta_id:7';
const metaIdResourceKey = 'row:["wp_postmeta","meta_id:7"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_posts: {
        'ID:1': { ID: 1, post_title: 'Base post', post_status: 'publish' },
      },
      wp_postmeta: {
        [rowId]: postmetaRow({ state: 'base-secret' }),
      },
    },
  };
}

function postmetaRow(metaValue, extra = {}) {
  return {
    post_id: 1,
    meta_key: '_forms_payload',
    meta_value: metaValue,
    __pluginOwner: 'forms',
    ...extra,
  };
}

function allowedPostmetaResource(extra = {}) {
  return {
    resourceKey,
    pluginOwner: 'forms',
    driver: 'wp-postmeta',
    ...extra,
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

test('wp_postmeta driver emits local-candidate release evidence without raw meta payloads', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_postmeta[rowId].meta_value = { state: 'local-private-meta' };
  local.pushIntents = [
    {
      id: 'update-forms-postmeta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedPostmetaResource()),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, resourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-postmeta');
  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-postmeta');
  assert.equal(evidence.table, 'wp_postmeta');
  assert.equal(evidence.resourceKey, resourceKey);
  assert.equal(evidence.rowId, rowId);
  assert.equal(evidence.rowIdKind, 'post_id_meta_key');
  assert.equal(evidence.postId, 1);
  assert.equal(evidence.metaKey, '_forms_payload');
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.policySource, 'push-intent:update-forms-postmeta');
  assert.equal(evidence.evidenceScope, 'local-candidate');
  assert.equal(evidence.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(evidenceJson.includes('base-secret'), false);
  assert.equal(evidenceJson.includes('local-private-meta'), false);
  assert.equal(Object.hasOwn(evidence, 'meta_value'), false);
  assert.equal(Object.hasOwn(evidence, 'metaValue'), false);
});

test('wp_postmeta driver carries production-backed release evidence from explicit remote policy metadata', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_postmeta[rowId].meta_value = { state: 'local-production-shaped-meta' };
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [allowedPostmetaResource()],
    },
  };

  const plan = planFor(base, local, remote);
  const evidence = mutationFor(plan, resourceKey).pluginOwnedResource.driverEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(evidence.policySource, 'remote-snapshot');
  assert.equal(evidence.evidenceScope, 'production-backed');
  assert.equal(evidence.releaseGateEvidenceScope, 'production-backed');
  assert.equal(JSON.stringify(evidence).includes('local-production-shaped-meta'), false);
});

test('RPP-0405 wp_postmeta driver accepts exact meta_id row semantics with redacted local evidence', () => {
  const base = baseSite();
  base.db.wp_postmeta = {
    [metaIdRowId]: postmetaRow({ state: 'base-meta-id-secret' }, { meta_id: 7 }),
  };
  const local = cloneJson(base);
  local.db.wp_postmeta[metaIdRowId].meta_value = { state: 'local-meta-id-private' };
  local.pushIntents = [
    {
      id: 'update-forms-postmeta-meta-id',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [metaIdResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPostmetaResource({ resourceKey: metaIdResourceKey }),
      ),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, metaIdResourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(plan.status, 'ready');
  assert.equal(mutation.atomicGroupId, 'update-forms-postmeta-meta-id');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-postmeta');
  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-postmeta');
  assert.equal(evidence.table, 'wp_postmeta');
  assert.equal(evidence.resourceKey, metaIdResourceKey);
  assert.equal(evidence.rowId, metaIdRowId);
  assert.equal(evidence.rowIdKind, 'meta_id');
  assert.equal(evidence.postId, 1);
  assert.equal(evidence.metaKey, '_forms_payload');
  assert.equal(evidence.policySource, 'push-intent:update-forms-postmeta-meta-id');
  assert.equal(evidence.evidenceScope, 'local-candidate');
  assert.equal(evidence.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(evidenceJson.includes('base-meta-id-secret'), false);
  assert.equal(evidenceJson.includes('local-meta-id-private'), false);
  assert.equal(Object.hasOwn(evidence, 'meta_value'), false);
  assert.equal(Object.hasOwn(evidence, 'metaValue'), false);
});

test('RPP-0405 wp-post-meta alias preserves production-backed release gate scope', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_postmeta[rowId].meta_value = { state: 'local-alias-private' };
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [allowedPostmetaResource({ driver: 'wp-post-meta' })],
    },
  };

  const plan = planFor(base, local, remote);
  const evidence = mutationFor(plan, resourceKey).pluginOwnedResource.driverEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(evidence.driver, 'wp-post-meta');
  assert.equal(evidence.table, 'wp_postmeta');
  assert.equal(evidence.rowIdKind, 'post_id_meta_key');
  assert.equal(evidence.policySource, 'remote-snapshot');
  assert.equal(evidence.evidenceScope, 'production-backed');
  assert.equal(evidence.releaseGateEvidenceScope, 'production-backed');
  assert.equal(JSON.stringify(evidence).includes('local-alias-private'), false);
});

test('wp_postmeta driver fails closed when row semantics do not match the resource id', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_postmeta[rowId] = {
    post_id: 1,
    meta_key: '_other_forms_payload',
    meta_value: { state: 'local-private-mismatch' },
    __pluginOwner: 'forms',
  };
  local.pushIntents = [
    {
      id: 'update-forms-postmeta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedPostmetaResource()),
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
  assert.equal(blocker.driver, 'wp-postmeta');
  assert.equal(blocker.driverEvidence.supported, false);
  assert.equal(blocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(blocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(blocker.reason, /post_id and meta_key to match the resource id/);
  assert.equal(blockerJson.includes('base-secret'), false);
  assert.equal(blockerJson.includes('local-private-mismatch'), false);
  assert.equal(blockerJson.includes('meta_value'), false);
});

test('RPP-0405 wp_postmeta driver rejects unsupported row identifiers before mutation', () => {
  const unsupportedRowId = 'post:1:meta_key:_forms_payload';
  const unsupportedResourceKey = 'row:["wp_postmeta","post:1:meta_key:_forms_payload"]';
  const base = baseSite();
  base.db.wp_postmeta = {
    [unsupportedRowId]: postmetaRow({ state: 'base-unsupported-row-id-secret' }),
  };
  const local = cloneJson(base);
  local.db.wp_postmeta[unsupportedRowId].meta_value = { state: 'local-unsupported-row-id-private' };
  local.pushIntents = [
    {
      id: 'update-forms-postmeta-unsupported-row-id',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [unsupportedResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPostmetaResource({ resourceKey: unsupportedResourceKey }),
      ),
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
  assert.equal(blocker.driver, 'wp-postmeta');
  assert.equal(blocker.driverEvidence.supported, false);
  assert.equal(blocker.driverEvidence.rowIdKind, null);
  assert.match(blocker.reason, /row id post_id:<positive-int>:meta_key:<key> or meta_id:<positive-int>/);
  assert.equal(blockerJson.includes('base-unsupported-row-id-secret'), false);
  assert.equal(blockerJson.includes('local-unsupported-row-id-private'), false);
  assert.equal(blockerJson.includes('meta_value'), false);
});
