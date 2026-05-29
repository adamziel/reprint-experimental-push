import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const formsPluginFileResourceKey = 'file:wp-content/plugins/forms/forms.php';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms base plugin file */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'remote-owned-data-preserved' },
          __pluginOwner: 'forms',
        },
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

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
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

function assertHashOnlyDecisionEvidence(evidence, {
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

function assertHashOnlyPlannerAuditEvidence(evidence, mutation) {
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

test('RPP-0419 plugin driver supported audit evidence is hash-only and excludes row values', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-driver-audit';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const decisionEvidence = mutation.pluginOwnedResource.driverAuditEvidence;
  const plannerAuditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const evidenceJson = JSON.stringify({ decisionEvidence, plannerAuditEvidence });

  assert.equal(plan.status, 'ready');
  assertHashOnlyDecisionEvidence(decisionEvidence, {
    reasonCode: 'PLUGIN_DRIVER_DECISION_SUPPORTED',
    decision: 'supported',
  });
  assertHashOnlyPlannerAuditEvidence(plannerAuditEvidence, mutation);
  assert.equal(evidenceJson.includes('local-private-driver-audit'), false);
  assert.equal(evidenceJson.includes('remote-owned-data-preserved'), false);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(decisionEvidence, { label: 'RPP-0419 supported driver decision audit evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(plannerAuditEvidence, { label: 'RPP-0419 supported planner audit evidence' }));
});

test('RPP-0419 remote plugin drift blocks plugin driver decision with hash-only audit evidence and preserves remote data', () => {
  const base = baseSite();
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = 'local-private-driver-audit';
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);
  remote.files['wp-content/plugins/forms/forms.php'] = '<?php /* remote-private-plugin-drift */';
  const remoteBefore = JSON.stringify(remote);

  const plan = planFor(base, local, remote);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === formsOptionResourceKey);
  const decisionEvidence = blocker.driverAuditEvidence;
  const evidenceJson = JSON.stringify(decisionEvidence);
  const blockerJson = JSON.stringify(blocker);

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(mutationFor(plan, formsOptionResourceKey), undefined);
  assert.equal(blocker.class, 'stale-plugin-owner-context');
  assert.equal(blocker.ownerContext[0].resourceKey, formsPluginFileResourceKey);
  assertHashOnlyDecisionEvidence(decisionEvidence, {
    reasonCode: 'PLUGIN_DRIVER_REMOTE_DRIFT_PRESERVED',
    decision: 'blocked',
  });
  assert.equal(evidenceJson.includes('local-private-driver-audit'), false);
  assert.equal(evidenceJson.includes('remote-owned-data-preserved'), false);
  assert.equal(evidenceJson.includes('remote-private-plugin-drift'), false);
  assert.equal(blockerJson.includes('local-private-driver-audit'), false);
  assert.equal(blockerJson.includes('remote-owned-data-preserved'), false);
  assert.equal(blockerJson.includes('remote-private-plugin-drift'), false);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(decisionEvidence, { label: 'RPP-0419 blocked driver decision audit evidence' }));
  assert.throws(() => applyPlan(remote, plan), /Refusing to apply a blocked plan/);
  assert.equal(JSON.stringify(remote), remoteBefore);
  assert.equal(remote.db.wp_options['option_name:forms_settings'].option_value.mode, 'remote-owned-data-preserved');
});

test('RPP-0419 stale remote row drift preserves plugin-owned data while audit proof stays redacted', () => {
  const baseSecret = 'base-private-driver-audit-rpp-0419';
  const localSecret = 'local-private-driver-audit-rpp-0419';
  const driftSecret = 'remote-drift-private-driver-audit-rpp-0419';
  const base = baseSite();
  base.db.wp_options['option_name:forms_settings'].option_value.mode = baseSecret;
  const local = cloneJson(base);
  local.db.wp_options['option_name:forms_settings'].option_value.mode = localSecret;
  local.meta = {
    pushPolicy: pluginOwnedResourcePolicy(
      allowedPluginOwnedResource(formsOptionResourceKey, 'forms', 'wp-option'),
    ),
  };
  const remote = cloneJson(base);

  const plan = planFor(base, local, remote);
  const mutation = mutationFor(plan, formsOptionResourceKey);
  const decisionEvidence = mutation.pluginOwnedResource.driverAuditEvidence;
  const plannerAuditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const driftedRemote = cloneJson(remote);
  driftedRemote.db.wp_options['option_name:forms_settings'].option_value.mode = driftSecret;
  const driftedRowBeforeHash = resourceHash(driftedRemote, mutation.resource);
  const driftedRemoteBefore = JSON.stringify(driftedRemote);
  const staleError = captureError(() => applyPlan(driftedRemote, plan));
  const proof = {
    rpp: 'RPP-0419',
    evidenceSource: 'local-focused-plugin-driver-test',
    productionBacked: false,
    rawValuesIncluded: false,
    driverDecisionAuditEvidenceHash: sha256Evidence(decisionEvidence),
    plannerAuditEvidenceHash: sha256Evidence(plannerAuditEvidence),
    preconditionDetailsHash: sha256Evidence(staleError.details),
    rowHashBefore: `sha256:${driftedRowBeforeHash}`,
    rowHashAfter: `sha256:${resourceHash(driftedRemote, mutation.resource)}`,
  };
  const redactionSurfaceJson = JSON.stringify({ decisionEvidence, plannerAuditEvidence, proof, details: staleError.details });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assertHashOnlyDecisionEvidence(decisionEvidence, {
    reasonCode: 'PLUGIN_DRIVER_DECISION_SUPPORTED',
    decision: 'supported',
  });
  assertHashOnlyPlannerAuditEvidence(plannerAuditEvidence, mutation);
  assert.ok(staleError instanceof PushPlanError);
  assert.equal(staleError.code, 'PRECONDITION_FAILED');
  assert.deepEqual(staleError.details, {
    resourceKey: formsOptionResourceKey,
    expectedHash: mutation.remoteBeforeHash,
    actualHash: driftedRowBeforeHash,
  });
  assert.equal(JSON.stringify(driftedRemote), driftedRemoteBefore);
  assert.equal(driftedRemote.db.wp_options['option_name:forms_settings'].option_value.mode, driftSecret);
  assert.equal(proof.rowHashAfter, proof.rowHashBefore);
  assert.match(proof.driverDecisionAuditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.plannerAuditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.preconditionDetailsHash, sha256EvidencePattern);
  for (const rawValue of [baseSecret, localSecret, driftSecret]) {
    assert.equal(redactionSurfaceJson.includes(rawValue), false, `RPP-0419 evidence leaked ${rawValue}`);
  }
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(decisionEvidence, { label: 'RPP-0419 stale drift driver decision audit evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(plannerAuditEvidence, { label: 'RPP-0419 stale drift planner audit evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0419 stale drift proof evidence' }));
});
