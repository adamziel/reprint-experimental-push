import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPushPlan } from '../src/planner.js';
import { generatePushHarnessCases } from '../scripts/harness/generated-push-cases.js';
import {
  summarizeWpUsermetaReleaseVerifierEvidence,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const generatedCases = generatePushHarnessCases();
const expectedGeneratedTiers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const rowId = 'umeta_id:487';
const resourceKey = 'row:["wp_usermeta","umeta_id:487"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function usermetaRow({
  umetaId = 487,
  userId = 87,
  metaKey = '_forms_user_payload_v5',
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
  resource = resourceKey,
  driver = 'wp-usermeta',
  table = 'wp_usermeta',
} = {}) {
  return {
    resourceKey: resource,
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
  assert.match(summary.mutations[0].driverEvidenceHash, sha256Pattern);
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

test('RPP-0487 production-shaped release verifier carries wp_usermeta summary into pluginDriver proof', () => {
  const verifierSource = fs.readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(verifierSource, /summarizeWpUsermetaReleaseVerifierEvidence/);
  assert.match(
    verifierSource,
    /coreSemantics:\s*\{\s*wpPostmeta: wpPostmetaReleaseVerifierEvidence,\s*wpTermmeta: wpTermmetaReleaseVerifierEvidence,\s*wpUsermeta: wpUsermetaReleaseVerifierEvidence,/,
  );
  assert.match(
    verifierSource,
    /const wpUsermetaReleaseVerifierEvidence = summarizeWpUsermetaReleaseVerifierEvidence\(\{\s*proof,\s*checkedProductionEvidence: packagedSourceFixture === null\s*&& Boolean\(explicitReleaseVerifySourceUrl\)\s*&& checkedDurableJournalAccepted,/,
  );
});
