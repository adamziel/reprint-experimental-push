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
const formsPluginFileResourceKey = `file:${formsPluginFilePath}`;
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function formsOptionRow(mode) {
  return {
    option_name: 'forms_settings',
    option_value: {
      mode,
      nested: {
        enabled: true,
      },
    },
    autoload: 'no',
    __pluginOwner: 'forms',
  };
}

function baseSite(optionMode = 'rpp-0479-base-plugin-owned-option') {
  return {
    files: {
      [formsPluginFilePath]: '<?php /* forms plugin rpp-0479 base */',
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

function addFormsOptionPolicy(site) {
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

function blockerFor(plan, resourceKey = formsOptionResourceKey) {
  return plan.blockers.find((blocker) => blocker.resourceKey === resourceKey);
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

function assertNoRawOptionPayloads(value, rawValues, label) {
  const json = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(json.includes(rawValue), false, `${label} leaked raw payload ${rawValue}`);
  }
  assert.equal(json.includes('option_value'), false, `${label} must not include raw option_value fields`);
  assert.equal(json.includes('__pluginOwner'), false, `${label} must not include raw owner marker fields`);
}

function assertDriverDecisionEvidence(evidence, {
  reasonCode,
  decision,
  action = 'put',
}) {
  assert.equal(evidence.reasonCode, reasonCode);
  assert.equal(evidence.operation, 'plugin-driver-audit');
  assert.equal(evidence.decision, decision);
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'wp-option');
  assert.equal(evidence.policySource, 'local-snapshot');
  assert.equal(evidence.action, action);
  assert.equal(evidence.redaction, 'hash-only');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.match(evidence.hashes.baseHash, sha256HexPattern);
  assert.match(evidence.hashes.localHash, sha256HexPattern);
  assert.match(evidence.hashes.remoteHash, sha256HexPattern);
}

function assertPlannerAuditEvidence(evidence, mutation) {
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.evidenceSource, 'planner-plugin-driver-audit');
  assert.equal(evidence.format, 'hash-only');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.resourceKey, formsOptionResourceKey);
  assert.equal(evidence.pluginOwner, 'forms');
  assert.equal(evidence.driver, 'wp-option');
  assert.equal(evidence.policySource, 'local-snapshot');
  assert.equal(evidence.supportsDelete, false);
  assert.equal(evidence.baseHash, mutation.baseHash);
  assert.equal(evidence.localHash, mutation.localHash);
  assert.equal(evidence.remoteHash, mutation.remoteBeforeHash);
  assert.match(evidence.ownerContextHash, sha256HexPattern);
}

test('RPP-0479 remote owner-context drift emits hash-only driver audit evidence and preserves plugin-owned remote data', () => {
  const baseRaw = 'rpp-0479-owner-context-base-option';
  const localRaw = 'rpp-0479-owner-context-local-option';
  const remotePluginFileDrift = '<?php /* rpp-0479 remote owner context drift */';
  const rawValues = [baseRaw, localRaw, remotePluginFileDrift];
  const base = baseSite(baseRaw);
  const local = addFormsOptionPolicy(cloneJson(base));
  local.db.wp_options[formsOptionRowId].option_value.mode = localRaw;
  const remote = cloneJson(base);
  remote.files[formsPluginFilePath] = remotePluginFileDrift;
  const remoteBeforeJson = JSON.stringify(remote);
  const remoteRowHashBefore = resourceHash(remote, {
    type: 'row',
    table: 'wp_options',
    id: formsOptionRowId,
    key: formsOptionResourceKey,
  });

  const plan = planFor(base, local, remote);
  const blocker = blockerFor(plan);
  assert.ok(blocker, 'remote owner-context drift should block the plugin-owned option mutation');
  const applyError = captureError(() => applyPlan(remote, plan, { mutateRemote: true }));
  const proof = {
    rpp: 'RPP-0479',
    evidenceSource: 'local-focused-driver-audit-owner-context-drift-v4',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    blockedDriverDecision: {
      resourceKey: formsOptionResourceKey,
      ownerContextResourceKey: formsPluginFileResourceKey,
      reasonCode: blocker.driverAuditEvidence.reasonCode,
      decisionEvidenceHash: sha256Evidence(blocker.driverAuditEvidence),
      blockerHash: sha256Evidence({
        class: blocker.class,
        resourceKey: blocker.resourceKey,
        pluginOwner: blocker.pluginOwner,
        driver: blocker.driver,
        policySource: blocker.policySource,
        baseHash: blocker.baseHash,
        localHash: blocker.localHash,
        remoteHash: blocker.remoteHash,
        driverAuditEvidence: blocker.driverAuditEvidence,
        ownerContextRefusalEvidence: blocker.ownerContextRefusalEvidence,
      }),
    },
    remotePreservation: {
      code: applyError.code,
      errorDetailsHash: sha256Evidence(applyError.details),
      rowHashBefore: `sha256:${remoteRowHashBefore}`,
      rowHashAfter: `sha256:${resourceHash(remote, blocker.resource)}`,
      remoteHashBefore: sha256Evidence(JSON.parse(remoteBeforeJson)),
      remoteHashAfter: sha256Evidence(remote),
    },
  };
  proof.proofHash = sha256Evidence({
    blockedDriverDecision: proof.blockedDriverDecision,
    remotePreservation: proof.remotePreservation,
  });

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.resourceKey, formsOptionResourceKey);
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(blocker.driver, 'wp-option');
  assert.equal(blocker.policySource, 'local-snapshot');
  assert.equal(blocker.ownerContext[0].resourceKey, formsPluginFileResourceKey);
  assert.equal(blocker.ownerContextRefusalEvidence.reasonCode, 'STALE_PLUGIN_FILE_OWNER_CONTEXT');
  assertDriverDecisionEvidence(blocker.driverAuditEvidence, {
    reasonCode: 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED',
    decision: 'blocked',
  });
  assert.ok(applyError instanceof PushPlanError);
  assert.equal(applyError.code, 'PLAN_NOT_READY');
  assert.deepEqual(applyError.details, { status: 'blocked' });
  assert.equal(JSON.stringify(remote), remoteBeforeJson);
  assert.equal(remote.db.wp_options[formsOptionRowId].option_value.mode, baseRaw);
  assert.equal(proof.remotePreservation.rowHashAfter, proof.remotePreservation.rowHashBefore);
  assert.equal(proof.remotePreservation.remoteHashAfter, proof.remotePreservation.remoteHashBefore);
  assert.match(proof.blockedDriverDecision.decisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.blockedDriverDecision.blockerHash, sha256EvidencePattern);
  assert.match(proof.remotePreservation.errorDetailsHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawOptionPayloads(blocker, rawValues, 'RPP-0479 owner-context blocker');
  assertNoRawOptionPayloads(applyError.details, rawValues, 'RPP-0479 owner-context error details');
  assertNoRawOptionPayloads(proof, rawValues, 'RPP-0479 owner-context proof');
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(blocker, { label: 'RPP-0479 owner-context blocker evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(applyError.details, { label: 'RPP-0479 owner-context error details' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0479 owner-context proof' }));
});

test('RPP-0479 stale remote row drift preserves plugin-owned remote data while audit evidence stays redacted', () => {
  const baseRaw = 'rpp-0479-stale-base-option';
  const localRaw = 'rpp-0479-stale-local-option';
  const remoteDriftRaw = 'rpp-0479-stale-remote-drift-option';
  const remoteOnlyRaw = 'rpp-0479-stale-remote-only-field';
  const rawValues = [baseRaw, localRaw, remoteDriftRaw, remoteOnlyRaw];
  const base = baseSite(baseRaw);
  const local = addFormsOptionPolicy(cloneJson(base));
  local.db.wp_options[formsOptionRowId].option_value.mode = localRaw;
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan);
  assert.ok(mutation, 'ready plan should include the plugin-owned option mutation');
  const plannerAuditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const driverDecisionEvidence = mutation.pluginOwnedResource.driverAuditEvidence;
  const driftedRemote = cloneJson(remote);
  driftedRemote.db.wp_options[formsOptionRowId].option_value.mode = remoteDriftRaw;
  driftedRemote.db.wp_options[formsOptionRowId].option_value.remoteOnly = remoteOnlyRaw;
  const driftedRowBeforeHash = resourceHash(driftedRemote, mutation.resource);
  const driftedRemoteBeforeHash = sha256Evidence(driftedRemote);
  const driftedRemoteBeforeJson = JSON.stringify(driftedRemote);
  let beforeMutationCalls = 0;
  const staleError = captureError(() => applyPlan(driftedRemote, plan, {
    mutateRemote: true,
    beforeMutation() {
      beforeMutationCalls += 1;
    },
  }));
  const proof = {
    rpp: 'RPP-0479',
    evidenceSource: 'local-focused-driver-audit-row-drift-v4',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    acceptedDriverAudit: {
      resourceKey: formsOptionResourceKey,
      pluginOwner: 'forms',
      driver: 'wp-option',
      plannerAuditEvidenceHash: sha256Evidence(plannerAuditEvidence),
      driverDecisionEvidenceHash: sha256Evidence(driverDecisionEvidence),
      ownerContextHash: `sha256:${plannerAuditEvidence.ownerContextHash}`,
    },
    staleRemotePreservation: {
      code: staleError.code,
      beforeMutationCalls,
      preconditionDetailsHash: sha256Evidence(staleError.details),
      rowHashBefore: `sha256:${driftedRowBeforeHash}`,
      rowHashAfter: `sha256:${resourceHash(driftedRemote, mutation.resource)}`,
      remoteHashBefore: driftedRemoteBeforeHash,
      remoteHashAfter: sha256Evidence(driftedRemote),
    },
  };
  proof.proofHash = sha256Evidence({
    acceptedDriverAudit: proof.acceptedDriverAudit,
    staleRemotePreservation: proof.staleRemotePreservation,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.preconditions.length, 1);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-option');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assertPlannerAuditEvidence(plannerAuditEvidence, mutation);
  assertDriverDecisionEvidence(driverDecisionEvidence, {
    reasonCode: 'PLUGIN_DRIVER_DECISION_SUPPORTED',
    decision: 'supported',
  });
  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.equal(beforeMutationCalls, 0);
  assert.deepEqual(staleError.details, {
    resourceKey: formsOptionResourceKey,
    expectedHash: mutation.remoteBeforeHash,
    actualHash: driftedRowBeforeHash,
  });
  assert.equal(JSON.stringify(driftedRemote), driftedRemoteBeforeJson);
  assert.equal(driftedRemote.db.wp_options[formsOptionRowId].option_value.mode, remoteDriftRaw);
  assert.equal(driftedRemote.db.wp_options[formsOptionRowId].option_value.remoteOnly, remoteOnlyRaw);
  assert.equal(proof.staleRemotePreservation.rowHashAfter, proof.staleRemotePreservation.rowHashBefore);
  assert.equal(proof.staleRemotePreservation.remoteHashAfter, proof.staleRemotePreservation.remoteHashBefore);
  assert.match(proof.acceptedDriverAudit.plannerAuditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.acceptedDriverAudit.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.acceptedDriverAudit.ownerContextHash, sha256EvidencePattern);
  assert.match(proof.staleRemotePreservation.preconditionDetailsHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawOptionPayloads(plannerAuditEvidence, rawValues, 'RPP-0479 planner audit evidence');
  assertNoRawOptionPayloads(driverDecisionEvidence, rawValues, 'RPP-0479 driver decision evidence');
  assertNoRawOptionPayloads(staleError.details, rawValues, 'RPP-0479 stale precondition details');
  assertNoRawOptionPayloads(proof, rawValues, 'RPP-0479 stale preservation proof');
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(plannerAuditEvidence, { label: 'RPP-0479 planner audit evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(driverDecisionEvidence, { label: 'RPP-0479 driver decision evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(staleError.details, { label: 'RPP-0479 stale precondition details' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0479 stale preservation proof' }));
});
