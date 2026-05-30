import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushPlan } from '../src/planner.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const postKeyRowId = 'post_id:41:meta_key:_forms_payload';
const postKeyResourceKey = 'row:["wp_postmeta","post_id:41:meta_key:_forms_payload"]';
const metaIdRowId = 'meta_id:702';
const metaIdResourceKey = 'row:["wp_postmeta","meta_id:702"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function postmetaRow({
  postId = 41,
  metaKey = '_forms_payload',
  metaId = undefined,
  metaValue = 'base-meta-payload',
} = {}) {
  return {
    ...(metaId === undefined ? {} : { meta_id: metaId }),
    post_id: postId,
    meta_key: metaKey,
    meta_value: metaValue,
    __pluginOwner: 'forms',
  };
}

function baseSite(wpPostmeta) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_posts: {
        'ID:41': { ID: 41, post_title: 'Post 41', post_status: 'publish' },
        'ID:42': { ID: 42, post_title: 'Post 42', post_status: 'publish' },
      },
      wp_postmeta: wpPostmeta,
    },
  };
}

function allowedPostmetaResource({
  resourceKey = postKeyResourceKey,
  driver = 'wp-postmeta',
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

test('RPP-0425 wp_postmeta driver proves local-candidate exact post_id/meta_key semantics', () => {
  const basePrivate = 'rpp-0425-base-post-key-private';
  const localPrivate = 'rpp-0425-local-post-key-private';
  const base = baseSite({
    [postKeyRowId]: postmetaRow({ metaValue: basePrivate }),
  });
  const local = cloneJson(base);
  local.db.wp_postmeta[postKeyRowId].meta_value = localPrivate;
  local.pushIntents = [
    {
      id: 'rpp-0425-update-post-key-meta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [postKeyResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPostmetaResource({ driver: 'wp-post-meta', table: 'wp_postmeta' }),
      ),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, postKeyResourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.atomicGroupId, 'rpp-0425-update-post-key-meta');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-post-meta');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-post-meta');
  assert.equal(evidence.table, 'wp_postmeta');
  assert.equal(evidence.resourceKey, postKeyResourceKey);
  assert.equal(evidence.rowId, postKeyRowId);
  assert.equal(evidence.rowIdKind, 'post_id_meta_key');
  assert.equal(evidence.postId, 41);
  assert.equal(evidence.metaKey, '_forms_payload');
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.policySource, 'push-intent:rpp-0425-update-post-key-meta');
  assert.equal(evidence.evidenceScope, 'local-candidate');
  assert.equal(evidence.releaseGateEvidenceScope, 'local-candidate');
  assertNoRawMetaPayloads(evidence, [basePrivate, localPrivate]);
});

test('RPP-0425 wp_postmeta driver carries production-backed exact meta_id semantics from remote policy', () => {
  const basePrivate = 'rpp-0425-base-meta-id-private';
  const localPrivate = 'rpp-0425-local-meta-id-private';
  const base = baseSite({
    [metaIdRowId]: postmetaRow({
      postId: 42,
      metaId: 702,
      metaValue: basePrivate,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_postmeta[metaIdRowId].meta_value = localPrivate;
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [
        allowedPostmetaResource({ resourceKey: metaIdResourceKey, table: 'wp_postmeta' }),
      ],
    },
  };

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, metaIdResourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-postmeta');
  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-postmeta');
  assert.equal(evidence.table, 'wp_postmeta');
  assert.equal(evidence.resourceKey, metaIdResourceKey);
  assert.equal(evidence.rowId, metaIdRowId);
  assert.equal(evidence.rowIdKind, 'meta_id');
  assert.equal(evidence.postId, 42);
  assert.equal(evidence.metaKey, '_forms_payload');
  assert.equal(evidence.policySource, 'remote-snapshot');
  assert.equal(evidence.evidenceScope, 'production-backed');
  assert.equal(evidence.releaseGateEvidenceScope, 'production-backed');
  assertNoRawMetaPayloads(evidence, [basePrivate, localPrivate]);
});

test('RPP-0425 wp_postmeta driver rejects meta_id rows whose payload identity differs from the resource id', () => {
  const basePrivate = 'rpp-0425-base-mismatch-private';
  const localPrivate = 'rpp-0425-local-mismatch-private';
  const base = baseSite({
    [metaIdRowId]: postmetaRow({
      postId: 42,
      metaId: 702,
      metaValue: basePrivate,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_postmeta[metaIdRowId] = postmetaRow({
    postId: 42,
    metaId: 703,
    metaValue: localPrivate,
  });
  local.pushIntents = [
    {
      id: 'rpp-0425-update-mismatched-meta-id',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [metaIdResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPostmetaResource({ resourceKey: metaIdResourceKey, table: 'wp_postmeta' }),
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
  assert.equal(blocker.driver, 'wp-postmeta');
  assert.equal(blocker.driverEvidence.supported, false);
  assert.equal(blocker.driverEvidence.rowId, metaIdRowId);
  assert.equal(blocker.driverEvidence.rowIdKind, 'meta_id');
  assert.equal(blocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(blocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(blocker.reason, /meta_id to match the resource id/);
  assertNoRawMetaPayloads(blocker, [basePrivate, localPrivate]);
});

test('RPP-0425 wp_postmeta driver rejects explicit policy table mismatches before mutation', () => {
  const basePrivate = 'rpp-0425-base-table-private';
  const localPrivate = 'rpp-0425-local-table-private';
  const base = baseSite({
    [postKeyRowId]: postmetaRow({ metaValue: basePrivate }),
  });
  const local = cloneJson(base);
  local.db.wp_postmeta[postKeyRowId].meta_value = localPrivate;
  local.pushIntents = [
    {
      id: 'rpp-0425-wrong-table-policy',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [postKeyResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPostmetaResource({ table: 'wp_usermeta' }),
      ),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, postKeyResourceKey);
  assert.equal(blocker.driver, 'wp-postmeta');
  assert.equal(blocker.policySource, 'push-intent:rpp-0425-wrong-table-policy');
  assert.match(blocker.reason, /driver does not match/);
  assert.equal(Object.hasOwn(blocker, 'driverEvidence'), false);
  assertNoRawMetaPayloads(blocker, [basePrivate, localPrivate]);
});
