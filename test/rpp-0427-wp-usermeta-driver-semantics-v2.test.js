import test from 'node:test';
import assert from 'node:assert/strict';

import { createPushPlan } from '../src/planner.js';
import { digest } from '../src/stable-json.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const expectedGeneratedTiers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

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
  assert.equal(json.includes('meta_value'), false, 'driver evidence must not include raw meta_value fields');
  assert.equal(json.includes('metaValue'), false, 'driver evidence must not include raw metaValue fields');
  assert.equal(json.includes('local-invalid'), false, 'driver evidence must not include invalid local payload values');
  assert.equal(json.includes('"mode"'), false, 'driver evidence must not include raw structured payload keys');
  assert.equal(json.includes('"ordinal"'), false, 'driver evidence must not include generated payload ordinals');
}

test('RPP-0427 generated harness summary covers supported and unsupported wp_usermeta driver variants', () => {
  const report = runGeneratedPushHarness();
  const supportedCoverage = report.summary.targetCoverage.usermetaDriverSupported;
  const unsupportedCoverage = report.summary.targetCoverage.usermetaDriverUnsupported;

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
});

test('RPP-0427 generated wp_usermeta variants prove exact mutation and fail-closed semantics', () => {
  const cases = generatePushHarnessCases();
  const supportedCase = cases.find((testCase) => testCase.family === 'supported-plugin-usermeta');
  const unsupportedCase = cases.find((testCase) => testCase.family === 'unsupported-plugin-usermeta');
  assert.ok(supportedCase, 'missing generated supported wp_usermeta case');
  assert.ok(unsupportedCase, 'missing generated unsupported wp_usermeta case');

  const supportedShape = generatedPluginUsermetaShape(supportedCase);
  const unsupportedShape = generatedPluginUsermetaShape(unsupportedCase);
  const supportedPlan = createPushPlan({
    base: supportedCase.base,
    local: supportedCase.local,
    remote: supportedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const unsupportedPlan = createPushPlan({
    base: unsupportedCase.base,
    local: unsupportedCase.local,
    remote: unsupportedCase.remote,
    now: fixedGeneratedHarnessNow,
  });
  const supportedResult = validateGeneratedCase(supportedCase);
  const unsupportedResult = validateGeneratedCase(unsupportedCase);
  const supportedMutation = supportedPlan.mutations.find((mutation) =>
    mutation.resourceKey === supportedShape.resourceKey);
  const unsupportedBlocker = unsupportedPlan.blockers.find((blocker) =>
    blocker.resourceKey === unsupportedShape.resourceKey);
  assert.ok(supportedMutation, 'supported wp_usermeta case should emit a mutation');
  assert.ok(unsupportedBlocker, 'unsupported wp_usermeta case should emit a blocker');

  const supportedEvidence = supportedMutation.pluginOwnedResource.driverEvidence;
  assert.equal(supportedResult.status, 'ready');
  assert.equal(supportedResult.applied, true);
  assert.equal(supportedResult.staleReplayRejected, true);
  assert.equal(supportedMutation.action, 'put');
  assert.equal(supportedMutation.pluginOwnedResource.pluginOwner, 'forms');
  assert.equal(supportedMutation.pluginOwnedResource.driver, 'wp-usermeta');
  assert.equal(supportedMutation.pluginOwnedResource.policySource, 'local-snapshot');
  assert.equal(supportedMutation.pluginOwnedResource.supportsDelete, false);
  assert.equal(supportedMutation.pluginOwnedResource.auditEvidence.rawValuesIncluded, false);
  assert.equal(
    supportedMutation.pluginOwnedResource.auditEvidence.driverEvidenceHash,
    digest(supportedEvidence),
  );
  assert.equal(supportedEvidence.supported, true);
  assert.equal(supportedEvidence.driver, 'wp-usermeta');
  assert.equal(supportedEvidence.table, 'wp_usermeta');
  assert.equal(supportedEvidence.resourceKey, supportedShape.resourceKey);
  assert.equal(supportedEvidence.rowId, supportedShape.rowId);
  assert.equal(supportedEvidence.rowIdKind, 'umeta_id');
  assert.equal(supportedEvidence.userId, supportedShape.row.user_id);
  assert.equal(supportedEvidence.metaKey, supportedShape.row.meta_key);
  assert.equal(supportedEvidence.policySource, 'local-snapshot');
  assert.equal(supportedEvidence.evidenceScope, 'local-candidate');
  assert.equal(supportedEvidence.releaseGateEvidenceScope, 'local-candidate');
  assertNoRawUsermetaPayload(supportedEvidence);

  assert.equal(unsupportedResult.status, 'blocked');
  assert.equal(unsupportedResult.applied, false);
  assert.equal(unsupportedResult.nonReadyRemoteUnchanged, true);
  assert.equal(unsupportedPlan.status, 'blocked');
  assert.equal(unsupportedPlan.summary.mutations, 0);
  assert.equal(unsupportedPlan.mutations.some((mutation) =>
    mutation.resourceKey === unsupportedShape.resourceKey), false);
  assert.equal(unsupportedBlocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(unsupportedBlocker.driver, 'wp-usermeta');
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
  assertNoRawUsermetaPayload(unsupportedBlocker);
});
