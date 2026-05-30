import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPushPlan } from '../src/planner.js';
import {
  DEFAULT_GENERATED_PUSH_CASES,
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';
import {
  summarizeWpUsermetaReleaseVerifierEvidence,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const generatedCases = generatePushHarnessCases();
const expectedGeneratedTiers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const rowId = 'umeta_id:487';
const resourceKey = 'row:["wp_usermeta","umeta_id:487"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function usermetaRow({
  userId = 87,
  metaKey = '_forms_user_payload_v5',
  umetaId = 487,
  metaValue = 'base-usermeta-payload',
} = {}) {
  return {
    umeta_id: umetaId,
    user_id: userId,
    meta_key: metaKey,
    meta_value: metaValue,
    __pluginOwner: 'forms',
  };
}

function baseSite(wpUsermeta) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_users: {
        'ID:87': { ID: 87, user_login: 'rpp-0487-user', user_email: 'rpp-0487@example.test' },
        'ID:488': { ID: 488, user_login: 'rpp-0487-remote-user', user_email: 'rpp-0487-remote@example.test' },
      },
      wp_usermeta: wpUsermeta,
    },
  };
}

function allowedUsermetaResource({
  key = resourceKey,
  driver = 'wp-usermeta',
  table = 'wp_usermeta',
} = {}) {
  return {
    resourceKey: key,
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

function generatedPluginUsermetaShape(testCase) {
  const entry = Object.entries(testCase.local.db.wp_usermeta)
    .find(([, row]) => row.__pluginOwner === 'forms'
      && typeof row.meta_key === 'string'
      && row.meta_key.startsWith('_forms_generated_user_flag_'));
  assert.ok(entry, `${testCase.id} missing generated plugin-owned usermeta row`);
  const [generatedRowId, row] = entry;
  assert.match(generatedRowId, /^umeta_id:[1-9]\d*$/);
  assert.equal(testCase.base.db.wp_usermeta[generatedRowId]?.__pluginOwner, 'forms');
  assert.equal(testCase.remote.db.wp_usermeta[generatedRowId]?.__pluginOwner, 'forms');
  return {
    rowId: generatedRowId,
    row,
    resourceKey: `row:${JSON.stringify(['wp_usermeta', generatedRowId])}`,
  };
}

function perTierKeys(coverage) {
  return Object.keys(coverage.perTier).map(Number);
}

function summaryFor(args = {}) {
  return summarizeWpUsermetaReleaseVerifierEvidence({
    generatedCases,
    ...args,
  });
}

function assertGeneratedTiers(familySummary) {
  assert.deepEqual(familySummary.tiers, expectedGeneratedTiers);
  assert.deepEqual(
    Object.fromEntries(expectedGeneratedTiers.map((tier) => [String(tier), 1])),
    familySummary.perTier,
  );
}

function assertNoRawUsermetaPayloads(value, forbiddenValues = []) {
  const json = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(json.includes(forbiddenValue), false, `leaked raw usermeta payload ${forbiddenValue}`);
  }
  assert.equal(json.includes('meta_value'), false, 'release verifier summary must not include raw meta_value fields');
  assert.equal(json.includes('metaValue'), false, 'release verifier summary must not include raw metaValue fields');
  assert.equal(json.includes('local-invalid'), false, 'generated unsupported payload marker must stay out of evidence');
  assert.equal(json.includes('"mode"'), false, 'generated structured payload keys must stay out of evidence');
  assert.equal(json.includes('"ordinal"'), false, 'generated payload ordinals must stay out of evidence');
  assert.equal(json.includes('"usermetaId"'), false, 'generated payload ids must stay out of evidence');
}

test('RPP-0487 release verifier carries generated wp_usermeta supported and unsupported variants', () => {
  const summary = summaryFor();
  const { supported, unsupported } = summary.generatedHarness;

  assert.equal(summary.checked, true);
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.verdict, 'WP_USERMETA_DRIVER_SEMANTICS_SUPPORT_ONLY');
  assert.equal(summary.evidenceScope, 'local-generated-release-verifier');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.match(summary.releaseGate.note, /local\/generated support-only/);
  assert.match(summary.releaseGate.note, /generatedHarnessCovered=true/);
  assert.match(summary.releaseGate.note, /production-backed release gate evidence is still required/);
  assert.equal(summary.generatedHarness.checked, true);
  assert.equal(summary.generatedHarness.covered, true);
  assert.match(summary.generatedHarness.coverageHash, sha256EvidencePattern);

  assert.equal(supported.family, 'supported-plugin-usermeta');
  assert.equal(supported.expectedStatus, 'ready');
  assert.equal(supported.supported, true);
  assert.equal(supported.checked, true);
  assert.equal(supported.totalCases, expectedGeneratedTiers.length);
  assert.deepEqual(supported.statuses, { ready: expectedGeneratedTiers.length });
  assertGeneratedTiers(supported);
  assert.equal(supported.rows.every((row) => row.checked === true), true);
  assert.equal(supported.rows.every((row) => row.mutation?.action === 'put'), true);
  assert.equal(supported.rows.every((row) => row.mutation?.preconditionCheckedAgainst === 'live-remote'), true);
  assert.equal(supported.rows.every((row) => row.validation.staleReplayRejected === true), true);
  assert.match(supported.rowsHash, sha256EvidencePattern);

  assert.equal(unsupported.family, 'unsupported-plugin-usermeta');
  assert.equal(unsupported.expectedStatus, 'blocked');
  assert.equal(unsupported.supported, false);
  assert.equal(unsupported.checked, true);
  assert.equal(unsupported.totalCases, expectedGeneratedTiers.length);
  assert.deepEqual(unsupported.statuses, { blocked: expectedGeneratedTiers.length });
  assertGeneratedTiers(unsupported);
  assert.equal(unsupported.rows.every((row) => row.checked === true), true);
  assert.equal(unsupported.rows.every((row) => row.mutation === null), true);
  assert.equal(unsupported.rows.every((row) => row.blocker?.class === 'unsupported-plugin-owned-resource'), true);
  assert.equal(unsupported.rows.every((row) => row.validation.nonReadyRemoteUnchanged === true), true);
  assert.match(unsupported.rowsHash, sha256EvidencePattern);
  assertNoRawUsermetaPayloads(summary);
});

test('RPP-0487 release verifier labels local wp_usermeta semantics as support-only NO-GO evidence', () => {
  const basePayload = 'sensitive-base-usermeta-payload-0487';
  const localPayload = 'sensitive-local-usermeta-payload-0487';
  const base = baseSite({
    [rowId]: usermetaRow({ metaValue: basePayload }),
  });
  const local = cloneJson(base);
  local.db.wp_usermeta[rowId].meta_value = localPayload;
  local.pushIntents = [
    {
      id: 'rpp-0487-local-usermeta-release-verifier',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [resourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedUsermetaResource({ driver: 'wp-user-meta' }),
      ),
    },
  ];
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);

  const summary = summaryFor({
    proof: releaseProof(plan),
    checkedProductionEvidence: false,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(summary.checked, true);
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.verdict, 'WP_USERMETA_DRIVER_SEMANTICS_SUPPORT_ONLY');
  assert.equal(summary.evidenceScope, 'local-candidate');
  assert.equal(summary.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.supportOnly, true);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.match(summary.releaseGate.note, /local\/generated support-only/);
  assert.match(summary.releaseGate.note, /evidenceScope=local-candidate/);
  assert.match(summary.releaseGate.note, /production-backed release gate evidence is still required/);
  assert.equal(summary.applyTimeRevalidation.verifiedBeforeFirstMutation, true);
  assert.deepEqual(summary.missingEvidence, []);
  assert.equal(summary.generatedHarness.covered, true);
  assert.equal(summary.mutations.length, 1);
  assert.deepEqual(summary.mutations[0], {
    id: plan.mutations[0].id,
    resourceKey,
    action: 'put',
    driver: 'wp-user-meta',
    owner: 'forms',
    supportsDelete: false,
    table: 'wp_usermeta',
    rowId,
    rowIdKind: 'umeta_id',
    userId: 87,
    metaKey: '_forms_user_payload_v5',
    policySource: 'push-intent:rpp-0487-local-usermeta-release-verifier',
    supported: true,
    evidenceScope: 'local-candidate',
    releaseGateEvidenceScope: 'local-candidate',
    baseHash: plan.mutations[0].baseHash,
    remoteBeforeHash: plan.mutations[0].remoteBeforeHash,
    localHash: plan.mutations[0].localHash,
    driverEvidenceHash: summary.mutations[0].driverEvidenceHash,
  });
  assert.match(summary.mutations[0].driverEvidenceHash, /^[a-f0-9]{64}$/);
  assertNoRawUsermetaPayloads(summary, [basePayload, localPayload]);
});

test('RPP-0487 release verifier keeps production-scoped wp_usermeta evidence NO-GO without checked production proof', () => {
  const basePayload = 'rpp-0487-base-production-scope-usermeta';
  const localPayload = 'rpp-0487-local-production-scope-usermeta';
  const base = baseSite({
    [rowId]: usermetaRow({
      userId: 488,
      metaKey: '_forms_remote_user_payload_v5',
      metaValue: basePayload,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_usermeta[rowId].meta_value = localPayload;
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [
        allowedUsermetaResource(),
      ],
    },
  };
  const plan = planFor(base, local, remote);

  const summary = summaryFor({
    proof: releaseProof(plan),
    checkedProductionEvidence: false,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(summary.checked, true);
  assert.equal(summary.productionScopeClaimed, true);
  assert.equal(summary.checkedProductionEvidence, false);
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.verdict, 'WP_USERMETA_DRIVER_SEMANTICS_PRODUCTION_PROOF_REQUIRED');
  assert.equal(summary.releaseGate.evidenceScope, 'production-backed');
  assert.match(summary.releaseGate.note, /production-backed scope/);
  assert.match(summary.releaseGate.note, /release gate remains NO-GO/);
  assert.equal(summary.generatedHarness.covered, true);
  assert.equal(summary.mutations[0].rowIdKind, 'umeta_id');
  assert.equal(summary.mutations[0].userId, 488);
  assert.equal(summary.mutations[0].metaKey, '_forms_remote_user_payload_v5');
  assertNoRawUsermetaPayloads(summary, [basePayload, localPayload]);
});

test('RPP-0487 release verifier labels checked production-backed wp_usermeta semantics separately', () => {
  const basePayload = 'rpp-0487-base-production-backed-usermeta';
  const localPayload = 'rpp-0487-local-production-backed-usermeta';
  const base = baseSite({
    [rowId]: usermetaRow({
      userId: 488,
      metaKey: '_forms_remote_user_payload_v5',
      metaValue: basePayload,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_usermeta[rowId].meta_value = localPayload;
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [
        allowedUsermetaResource(),
      ],
    },
  };
  const plan = planFor(base, local, remote);

  const summary = summaryFor({
    proof: releaseProof(plan),
    checkedProductionEvidence: true,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(summary.status, 'checked');
  assert.equal(summary.verdict, 'WP_USERMETA_DRIVER_SEMANTICS_PRODUCTION_BACKED');
  assert.equal(summary.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGateEvidenceScope, 'production-backed');
  assert.equal(summary.checkedProductionEvidence, true);
  assert.equal(summary.productionBacked, true);
  assert.equal(summary.supportOnly, false);
  assert.equal(summary.acceptedForReleaseGate, true);
  assert.equal(summary.releaseGate.status, 'GO');
  assert.equal(summary.releaseGate.verdict, 'WP_USERMETA_DRIVER_SEMANTICS_PRODUCTION_BACKED');
  assert.equal(summary.releaseGate.productionBacked, true);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, true);
  assert.match(summary.releaseGate.note, /production-backed/);
  assert.match(summary.releaseGate.note, /generated supported\/unsupported coverage/);
  assert.equal(summary.applyTimeRevalidation.verifiedBeforeFirstMutation, true);
  assert.equal(summary.generatedHarness.covered, true);
  assert.deepEqual(summary.mutations.map((mutation) => mutation.resourceKey), [resourceKey]);
  assertNoRawUsermetaPayloads(summary, [basePayload, localPayload]);
});

test('RPP-0487 release verifier keeps generated wp_usermeta support evidence distinct from unsupported variants', () => {
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
  const supportedSummary = summaryFor({
    proof: releaseProof(supportedPlan),
    checkedProductionEvidence: false,
  });
  const supportedResult = validateGeneratedCase(supportedCase);
  const unsupportedResult = validateGeneratedCase(unsupportedCase);
  const unsupportedBlocker = unsupportedPlan.blockers.find((blocker) =>
    blocker.resourceKey === unsupportedShape.resourceKey);

  assert.equal(supportedPlan.status, 'ready');
  assert.equal(supportedResult.status, 'ready');
  assert.equal(supportedSummary.status, 'support_only');
  assert.equal(supportedSummary.checked, true);
  assert.equal(supportedSummary.releaseGate.status, 'NO-GO');
  assert.equal(supportedSummary.mutations.length, 1);
  assert.equal(supportedSummary.mutations[0].resourceKey, supportedShape.resourceKey);
  assert.equal(supportedSummary.mutations[0].driver, 'wp-usermeta');
  assert.equal(supportedSummary.mutations[0].table, 'wp_usermeta');
  assert.equal(supportedSummary.mutations[0].rowIdKind, 'umeta_id');
  assert.equal(supportedSummary.mutations[0].userId, supportedShape.row.user_id);
  assert.equal(supportedSummary.mutations[0].metaKey, supportedShape.row.meta_key);

  assert.equal(unsupportedPlan.status, 'blocked');
  assert.equal(unsupportedResult.status, 'blocked');
  assert.equal(unsupportedPlan.mutations.some((mutation) =>
    mutation.resourceKey === unsupportedShape.resourceKey), false);
  assert.equal(unsupportedBlocker.class, 'unsupported-plugin-owned-resource');
  assert.equal(unsupportedBlocker.driverEvidence.supported, false);
  assert.equal(unsupportedBlocker.driverEvidence.rowIdKind, 'umeta_id');
  assert.match(unsupportedBlocker.reason, /umeta_id to match the resource id/);
  assert.equal(supportedSummary.generatedHarness.unsupported.checked, true);
  assert.equal(supportedSummary.generatedHarness.unsupported.totalCases, expectedGeneratedTiers.length);
  assert.deepEqual(supportedSummary.generatedHarness.unsupported.statuses, { blocked: expectedGeneratedTiers.length });
  assertNoRawUsermetaPayloads(supportedSummary);
  assertNoRawUsermetaPayloads(unsupportedBlocker, ['local-invalid']);
});

test('RPP-0487 production-shaped release verifier carries wp_usermeta summary into pluginDriver proof', () => {
  const verifierSource = fs.readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(verifierSource, /summarizeWpUsermetaReleaseVerifierEvidence/);
  assert.match(
    verifierSource,
    /coreSemantics:\s*\{[\s\S]*wpPostmeta: wpPostmetaReleaseVerifierEvidence,[\s\S]*wpTermmeta: wpTermmetaReleaseVerifierEvidence,[\s\S]*wpUsermeta: wpUsermetaReleaseVerifierEvidence,/,
  );
  assert.match(
    verifierSource,
    /const wpUsermetaReleaseVerifierEvidence = summarizeWpUsermetaReleaseVerifierEvidence\(\{\s*proof,\s*checkedProductionEvidence: packagedSourceFixture === null\s*&& Boolean\(explicitReleaseVerifySourceUrl\)\s*&& checkedDurableJournalAccepted,/,
  );
});
