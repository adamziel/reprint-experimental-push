import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const postKeyRowId = 'post_id:41:meta_key:_forms:payload:v4';
const postKeyResourceKey = 'row:["wp_postmeta","post_id:41:meta_key:_forms:payload:v4"]';
const metaIdRowId = 'meta_id:804';
const metaIdResourceKey = 'row:["wp_postmeta","meta_id:804"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function postmetaRow({
  postId = 41,
  metaKey = '_forms:payload:v4',
  metaId = undefined,
  metaValue = 'base-postmeta-payload',
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
  table = 'wp_postmeta',
} = {}) {
  return {
    resourceKey,
    pluginOwner: 'forms',
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

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertNoRawPostmetaPayloads(value, forbiddenValues) {
  const json = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(json.includes(forbiddenValue), false, `leaked raw postmeta payload ${forbiddenValue}`);
  }
  assert.equal(json.includes('meta_value'), false, 'driver evidence must not include raw meta_value fields');
  assert.equal(json.includes('metaValue'), false, 'driver evidence must not include raw metaValue fields');
}

test('RPP-0465 wp_postmeta local-candidate post_id/meta_key proof applies with scoped redacted evidence', () => {
  const basePayload = 'rpp-0465-base-local-candidate-postmeta';
  const localPayload = 'rpp-0465-local-candidate-postmeta';
  const base = baseSite({
    [postKeyRowId]: postmetaRow({ metaValue: basePayload }),
  });
  const local = cloneJson(base);
  local.db.wp_postmeta[postKeyRowId].meta_value = localPayload;
  local.pushIntents = [
    {
      id: 'rpp-0465-update-post-key-meta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [postKeyResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPostmetaResource({ driver: 'wp-post-meta' }),
      ),
    },
  ];
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, postKeyResourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;
  const auditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const applied = applyPlan(cloneJson(remote), plan);

  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.summary, {
    mutations: 1,
    decisions: 0,
    conflicts: 0,
    blockers: 0,
    atomicGroups: 1,
  });
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.atomicGroupId, 'rpp-0465-update-post-key-meta');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-post-meta');
  assert.equal(mutation.pluginOwnedResource.policySource, 'push-intent:rpp-0465-update-post-key-meta');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-post-meta');
  assert.equal(evidence.table, 'wp_postmeta');
  assert.equal(evidence.resourceKey, postKeyResourceKey);
  assert.equal(evidence.rowId, postKeyRowId);
  assert.equal(evidence.rowIdKind, 'post_id_meta_key');
  assert.equal(evidence.postId, 41);
  assert.equal(evidence.metaKey, '_forms:payload:v4');
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.policySource, 'push-intent:rpp-0465-update-post-key-meta');
  assert.equal(evidence.evidenceScope, 'local-candidate');
  assert.equal(evidence.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(auditEvidence.evidenceSource, 'planner-plugin-driver-audit');
  assert.equal(auditEvidence.format, 'hash-only');
  assert.equal(auditEvidence.rawValuesIncluded, false);
  assert.equal(auditEvidence.driverEvidenceHash, digest(evidence));
  assertNoRawPostmetaPayloads({ evidence, auditEvidence }, [basePayload, localPayload]);
  assert.equal(applied.appliedMutations, 1);
  assert.equal(applied.site.db.wp_postmeta[postKeyRowId].post_id, 41);
  assert.equal(applied.site.db.wp_postmeta[postKeyRowId].meta_key, '_forms:payload:v4');
  assert.equal(applied.site.db.wp_postmeta[postKeyRowId].meta_value, localPayload);
});

test('RPP-0465 wp_postmeta remote-snapshot meta_id proof records production-backed release gate scope', () => {
  const basePayload = 'rpp-0465-base-production-backed-postmeta';
  const localPayload = 'rpp-0465-local-production-backed-postmeta';
  const base = baseSite({
    [metaIdRowId]: postmetaRow({
      postId: 42,
      metaKey: '_forms_remote_payload_v4',
      metaId: 804,
      metaValue: basePayload,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_postmeta[metaIdRowId].meta_value = localPayload;
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [
        allowedPostmetaResource({ resourceKey: metaIdResourceKey, driver: 'wp-postmeta' }),
      ],
    },
  };

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, metaIdResourceKey);
  const evidence = mutation.pluginOwnedResource.driverEvidence;
  const auditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const applied = applyPlan(cloneJson(remote), plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-postmeta');
  assert.equal(mutation.pluginOwnedResource.policySource, 'remote-snapshot');
  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-postmeta');
  assert.equal(evidence.table, 'wp_postmeta');
  assert.equal(evidence.resourceKey, metaIdResourceKey);
  assert.equal(evidence.rowId, metaIdRowId);
  assert.equal(evidence.rowIdKind, 'meta_id');
  assert.equal(evidence.postId, 42);
  assert.equal(evidence.metaKey, '_forms_remote_payload_v4');
  assert.equal(evidence.policySource, 'remote-snapshot');
  assert.equal(evidence.evidenceScope, 'production-backed');
  assert.equal(evidence.releaseGateEvidenceScope, 'production-backed');
  assert.equal(auditEvidence.evidenceSource, 'planner-plugin-driver-audit');
  assert.equal(auditEvidence.format, 'hash-only');
  assert.equal(auditEvidence.rawValuesIncluded, false);
  assert.equal(auditEvidence.driverEvidenceHash, digest(evidence));
  assertNoRawPostmetaPayloads({ evidence, auditEvidence }, [basePayload, localPayload]);
  assert.equal(applied.appliedMutations, 1);
  assert.equal(applied.site.db.wp_postmeta[metaIdRowId].meta_id, 804);
  assert.equal(applied.site.db.wp_postmeta[metaIdRowId].post_id, 42);
  assert.equal(applied.site.db.wp_postmeta[metaIdRowId].meta_value, localPayload);
});

test('RPP-0465 wp_postmeta mismatched post_id/meta_key rows fail closed with local-candidate scope', () => {
  const basePayload = 'rpp-0465-base-mismatched-postmeta';
  const localPayload = 'rpp-0465-local-mismatched-postmeta';
  const base = baseSite({
    [postKeyRowId]: postmetaRow({ metaValue: basePayload }),
  });
  const local = cloneJson(base);
  local.db.wp_postmeta[postKeyRowId] = postmetaRow({
    postId: 42,
    metaKey: '_forms:payload:v4',
    metaValue: localPayload,
  });
  local.pushIntents = [
    {
      id: 'rpp-0465-mismatched-post-key-meta',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [postKeyResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPostmetaResource({ driver: 'wp-postmeta' }),
      ),
    },
  ];
  const remote = cloneJson(base);
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers[0];
  const applyError = captureError(() => applyPlan(remote, plan));

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, postKeyResourceKey), undefined);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, postKeyResourceKey);
  assert.equal(blocker.driver, 'wp-postmeta');
  assert.equal(blocker.policySource, 'push-intent:rpp-0465-mismatched-post-key-meta');
  assert.equal(blocker.driverEvidence.supported, false);
  assert.equal(blocker.driverEvidence.driver, 'wp-postmeta');
  assert.equal(blocker.driverEvidence.table, 'wp_postmeta');
  assert.equal(blocker.driverEvidence.rowId, postKeyRowId);
  assert.equal(blocker.driverEvidence.rowIdKind, 'post_id_meta_key');
  assert.equal(blocker.driverEvidence.postId, 41);
  assert.equal(blocker.driverEvidence.metaKey, '_forms:payload:v4');
  assert.equal(blocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(blocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(blocker.reason, /post_id and meta_key to match the resource id/);
  assert.ok(applyError instanceof PushPlanError);
  assert.equal(applyError.code, 'PLAN_NOT_READY');
  assert.deepEqual(applyError.details, { status: 'blocked' });
  assert.equal(JSON.stringify(remote), remoteBefore);
  assertNoRawPostmetaPayloads(blocker, [basePayload, localPayload]);
});
