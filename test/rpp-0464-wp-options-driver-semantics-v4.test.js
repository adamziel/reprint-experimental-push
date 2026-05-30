import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const formsOptionRowId = 'option_name:forms_settings';
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const formsPluginFilePath = 'wp-content/plugins/forms/forms.php';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite(optionMode = 'base-owned-option') {
  return {
    files: {
      [formsPluginFilePath]: '<?php /* forms plugin 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        [formsOptionRowId]: formsOptionRow(optionMode),
      },
    },
  };
}

function formsOptionRow(mode) {
  return {
    option_name: 'forms_settings',
    option_value: {
      mode,
      nested: { enabled: true },
    },
    autoload: 'no',
    __pluginOwner: 'forms',
  };
}

function pluginOwnedResourcePolicy(...allowedResources) {
  return {
    pluginOwnedResources: {
      allowedResources,
    },
  };
}

function allowedPluginOwnedResource(resourceKey, pluginOwner, driver = 'wp-option', extra = {}) {
  return { resourceKey, pluginOwner, driver, ...extra };
}

function addWpOptionPolicy(site) {
  site.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  return site;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey = formsOptionResourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function assertNoRawOptionValues(value, rawValues) {
  const json = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(json.includes(rawValue), false, `evidence leaked raw option value ${rawValue}`);
  }
  assert.equal(json.includes('option_value'), false, 'evidence must not include raw option_value fields');
}

function assertWpOptionMutationShape(plan, mutation) {
  const precondition = preconditionFor(plan, mutation);

  assert.equal(mutation.action, 'put');
  assert.equal(mutation.resourceKey, formsOptionResourceKey);
  assert.equal(mutation.resource.type, 'row');
  assert.equal(mutation.resource.table, 'wp_options');
  assert.equal(mutation.resource.id, formsOptionRowId);
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(mutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(mutation.pluginOwnedResource.driverAuditEvidence.rawValuesIncluded, false);
  assert.match(mutation.baseHash, sha256HexPattern);
  assert.match(mutation.localHash, sha256HexPattern);
  assert.match(mutation.remoteBeforeHash, sha256HexPattern);
  assert.equal(precondition.resourceKey, formsOptionResourceKey);
  assert.equal(precondition.resource.table, 'wp_options');
  assert.equal(precondition.resource.id, formsOptionRowId);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');
}

test('RPP-0464 wp_options driver plans and applies the exact plugin-owned option row', () => {
  const baseRaw = 'rpp-0464-base-ready-option';
  const localRaw = 'rpp-0464-local-ready-option';
  const base = baseSite(baseRaw);
  const local = addWpOptionPolicy(cloneJson(base));
  local.db.wp_options[formsOptionRowId].option_value.mode = localRaw;
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);
  const result = applyPlan(cloneJson(remote), plan);
  const journalJson = JSON.stringify(result.journal);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.summary.blockers, 0);
  assertWpOptionMutationShape(plan, mutation);
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.site.db.wp_options[formsOptionRowId].option_value.mode, localRaw);
  assert.equal(result.site.db.wp_options[formsOptionRowId].option_name, 'forms_settings');
  assert.equal(result.site.files[formsPluginFilePath], remote.files[formsPluginFilePath]);
  assert.equal(result.site.plugins.forms.active, true);
  assert.equal(journalJson.includes(baseRaw), false);
  assert.equal(journalJson.includes(localRaw), false);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(result.journal, { label: 'RPP-0464 apply journal' }));
});

test('RPP-0464 stale remote wp_options drift preserves plugin-owned remote data before mutation', () => {
  const baseRaw = 'rpp-0464-base-stale-option';
  const localRaw = 'rpp-0464-local-stale-option';
  const driftRaw = 'rpp-0464-remote-drift-option';
  const rawValues = [baseRaw, localRaw, driftRaw];
  const base = baseSite(baseRaw);
  const local = addWpOptionPolicy(cloneJson(base));
  local.db.wp_options[formsOptionRowId].option_value.mode = localRaw;
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);
  const driftedRemote = cloneJson(remote);
  driftedRemote.db.wp_options[formsOptionRowId].option_value.mode = driftRaw;
  driftedRemote.db.wp_options[formsOptionRowId].option_value.remoteOnly = true;
  const rowHashBefore = resourceHash(driftedRemote, mutation.resource);
  const remoteHashBefore = sha256Evidence(driftedRemote);
  const remoteBeforeJson = JSON.stringify(driftedRemote);
  const staleError = captureError(() => applyPlan(driftedRemote, plan));
  const proof = {
    rpp: 'RPP-0464',
    evidenceSource: 'local-focused-wp-options-driver-test',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    acceptedDriver: {
      resourceKey: formsOptionResourceKey,
      driver: mutation.pluginOwnedResource.driver,
      pluginOwner: mutation.pluginOwnedResource.pluginOwner,
      plannerAuditEvidenceHash: sha256Evidence(mutation.pluginOwnedResource.auditEvidence),
      driverDecisionEvidenceHash: sha256Evidence(mutation.pluginOwnedResource.driverAuditEvidence),
      mutationHash: sha256Evidence({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        baseHash: mutation.baseHash,
        localHash: mutation.localHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
      }),
    },
    staleRemotePreservation: {
      code: staleError.code,
      detailsHash: sha256Evidence(staleError.details),
      rowHashBefore: `sha256:${rowHashBefore}`,
      rowHashAfter: `sha256:${resourceHash(driftedRemote, mutation.resource)}`,
      remoteHashBefore,
      remoteHashAfter: sha256Evidence(driftedRemote),
    },
  };
  proof.proofHash = sha256Evidence({
    acceptedDriver: proof.acceptedDriver,
    staleRemotePreservation: proof.staleRemotePreservation,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assertWpOptionMutationShape(plan, mutation);
  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.deepEqual(staleError.details, {
    resourceKey: formsOptionResourceKey,
    expectedHash: mutation.remoteBeforeHash,
    actualHash: rowHashBefore,
  });
  assert.equal(JSON.stringify(driftedRemote), remoteBeforeJson);
  assert.equal(driftedRemote.db.wp_options[formsOptionRowId].option_value.mode, driftRaw);
  assert.equal(driftedRemote.db.wp_options[formsOptionRowId].option_value.remoteOnly, true);
  assert.equal(proof.staleRemotePreservation.rowHashAfter, proof.staleRemotePreservation.rowHashBefore);
  assert.equal(proof.staleRemotePreservation.remoteHashAfter, proof.staleRemotePreservation.remoteHashBefore);
  assert.match(proof.acceptedDriver.plannerAuditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.acceptedDriver.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.staleRemotePreservation.detailsHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawOptionValues(mutation.pluginOwnedResource.auditEvidence, rawValues);
  assertNoRawOptionValues(mutation.pluginOwnedResource.driverAuditEvidence, rawValues);
  assertNoRawOptionValues(staleError.details, rawValues);
  assertNoRawOptionValues(proof, rawValues);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(mutation.pluginOwnedResource.auditEvidence, { label: 'RPP-0464 planner audit evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(mutation.pluginOwnedResource.driverAuditEvidence, { label: 'RPP-0464 driver decision evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(staleError.details, { label: 'RPP-0464 stale precondition details' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0464 stale preservation proof' }));
});
