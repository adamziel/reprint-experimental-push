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
import {
  summarizeWpUsermetaReleaseVerifierEvidence,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const generatedCases = generatePushHarnessCases();
const expectedGeneratedTiers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const sha256Pattern = /^[a-f0-9]{64}$/;
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

function generatedPluginUsermetaShape(testCase, { expectExactRowId = false } = {}) {
  const entry = Object.entries(testCase.local.db.wp_usermeta)
    .find(([, row]) => row.__pluginOwner === 'forms'
      && typeof row.meta_key === 'string'
      && row.meta_key.startsWith('_forms_generated_user_flag_'));
  assert.ok(entry, `${testCase.id} missing generated plugin-owned usermeta row`);
  const [rowId, row] = entry;
  assert.match(rowId, /^umeta_id:[1-9]\d*$/);
  if (expectExactRowId) {
    assert.equal(row.umeta_id, Number(rowId.slice('umeta_id:'.length)));
  }
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

function planFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedNow,
  });
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
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

function summaryFor(args = {}) {
  return summarizeWpUsermetaReleaseVerifierEvidence({
    generatedCases,
    ...args,
  });
}

function assertSha256(value, label) {
  assert.match(value, sha256Pattern, `${label} should be a sha256 hex digest`);
}

function assertNoRawUsermetaPayloads(value, forbiddenValues = []) {
  const json = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(json.includes(forbiddenValue), false, `leaked raw usermeta payload ${forbiddenValue}`);
  }
  assert.equal(json.includes('meta_value'), false, 'evidence must not include raw meta_value fields');
  assert.equal(json.includes('metaValue'), false, 'evidence must not include raw metaValue fields');
  assert.equal(json.includes('local-invalid'), false, 'generated unsupported payload marker must stay out of evidence');
  assert.equal(json.includes('"mode"'), false, 'generated structured payload keys must stay out of evidence');
  assert.equal(json.includes('"ordinal"'), false, 'generated payload ordinals must stay out of evidence');
  assert.equal(json.includes('"usermetaId"'), false, 'generated payload ids must stay out of evidence');
}

function assertHashOnlyMutationEvidence({ mutation, shape, forbiddenValues = [] }) {
  const auditEvidence = mutation.pluginOwnedResource.auditEvidence;
  const driverAuditEvidence = mutation.pluginOwnedResource.driverAuditEvidence;
  const driverEvidence = mutation.pluginOwnedResource.driverEvidence;

  assert.equal(auditEvidence.format, 'hash-only');
  assert.equal(auditEvidence.rawValuesIncluded, false);
  assert.equal(auditEvidence.resourceKey, shape.resourceKey);
  assert.equal(auditEvidence.pluginOwner, 'forms');
  assert.equal(auditEvidence.driver, 'wp-usermeta');
  assertSha256(auditEvidence.baseHash, 'audit baseHash');
  assertSha256(auditEvidence.localHash, 'audit localHash');
  assertSha256(auditEvidence.remoteHash, 'audit remoteHash');
  assertSha256(auditEvidence.ownerContextHash, 'audit ownerContextHash');
  assert.equal(auditEvidence.driverEvidenceHash, digest(driverEvidence));

  assert.equal(driverAuditEvidence.reasonCode, 'PLUGIN_DRIVER_DECISION_SUPPORTED');
  assert.equal(driverAuditEvidence.decision, 'supported');
  assert.equal(driverAuditEvidence.redaction, 'hash-only');
  assert.equal(driverAuditEvidence.rawValuesIncluded, false);
  assertSha256(driverAuditEvidence.hashes.baseHash, 'driver audit baseHash');
  assertSha256(driverAuditEvidence.hashes.localHash, 'driver audit localHash');
  assertSha256(driverAuditEvidence.hashes.remoteHash, 'driver audit remoteHash');

  assertNoRawUsermetaPayloads(driverEvidence, forbiddenValues);
  assertNoRawUsermetaPayloads(auditEvidence, forbiddenValues);
  assertNoRawUsermetaPayloads(driverAuditEvidence, forbiddenValues);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(driverEvidence, { label: 'RPP-0447 driver evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(auditEvidence, { label: 'RPP-0447 audit evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(driverAuditEvidence, { label: 'RPP-0447 driver audit evidence' }));
}

test('RPP-0447 generated harness keeps wp_usermeta variants covered with support-only NO-GO evidence', () => {
  const report = runGeneratedPushHarness();
  const supportedCoverage = report.summary.targetCoverage.usermetaDriverSupported;
  const unsupportedCoverage = report.summary.targetCoverage.usermetaDriverUnsupported;
  const summary = summaryFor();
  const coverageProof = {
    rpp: 'RPP-0447',
    evidenceSource: 'generated-wp-usermeta-driver-semantics-v3-coverage',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    supportedCoverageHash: sha256Evidence(supportedCoverage),
    unsupportedCoverageHash: sha256Evidence(unsupportedCoverage),
    releaseSummaryHash: sha256Evidence(summary),
  };
  coverageProof.proofHash = sha256Evidence({
    supportedCoverageHash: coverageProof.supportedCoverageHash,
    unsupportedCoverageHash: coverageProof.unsupportedCoverageHash,
    releaseSummaryHash: coverageProof.releaseSummaryHash,
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

  assert.equal(summary.checked, true);
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.verdict, 'WP_USERMETA_DRIVER_SEMANTICS_SUPPORT_ONLY');
  assert.equal(summary.evidenceScope, 'local-generated-release-verifier');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.supportOnly, true);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.equal(summary.generatedHarness.covered, true);
  assert.match(summary.generatedHarness.coverageHash, sha256EvidencePattern);
  assert.match(coverageProof.supportedCoverageHash, sha256EvidencePattern);
  assert.match(coverageProof.unsupportedCoverageHash, sha256EvidencePattern);
  assert.match(coverageProof.releaseSummaryHash, sha256EvidencePattern);
  assert.match(coverageProof.proofHash, sha256EvidencePattern);
  assertNoRawUsermetaPayloads(report);
  assertNoRawUsermetaPayloads(summary);
  assertNoRawUsermetaPayloads(coverageProof);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(summary, { label: 'RPP-0447 release summary' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(coverageProof, { label: 'RPP-0447 coverage proof' }));
});

test('RPP-0447 generated supported wp_usermeta row applies the exact live-preconditioned row', () => {
  const supportedCase = generatedCases.find((testCase) => testCase.family === 'supported-plugin-usermeta');
  assert.ok(supportedCase, 'missing generated supported wp_usermeta case');
  const shape = generatedPluginUsermetaShape(supportedCase, { expectExactRowId: true });
  const plan = planFor(supportedCase);
  const mutation = plan.mutations.find((entry) => entry.resourceKey === shape.resourceKey);
  assert.ok(mutation, 'supported wp_usermeta case should emit a mutation');
  const precondition = preconditionFor(plan, mutation);
  const validation = validateGeneratedCase(supportedCase);
  const liveRemote = cloneJson(supportedCase.remote);
  const result = applyPlan(liveRemote, plan, { mutateRemote: true });
  const releaseSummary = summaryFor({
    proof: releaseProof(plan),
    checkedProductionEvidence: false,
  });
  const driverEvidence = mutation.pluginOwnedResource.driverEvidence;
  const proof = {
    rpp: 'RPP-0447',
    evidenceSource: 'generated-supported-wp-usermeta-row-v3',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    resourceKey: shape.resourceKey,
    driver: mutation.pluginOwnedResource.driver,
    pluginOwner: mutation.pluginOwnedResource.pluginOwner,
    auditEvidenceHash: sha256Evidence(mutation.pluginOwnedResource.auditEvidence),
    driverDecisionEvidenceHash: sha256Evidence(mutation.pluginOwnedResource.driverAuditEvidence),
    driverEvidenceHash: sha256Evidence(driverEvidence),
    preconditionHash: sha256Evidence(precondition),
    releaseSummaryHash: sha256Evidence(releaseSummary),
    appliedRowHash: `sha256:${resourceHash(result.site, mutation.resource)}`,
    journalHash: sha256Evidence(result.journal),
  };
  proof.proofHash = sha256Evidence({
    auditEvidenceHash: proof.auditEvidenceHash,
    driverDecisionEvidenceHash: proof.driverDecisionEvidenceHash,
    driverEvidenceHash: proof.driverEvidenceHash,
    preconditionHash: proof.preconditionHash,
    releaseSummaryHash: proof.releaseSummaryHash,
    appliedRowHash: proof.appliedRowHash,
    journalHash: proof.journalHash,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.conflicts, 0);
  assert.deepEqual(plan.mutations.map((entry) => entry.resourceKey), [shape.resourceKey]);
  assert.deepEqual(plan.preconditions.map((entry) => entry.resourceKey), [shape.resourceKey]);

  assert.equal(validation.status, 'ready');
  assert.equal(validation.applied, true);
  assert.equal(validation.staleReplayRejected, true);
  assert.equal(validation.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.equal(validation.staleReplayRemoteUnchanged, true);
  assert.equal(result.appliedMutations, 1);
  assert.equal(result.recoveryState.status, 'fully-updated-remote');

  assert.equal(mutation.action, 'put');
  assert.equal(mutation.changeKind, 'update');
  assert.equal(mutation.resource.type, 'row');
  assert.equal(mutation.resource.table, 'wp_usermeta');
  assert.equal(mutation.resource.id, shape.rowId);
  assert.equal(mutation.remoteBeforeHash, resourceHash(supportedCase.remote, mutation.resource));
  assert.equal(mutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(mutation.pluginOwnedResource.driver, 'wp-usermeta');
  assert.equal(mutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(mutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(mutation.pluginOwnedResource.ownerContextRequired, true);

  assert.equal(driverEvidence.supported, true);
  assert.equal(driverEvidence.driver, 'wp-usermeta');
  assert.equal(driverEvidence.table, 'wp_usermeta');
  assert.equal(driverEvidence.resourceKey, shape.resourceKey);
  assert.equal(driverEvidence.rowId, shape.rowId);
  assert.equal(driverEvidence.rowIdKind, 'umeta_id');
  assert.equal(driverEvidence.userId, shape.row.user_id);
  assert.equal(driverEvidence.metaKey, shape.row.meta_key);
  assert.equal(driverEvidence.pluginOwner, 'forms');
  assert.equal(driverEvidence.policySource, 'local-snapshot');
  assert.equal(driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(driverEvidence.releaseGateEvidenceScope, 'local-candidate');

  assert.equal(precondition.resourceKey, mutation.resourceKey);
  assert.deepEqual(precondition.resource, mutation.resource);
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.deepEqual(liveRemote.db.wp_usermeta[shape.rowId], supportedCase.local.db.wp_usermeta[shape.rowId]);
  assert.deepEqual(result.site.db.wp_usermeta[shape.rowId], supportedCase.local.db.wp_usermeta[shape.rowId]);
  assert.equal(result.journal.entries.length, 1);
  assert.equal(result.journal.entries[0].resourceKey, shape.resourceKey);
  assertSha256(result.journal.entries[0].beforeHash, 'journal beforeHash');
  assertSha256(result.journal.entries[0].afterHash, 'journal afterHash');

  assert.equal(releaseSummary.status, 'support_only');
  assert.equal(releaseSummary.verdict, 'WP_USERMETA_DRIVER_SEMANTICS_SUPPORT_ONLY');
  assert.equal(releaseSummary.evidenceScope, 'local-candidate');
  assert.equal(releaseSummary.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(releaseSummary.productionBacked, false);
  assert.equal(releaseSummary.acceptedForReleaseGate, false);
  assert.equal(releaseSummary.releaseGate.status, 'NO-GO');
  assert.equal(releaseSummary.releaseGate.productionBacked, false);
  assert.equal(releaseSummary.releaseGate.acceptedForReleaseGate, false);
  assert.equal(releaseSummary.applyTimeRevalidation.verifiedBeforeFirstMutation, true);
  assert.equal(releaseSummary.applyTimeRevalidation.checkedAgainst, 'live-remote');
  assert.equal(releaseSummary.generatedHarness.covered, true);
  assert.deepEqual(releaseSummary.mutations.map((entry) => entry.resourceKey), [shape.resourceKey]);
  assert.equal(releaseSummary.mutations[0].rowId, shape.rowId);
  assert.equal(releaseSummary.mutations[0].rowIdKind, 'umeta_id');
  assert.equal(releaseSummary.mutations[0].userId, shape.row.user_id);
  assert.equal(releaseSummary.mutations[0].metaKey, shape.row.meta_key);

  assertHashOnlyMutationEvidence({ mutation, shape });
  assert.match(proof.auditEvidenceHash, sha256EvidencePattern);
  assert.match(proof.driverDecisionEvidenceHash, sha256EvidencePattern);
  assert.match(proof.driverEvidenceHash, sha256EvidencePattern);
  assert.match(proof.preconditionHash, sha256EvidencePattern);
  assert.match(proof.releaseSummaryHash, sha256EvidencePattern);
  assert.match(proof.appliedRowHash, sha256EvidencePattern);
  assert.match(proof.journalHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  assertNoRawUsermetaPayloads(releaseSummary);
  assertNoRawUsermetaPayloads(result.journal);
  assertNoRawUsermetaPayloads(proof);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(releaseSummary, { label: 'RPP-0447 supported release summary' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(result.journal, { label: 'RPP-0447 apply journal' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0447 supported proof' }));
});

test('RPP-0447 generated wp_usermeta stale and unsupported rows refuse before mutation', () => {
  const supportedCase = generatedCases.find((testCase) => testCase.family === 'supported-plugin-usermeta');
  const unsupportedCase = generatedCases.find((testCase) => testCase.family === 'unsupported-plugin-usermeta');
  assert.ok(supportedCase, 'missing generated supported wp_usermeta case');
  assert.ok(unsupportedCase, 'missing generated unsupported wp_usermeta case');
  const supportedShape = generatedPluginUsermetaShape(supportedCase, { expectExactRowId: true });
  const unsupportedShape = generatedPluginUsermetaShape(unsupportedCase);
  assert.notEqual(
    unsupportedShape.row.umeta_id,
    Number(unsupportedShape.rowId.slice('umeta_id:'.length)),
  );
  const supportedPlan = planFor(supportedCase);
  const unsupportedPlan = planFor(unsupportedCase);
  const unsupportedValidation = validateGeneratedCase(unsupportedCase);
  const staleRemote = cloneJson(supportedCase.remote);
  staleRemote.db.wp_usermeta[supportedShape.rowId].meta_value = {
    mode: 'rpp-0447-stale-live-usermeta',
    usermetaId: supportedShape.row.umeta_id,
    ordinal: 'stale-before-apply',
  };
  const staleRemoteBeforeApply = cloneJson(staleRemote);
  let preconditionError = null;

  assert.throws(
    () => applyPlan(staleRemote, supportedPlan, { mutateRemote: true }),
    (error) => {
      preconditionError = error;
      return error instanceof PushPlanError && error.code === 'PRECONDITION_FAILED';
    },
  );

  const unsupportedBlocker = unsupportedPlan.blockers.find((entry) =>
    entry.resourceKey === unsupportedShape.resourceKey);
  assert.ok(unsupportedBlocker, 'unsupported wp_usermeta case should emit a blocker');
  const unsupportedRemote = cloneJson(unsupportedCase.remote);
  const unsupportedRemoteBeforeApply = cloneJson(unsupportedRemote);
  const unsupportedError = captureError(() => applyPlan(unsupportedRemote, unsupportedPlan, { mutateRemote: true }));
  const refusalProof = {
    rpp: 'RPP-0447',
    evidenceSource: 'generated-wp-usermeta-refusal-v3',
    productionBacked: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    staleResourceKey: supportedShape.resourceKey,
    unsupportedResourceKey: unsupportedShape.resourceKey,
    staleErrorDetailsHash: sha256Evidence(preconditionError.details),
    staleRemoteBeforeHash: sha256Evidence(staleRemoteBeforeApply),
    staleRemoteAfterHash: sha256Evidence(staleRemote),
    unsupportedBlockerHash: sha256Evidence(unsupportedBlocker),
    unsupportedErrorDetailsHash: sha256Evidence(unsupportedError.details),
    unsupportedRemoteBeforeHash: sha256Evidence(unsupportedRemoteBeforeApply),
    unsupportedRemoteAfterHash: sha256Evidence(unsupportedRemote),
  };
  refusalProof.proofHash = sha256Evidence({
    staleErrorDetailsHash: refusalProof.staleErrorDetailsHash,
    staleRemoteBeforeHash: refusalProof.staleRemoteBeforeHash,
    staleRemoteAfterHash: refusalProof.staleRemoteAfterHash,
    unsupportedBlockerHash: refusalProof.unsupportedBlockerHash,
    unsupportedErrorDetailsHash: refusalProof.unsupportedErrorDetailsHash,
    unsupportedRemoteBeforeHash: refusalProof.unsupportedRemoteBeforeHash,
    unsupportedRemoteAfterHash: refusalProof.unsupportedRemoteAfterHash,
  });

  assert.equal(preconditionError.details.resourceKey, supportedShape.resourceKey);
  assertSha256(preconditionError.details.expectedHash, 'precondition expectedHash');
  assertSha256(preconditionError.details.actualHash, 'precondition actualHash');
  assert.notEqual(preconditionError.details.actualHash, preconditionError.details.expectedHash);
  assert.deepEqual(staleRemote, staleRemoteBeforeApply);
  assert.equal(refusalProof.staleRemoteAfterHash, refusalProof.staleRemoteBeforeHash);

  assert.equal(unsupportedPlan.status, 'blocked');
  assert.equal(unsupportedPlan.summary.mutations, 0);
  assert.equal(unsupportedPlan.mutations.some((mutation) =>
    mutation.resourceKey === unsupportedShape.resourceKey), false);
  assert.equal(unsupportedValidation.status, 'blocked');
  assert.equal(unsupportedValidation.applied, false);
  assert.equal(unsupportedValidation.nonReadyRemoteUnchanged, true);
  assert.ok(unsupportedError instanceof PushPlanError);
  assert.equal(unsupportedError.code, 'PLAN_NOT_READY');
  assert.deepEqual(unsupportedError.details, { status: 'blocked' });
  assert.deepEqual(unsupportedRemote, unsupportedRemoteBeforeApply);
  assert.equal(refusalProof.unsupportedRemoteAfterHash, refusalProof.unsupportedRemoteBeforeHash);

  assert.equal(unsupportedBlocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(unsupportedBlocker.resourceKey, unsupportedShape.resourceKey);
  assert.equal(unsupportedBlocker.driver, 'wp-usermeta');
  assert.equal(unsupportedBlocker.pluginOwner, 'forms');
  assert.equal(unsupportedBlocker.policySource, 'local-snapshot');
  assert.equal(unsupportedBlocker.driverEvidence.supported, false);
  assert.equal(unsupportedBlocker.driverEvidence.driver, 'wp-usermeta');
  assert.equal(unsupportedBlocker.driverEvidence.table, 'wp_usermeta');
  assert.equal(unsupportedBlocker.driverEvidence.resourceKey, unsupportedShape.resourceKey);
  assert.equal(unsupportedBlocker.driverEvidence.rowId, unsupportedShape.rowId);
  assert.equal(unsupportedBlocker.driverEvidence.rowIdKind, 'umeta_id');
  assert.equal(unsupportedBlocker.driverEvidence.userId, unsupportedShape.row.user_id);
  assert.equal(unsupportedBlocker.driverEvidence.metaKey, unsupportedShape.row.meta_key);
  assert.equal(unsupportedBlocker.driverEvidence.evidenceScope, 'local-candidate');
  assert.equal(unsupportedBlocker.driverEvidence.releaseGateEvidenceScope, 'local-candidate');
  assert.match(unsupportedBlocker.reason, /umeta_id to match the resource id/);

  assert.match(refusalProof.staleErrorDetailsHash, sha256EvidencePattern);
  assert.match(refusalProof.staleRemoteBeforeHash, sha256EvidencePattern);
  assert.match(refusalProof.staleRemoteAfterHash, sha256EvidencePattern);
  assert.match(refusalProof.unsupportedBlockerHash, sha256EvidencePattern);
  assert.match(refusalProof.unsupportedErrorDetailsHash, sha256EvidencePattern);
  assert.match(refusalProof.unsupportedRemoteBeforeHash, sha256EvidencePattern);
  assert.match(refusalProof.unsupportedRemoteAfterHash, sha256EvidencePattern);
  assert.match(refusalProof.proofHash, sha256EvidencePattern);
  assertNoRawUsermetaPayloads(preconditionError.details, ['rpp-0447-stale-live-usermeta']);
  assertNoRawUsermetaPayloads(unsupportedBlocker);
  assertNoRawUsermetaPayloads(unsupportedError.details);
  assertNoRawUsermetaPayloads(refusalProof, ['rpp-0447-stale-live-usermeta']);
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(preconditionError.details, { label: 'RPP-0447 stale refusal details' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(unsupportedBlocker, { label: 'RPP-0447 unsupported blocker' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(unsupportedError.details, { label: 'RPP-0447 unsupported refusal details' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(refusalProof, { label: 'RPP-0447 refusal proof' }));
});
