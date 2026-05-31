import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import {
  summarizeWpTermmetaReleaseVerifierEvidence,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const owner = 'forms';
const termId = 446;
const metaId = 10446;
const siblingMetaId = 10447;
const rowId = `meta_id:${metaId}`;
const siblingRowId = `meta_id:${siblingMetaId}`;
const resourceKey = `row:["wp_termmeta","${rowId}"]`;
const targetMetaKey = '_forms_rpp_0446_term_payload';
const siblingMetaKey = '_forms_rpp_0446_term_sibling';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function termmetaRow({
  rowMetaId = metaId,
  rowTermId = termId,
  rowMetaKey = targetMetaKey,
  metaValue = 'rpp-0446-base-termmeta-payload',
} = {}) {
  return {
    meta_id: rowMetaId,
    term_id: rowTermId,
    meta_key: rowMetaKey,
    meta_value: metaValue,
    __pluginOwner: owner,
  };
}

function baseSite(wpTermmeta) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms fixture 1.0 */',
    },
    plugins: {
      [owner]: { version: '1.0.0', active: true },
    },
    db: {
      wp_terms: {
        [`term_id:${termId}`]: { term_id: termId, name: 'RPP-0446 term', slug: 'rpp-0446-term' },
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

function releaseProof(plan) {
  return {
    planObject: plan,
    apply: {
      applyRevalidation: {
        required: 'fresh-live-hashes-before-first-mutation',
        phase: 'before-first-mutation',
        checkedAgainst: 'live-remote',
        verifiedResourceKeys: plan.mutations.map((mutation) => mutation.resourceKey),
      },
    },
  };
}

function fixtureSnapshots({
  basePayload = 'rpp-0446-target-base-private',
  localPayload = 'rpp-0446-target-local-private',
  siblingPayload = 'rpp-0446-sibling-base-private',
} = {}) {
  const base = baseSite({
    [rowId]: termmetaRow({ metaValue: basePayload }),
    [siblingRowId]: termmetaRow({
      rowMetaId: siblingMetaId,
      rowMetaKey: siblingMetaKey,
      metaValue: siblingPayload,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_termmeta[rowId].meta_value = localPayload;
  local.pushIntents = [
    {
      id: 'rpp-0446-update-one-termmeta-row',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(allowedTermmetaResource()),
    },
  ];
  const remote = cloneJson(base);

  return {
    base,
    local,
    remote,
    forbiddenPayloads: [basePayload, localPayload, siblingPayload],
  };
}

function assertSha256(value, label) {
  assert.match(value, sha256Pattern, `${label} should be a sha256 hex digest`);
}

function assertNoRawTermmetaPayloads(value, forbiddenValues) {
  const json = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(json.includes(forbiddenValue), false, `leaked raw termmeta payload ${forbiddenValue}`);
  }
  assert.equal(json.includes('meta_value'), false, 'evidence must not include raw meta_value fields');
  assert.equal(json.includes('metaValue'), false, 'evidence must not include raw metaValue fields');
}

function assertHashOnlyEvidence(mutation, forbiddenPayloads) {
  const auditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const driverAuditEvidence = mutation.pluginOwnedResource.driverAuditEvidence;
  const driverEvidence = mutation.pluginOwnedResource.driverEvidence;

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

  assert.equal(driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(driverAuditEvidence.decision, 'supported');
  assert.equal(driverAuditEvidence.redaction, 'hash-only');
  assert.equal(driverAuditEvidence.rawValuesIncluded, false);
  assertSha256(driverAuditEvidence.hashes.baseHash, 'driver audit baseHash');
  assertSha256(driverAuditEvidence.hashes.localHash, 'driver audit localHash');
  assertSha256(driverAuditEvidence.hashes.remoteHash, 'driver audit remoteHash');

  assertNoRawTermmetaPayloads(driverEvidence, forbiddenPayloads);
  assertNoRawTermmetaPayloads(auditEvidence, forbiddenPayloads);
  assertNoRawTermmetaPayloads(driverAuditEvidence, forbiddenPayloads);
}

test('RPP-0446 wp_termmeta driver plans one scoped live-preconditioned mutation with support-only evidence', () => {
  const siblingDriftPayload = 'rpp-0446-sibling-live-drift-private';
  const { local, remote, forbiddenPayloads } = fixtureSnapshots();

  const plan = planFor(cloneJson(remote), local, remote);
  const mutation = plan.mutations[0];
  const precondition = plan.preconditions[0];
  const evidence = mutation.pluginOwnedResource.driverEvidence;
  const releaseSummary = summarizeWpTermmetaReleaseVerifierEvidence({
    proof: releaseProof(plan),
    checkedProductionEvidence: false,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.deepEqual(plan.mutations.map((entry) => entry.resourceKey), [resourceKey]);
  assert.deepEqual(plan.preconditions.map((entry) => entry.resourceKey), [resourceKey]);
  assert.equal(JSON.stringify(mutation).includes(siblingRowId), false);

  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.atomicGroupId, 'rpp-0446-update-one-termmeta-row');
  assert.equal(mutation.resource.table, 'wp_termmeta');
  assert.equal(mutation.resource.id, rowId);
  assert.equal(mutation.remoteBeforeHash, resourceHash(remote, mutation.resource));

  assert.equal(precondition.mutationId, mutation.id);
  assert.deepEqual(precondition.resource, mutation.resource);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');

  assert.equal(mutation.pluginOwnedResource.pluginOwner, owner);
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-termmeta');
  assert.equal(mutation.pluginOwnedResource.policySource, 'push-intent:rpp-0446-update-one-termmeta-row');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.ok(mutation.pluginOwnedResource.ownerContext.length >= 2);

  assert.equal(evidence.supported, true);
  assert.equal(evidence.driver, 'wp-termmeta');
  assert.equal(evidence.table, 'wp_termmeta');
  assert.equal(evidence.resourceKey, resourceKey);
  assert.equal(evidence.rowId, rowId);
  assert.equal(evidence.rowIdKind, 'meta_id');
  assert.equal(evidence.termId, termId);
  assert.equal(evidence.metaKey, targetMetaKey);
  assert.equal(evidence.pluginOwner, owner);
  assert.equal(evidence.evidenceScope, 'local-candidate');
  assert.equal(evidence.releaseGateEvidenceScope, 'local-candidate');
  assertHashOnlyEvidence(mutation, [...forbiddenPayloads, siblingDriftPayload]);

  assert.equal(releaseSummary.status, 'support_only');
  assert.equal(releaseSummary.verdict, 'WP_TERMMETA_DRIVER_SEMANTICS_SUPPORT_ONLY');
  assert.equal(releaseSummary.evidenceScope, 'local-candidate');
  assert.equal(releaseSummary.releaseGate.status, 'NO-GO');
  assert.equal(releaseSummary.productionBacked, false);
  assert.equal(releaseSummary.acceptedForReleaseGate, false);
  assert.equal(releaseSummary.applyTimeRevalidation.verifiedBeforeFirstMutation, true);
  assert.deepEqual(releaseSummary.missingEvidence, []);
  assert.deepEqual(releaseSummary.mutations.map((entry) => entry.resourceKey), [resourceKey]);
  assertSha256(releaseSummary.mutations[0].driverEvidenceHash, 'release summary driverEvidenceHash');
  assertNoRawTermmetaPayloads(releaseSummary, [...forbiddenPayloads, siblingDriftPayload]);

  const liveRemote = cloneJson(remote);
  liveRemote.db.wp_termmeta[siblingRowId].meta_value = siblingDriftPayload;
  const result = applyPlan(liveRemote, plan, { mutateRemote: true });

  assert.equal(result.appliedMutations, 1);
  assert.equal(result.recoveryState.status, 'fully-updated-remote');
  assert.deepEqual(liveRemote.db.wp_termmeta[rowId], local.db.wp_termmeta[rowId]);
  assert.equal(liveRemote.db.wp_termmeta[siblingRowId].meta_value, siblingDriftPayload);
  assert.equal(result.site.db.wp_termmeta[siblingRowId].meta_value, siblingDriftPayload);
  assert.equal(result.journal.entries.length, 1);
  assert.equal(result.journal.entries[0].resourceKey, resourceKey);
  assertSha256(result.journal.entries[0].beforeHash, 'journal beforeHash');
  assertSha256(result.journal.entries[0].afterHash, 'journal afterHash');
  assertNoRawTermmetaPayloads(result.journal, [...forbiddenPayloads, siblingDriftPayload]);
});

test('RPP-0446 wp_termmeta driver rejects a stale live remote row before mutation', () => {
  const stalePayload = 'rpp-0446-target-stale-remote-private';
  const { local, remote, forbiddenPayloads } = fixtureSnapshots();
  const plan = planFor(cloneJson(remote), local, remote);
  const staleRemote = cloneJson(remote);
  staleRemote.db.wp_termmeta[rowId].meta_value = stalePayload;
  const staleRemoteBeforeApply = cloneJson(staleRemote);
  let preconditionError = null;

  assert.throws(
    () => applyPlan(staleRemote, plan, { mutateRemote: true }),
    (error) => {
      preconditionError = error;
      return error?.code === 'PRECONDITION_FAILED';
    },
  );

  assert.equal(preconditionError.details.resourceKey, resourceKey);
  assertSha256(preconditionError.details.expectedHash, 'precondition expectedHash');
  assertSha256(preconditionError.details.actualHash, 'precondition actualHash');
  assert.notEqual(preconditionError.details.actualHash, preconditionError.details.expectedHash);
  assertNoRawTermmetaPayloads(preconditionError.details, [...forbiddenPayloads, stalePayload]);
  assert.deepEqual(staleRemote, staleRemoteBeforeApply);
});
