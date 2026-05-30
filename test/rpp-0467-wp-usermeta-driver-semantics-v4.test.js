import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const expectedGeneratedTiers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
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

function generatedPluginUsermetaShape(testCase) {
  const entry = Object.entries(testCase.local.db.wp_usermeta)
    .find(([, row]) => row.__pluginOwner === 'forms'
      && typeof row.meta_key === 'string'
      && row.meta_key.startsWith('_forms_generated_user_flag_'));
  assert.ok(entry, `${testCase.id} missing generated plugin-owned usermeta row`);
  const [rowId, row] = entry;
  assert.match(rowId, /^umeta_id:[1-9]\d*$/);
  assert.equal(testCase.base.db.wp_usermeta[rowId]?.__pluginOwner, 'forms');
  assert.equal(testCase.remote.db.wp_usermeta[rowId]?.__pluginOwner, 'forms');
  return {
    rowId,
    row,
    resourceKey: `row:${JSON.stringify(['wp_usermeta', rowId])}`,
  };
}

function perTierKeys(coverage) {
  return Object.keys(coverage.perTier).map(Number);
}

function assertNoRawUsermetaPayload(value) {
  const json = JSON.stringify(value);
  assert.equal(json.includes('meta_value'), false, 'evidence must not include raw meta_value fields');
  assert.equal(json.includes('metaValue'), false, 'evidence must not include raw metaValue fields');
  assert.equal(json.includes('local-invalid'), false, 'evidence must not include invalid local usermeta payload values');
  assert.equal(json.includes('"mode"'), false, 'evidence must not include generated payload mode keys');
  assert.equal(json.includes('"ordinal"'), false, 'evidence must not include generated payload ordinals');
  assert.equal(json.includes('"usermetaId"'), false, 'evidence must not include generated payload usermeta ids');
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

test('RPP-0467 generated harness covers supported and unsupported wp_usermeta variants', () => {
  const report = runGeneratedPushHarness();
  const supportedCoverage = report.summary.targetCoverage.usermetaDriverSupported;
  const unsupportedCoverage = report.summary.targetCoverage.usermetaDriverUnsupported;
  const coverageProof = {
    rpp: 'RPP-0467',
    evidenceSource: 'generated-push-harness-summary',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    supportedCoverageHash: sha256Evidence(supportedCoverage),
    unsupportedCoverageHash: sha256Evidence(unsupportedCoverage),
  };
  coverageProof.proofHash = sha256Evidence({
    supportedCoverageHash: coverageProof.supportedCoverageHash,
    unsupportedCoverageHash: coverageProof.unsupportedCoverageHash,
  });

  assert.equal(report.summary.totalCases, DEFAULT_GENERATED_PUSH_CASES);
  assert.ok(supportedCoverage, 'missing supported wp_usermeta driver coverage');
  assert.ok(unsupportedCoverage, 'missing unsupported wp_usermeta driver coverage');
  assert.equal(supportedCoverage.family, 'supported-plugin-usermeta');
  assert.equal(unsupportedCoverage.family, 'unsupported-plugin-usermeta');
  assert.deepEqual(perTierKeys(supportedCoverage), expectedGeneratedTiers);
  assert.deepEqual(perTierKeys(unsupportedCoverage), expectedGeneratedTiers);
  assert.equal(supportedCoverage.statuses.ready, supportedCoverage.total);
  assert.equal(unsupportedCoverage.statuses.blocked, unsupportedCoverage.total);
  assert.equal(unsupportedCoverage.statuses.ready || 0, 0, 'unsupported variants must not be ready');
  assert.ok(supportedCoverage.total >= expectedGeneratedTiers.length);
  assert.ok(unsupportedCoverage.total >= expectedGeneratedTiers.length);
  assert.match(coverageProof.supportedCoverageHash, sha256EvidencePattern);
  assert.match(coverageProof.unsupportedCoverageHash, sha256EvidencePattern);
  assert.match(coverageProof.proofHash, sha256EvidencePattern);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(coverageProof, { label: 'RPP-0467 coverage proof' }));
  assertNoRawUsermetaPayload(report);
});

test('RPP-0467 generated supported wp_usermeta row applies exact row with hash-only audit evidence', () => {
  const supportedCase = generatePushHarnessCases()
    .find((testCase) => testCase.family === 'supported-plugin-usermeta');
  assert.ok(supportedCase, 'missing generated supported wp_usermeta case');
  const supportedShape = generatedPluginUsermetaShape(supportedCase);
  const plan = createPushPlan({
    base: supportedCase.base,
    local: supportedCase.local,
    remote: supportedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const result = applyPlan(cloneJson(supportedCase.remote), plan);
  const validationResult = validateGeneratedCase(supportedCase);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === supportedShape.resourceKey);
  assert.ok(mutation, 'supported wp_usermeta case should emit a mutation');
  const precondition = preconditionFor(plan, mutation);
  const driverEvidence = mutation.pluginOwnedResource.driverEvidence;
  const auditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const driverAuditEvidence = mutation.pluginOwnedResource.driverAuditEvidence;
  const proof = {
    rpp: 'RPP-0467',
    evidenceSource: 'generated-supported-wp-usermeta-row',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    resourceKey: supportedShape.resourceKey,
    driver: mutation.pluginOwnedResource.driver,
    pluginOwner: mutation.pluginOwnedResource.pluginOwner,
    auditEvidenceHash: sha256Evidence(auditEvidence),
    driverDecisionEvidenceHash: sha256Evidence(driverAuditEvidence),
    driverEvidenceHash: sha256Evidence(driverEvidence),
    mutationEvidenceHash: sha256Evidence({
      action: mutation.action,
      changeKind: mutation.changeKind,
      resourceKey: mutation.resourceKey,
      baseHash: mutation.baseHash,
      localHash: mutation.localHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
    }),
    appliedRowHash: `sha256:${resourceHash(result.site, mutation.resource)}`,
  };
  proof.proofHash = sha256Evidence({
    auditEvidenceHash: proof.auditEvidenceHash,
    driverDecisionEvidenceHash: proof.driverDecisionEvidenceHash,
    driverEvidenceHash: proof.driverEvidenceHash,
    mutationEvidenceHash: proof.mutationEvidenceHash,
    appliedRowHash: proof.appliedRowHash,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(validationResult.status, 'ready');
  assert.equal(validationResult.applied, true);
  assert.equal(validationResult.staleReplayRejected, true);
  assert.equal(validationResult.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(validationResult.staleReplayRemoteUnchanged, true);
  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.resource.type, 'row');
  assert.equal(mutation.resource.table, 'wp_usermeta');
  assert.equal(mutation.resource.id, supportedShape.rowId);
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-usermeta');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);
  assert.equal(auditEvidence.format, 'hash-only');
  assert.equal(auditEvidence.rawValuesIncluded, false);
  assert.equal(auditEvidence.driverEvidenceHash, digest(driverEvidence));
  assert.equal(driverAuditEvidence.redaction, 'hash-only');
  assert.equal(driverAuditEvidence.rawValuesIncluded, false);
  assert.equal(driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(driverEvidence.supported, true);
  assert.equal(driverEvidence.driver, 'wp-usermeta');
  assert.equal(driverEvidence.table, 'wp_usermeta');
  assert.equal(driverEvidence.resourceKey, supportedShape.resourceKey);
  assert.equal(driverEvidence.rowId, supportedShape.rowId);
  assert.equal(driverEvidence.rowIdKind, 'umeta_id');
  assert.equal(driverEvidence.userId, supportedShape.row.user_id);
  assert.equal(driverEvidence.metaKey, supportedShape.row.meta_key);
  assert.equal(driverEvidence.policySource, 'local-snapshot');
  assert.equal(driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.equal(precondition.resource.table, 'wp_usermeta');
  assert.equal(precondition.resource.id, supportedShape.rowId);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.deepEqual(result.site.db.wp_usermeta[supportedShape.rowId], supportedCase.local.db.wp_usermeta[supportedShape.rowId]);
  assert.match(proof.auditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.driverEvidenceHash, sha256EvidencePattern);
  assert.match(proof.mutationEvidenceHash, sha256EvidencePattern);
  assert.match(proof.appliedRowHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawUsermetaPayload(driverEvidence);
  assertNoRawUsermetaPayload(auditEvidence);
  assertNoRawUsermetaPayload(driverAuditEvidence);
  assertNoRawUsermetaPayload(proof);
  assertNoRawUsermetaPayload(result.journal);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(auditEvidence, { label: 'RPP-0467 supported audit evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(driverAuditEvidence, { label: 'RPP-0467 supported driver decision evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(driverEvidence, { label: 'RPP-0467 supported driver evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(result.journal, { label: 'RPP-0467 apply journal' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0467 supported proof' }));
});

test('RPP-0467 generated unsupported wp_usermeta row fails closed before mutation', () => {
  const unsupportedCase = generatePushHarnessCases()
    .find((testCase) => testCase.family === 'unsupported-plugin-usermeta');
  assert.ok(unsupportedCase, 'missing generated unsupported wp_usermeta case');
  const unsupportedShape = generatedPluginUsermetaShape(unsupportedCase);
  const plan = createPushPlan({
    base: unsupportedCase.base,
    local: unsupportedCase.local,
    remote: unsupportedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const validationResult = validateGeneratedCase(unsupportedCase);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === unsupportedShape.resourceKey);
  assert.ok(blocker, 'unsupported wp_usermeta case should emit a blocker');
  const remoteBeforeJson = JSON.stringify(unsupportedCase.remote);
  const remoteHashBefore = sha256Evidence(unsupportedCase.remote);
  const error = captureError(() => applyPlan(unsupportedCase.remote, plan));
  const remoteHashAfter = sha256Evidence(unsupportedCase.remote);
  const proof = {
    rpp: 'RPP-0467',
    evidenceSource: 'generated-unsupported-wp-usermeta-row',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    resourceKey: unsupportedShape.resourceKey,
    driver: blocker.driver,
    pluginOwner: blocker.pluginOwner,
    blockerEvidenceHash: sha256Evidence({
      class: blocker.class,
      driver: blocker.driver,
      policySource: blocker.policySource,
      reason: blocker.reason,
      driverEvidence: blocker.driverEvidence,
    }),
    planNotReadyDetailsHash: sha256Evidence(error.details),
    remoteHashBefore,
    remoteHashAfter,
  };
  proof.proofHash = sha256Evidence({
    blockerEvidenceHash: proof.blockerEvidenceHash,
    planNotReadyDetailsHash: proof.planNotReadyDetailsHash,
    remoteHashBefore: proof.remoteHashBefore,
    remoteHashAfter: proof.remoteHashAfter,
  });

  assert.equal(plan.status, 'blocked');
  assert.equal(plan.summary.mutations, 0);
  assert.equal(plan.mutations.some((mutation) => mutation.resourceKey === unsupportedShape.resourceKey), false);
  assert.equal(validationResult.status, 'blocked');
  assert.equal(validationResult.applied, false);
  assert.equal(validationResult.nonReadyRemoteUnchanged, true);
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.deepEqual(error.details, { status: 'blocked' });
  assert.equal(JSON.stringify(unsupportedCase.remote), remoteBeforeJson);
  assert.equal(proof.remoteHashAfter, proof.remoteHashBefore);
  assert.equal(blocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(blocker.resourceKey, unsupportedShape.resourceKey);
  assert.equal(blocker.driver, 'wp-usermeta');
  assert.equal(blocker.pluginOwner, 'forms');
  assert.equal(proof.pluginOwner, 'forms');
  assert.equal(blocker.policySource, 'local-snapshot');
  assert.equal(blocker.driverEvidence.supported, false);
  assert.equal(blocker.driverEvidence.driver, 'wp-usermeta');
  assert.equal(blocker.driverEvidence.table, 'wp_usermeta');
  assert.equal(blocker.driverEvidence.resourceKey, unsupportedShape.resourceKey);
  assert.equal(blocker.driverEvidence.rowId, unsupportedShape.rowId);
  assert.equal(blocker.driverEvidence.rowIdKind, 'umeta_id');
  assert.equal(blocker.driverEvidence.userId, unsupportedShape.row.user_id);
  assert.equal(blocker.driverEvidence.metaKey, unsupportedShape.row.meta_key);
  assert.equal(blocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(blocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(blocker.reason, /umeta_id to match the resource id/);
  assert.match(proof.blockerEvidenceHash, sha256EvidencePattern);
  assert.match(proof.planNotReadyDetailsHash, sha256EvidencePattern);
  assert.match(proof.remoteHashBefore, sha256EvidencePattern);
  assert.match(proof.remoteHashAfter, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawUsermetaPayload(blocker);
  assertNoRawUsermetaPayload(error.details);
  assertNoRawUsermetaPayload(proof);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(blocker, { label: 'RPP-0467 unsupported blocker evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(error.details, { label: 'RPP-0467 plan-not-ready details' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0467 unsupported proof' }));
});
