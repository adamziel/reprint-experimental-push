import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPushPlan } from '../src/planner.js';
import {
  summarizeWpTermmetaReleaseVerifierEvidence,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const metaIdRowId = 'meta_id:486';
const metaIdResourceKey = 'row:["wp_termmeta","meta_id:486"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function termmetaRow({
  termId = 86,
  metaKey = '_forms_term_payload_v5',
  metaId = 486,
  metaValue = 'base-termmeta-payload',
} = {}) {
  return {
    meta_id: metaId,
    term_id: termId,
    meta_key: metaKey,
    meta_value: metaValue,
    __pluginOwner: 'forms',
  };
}

function baseSite(wpTermmeta) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_terms: {
        'term_id:86': { term_id: 86, name: 'RPP-0486 term', slug: 'rpp-0486-term' },
        'term_id:487': { term_id: 487, name: 'RPP-0486 remote term', slug: 'rpp-0486-remote-term' },
      },
      wp_termmeta: wpTermmeta,
    },
  };
}

function allowedTermmetaResource({
  resourceKey = metaIdResourceKey,
  driver = 'wp-termmeta',
  table = 'wp_termmeta',
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

function assertNoRawTermmetaPayloads(value, forbiddenValues) {
  const json = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(json.includes(forbiddenValue), false, `leaked raw termmeta payload ${forbiddenValue}`);
  }
  assert.equal(json.includes('meta_value'), false, 'release verifier summary must not include raw meta_value fields');
  assert.equal(json.includes('metaValue'), false, 'release verifier summary must not include raw metaValue fields');
}

test('RPP-0486 release verifier labels local wp_termmeta semantics as support-only NO-GO evidence', () => {
  const basePayload = 'sensitive-base-termmeta-payload-0486';
  const localPayload = 'sensitive-local-termmeta-payload-0486';
  const base = baseSite({
    [metaIdRowId]: termmetaRow({ metaValue: basePayload }),
  });
  const local = cloneJson(base);
  local.db.wp_termmeta[metaIdRowId].meta_value = localPayload;
  local.pushIntents = [
    {
      id: 'rpp-0486-local-termmeta-release-verifier',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [metaIdResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedTermmetaResource({ driver: 'wp-term-meta' }),
      ),
    },
  ];
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);

  const summary = summarizeWpTermmetaReleaseVerifierEvidence({
    proof: releaseProof(plan),
    checkedProductionEvidence: false,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(summary.checked, true);
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.verdict, 'WP_TERMMETA_DRIVER_SEMANTICS_SUPPORT_ONLY');
  assert.equal(summary.evidenceScope, 'local-candidate');
  assert.equal(summary.releaseGateEvidenceScope, 'local-candidate');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.supportOnly, true);
  assert.equal(summary.acceptedForReleaseGate, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.productionBacked, false);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.match(summary.releaseGate.note, /local\/support-only/);
  assert.match(summary.releaseGate.note, /evidenceScope=local-candidate/);
  assert.match(summary.releaseGate.note, /production-backed release gate evidence is still required/);
  assert.equal(summary.applyTimeRevalidation.verifiedBeforeFirstMutation, true);
  assert.deepEqual(summary.missingEvidence, []);
  assert.equal(summary.mutations.length, 1);
  assert.deepEqual(summary.mutations[0], {
    id: plan.mutations[0].id,
    resourceKey: metaIdResourceKey,
    action: 'put',
    driver: 'wp-term-meta',
    owner: 'forms',
    supportsDelete: false,
    table: 'wp_termmeta',
    rowId: metaIdRowId,
    rowIdKind: 'meta_id',
    termId: 86,
    metaKey: '_forms_term_payload_v5',
    policySource: 'push-intent:rpp-0486-local-termmeta-release-verifier',
    supported: true,
    evidenceScope: 'local-candidate',
    releaseGateEvidenceScope: 'local-candidate',
    baseHash: plan.mutations[0].baseHash,
    remoteBeforeHash: plan.mutations[0].remoteBeforeHash,
    localHash: plan.mutations[0].localHash,
    driverEvidenceHash: summary.mutations[0].driverEvidenceHash,
  });
  assert.match(summary.mutations[0].driverEvidenceHash, /^[a-f0-9]{64}$/);
  assertNoRawTermmetaPayloads(summary, [basePayload, localPayload]);
});

test('RPP-0486 release verifier keeps production-scoped wp_termmeta evidence NO-GO without checked production proof', () => {
  const basePayload = 'rpp-0486-base-production-scope-termmeta';
  const localPayload = 'rpp-0486-local-production-scope-termmeta';
  const base = baseSite({
    [metaIdRowId]: termmetaRow({
      termId: 487,
      metaKey: '_forms_remote_term_payload_v5',
      metaValue: basePayload,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_termmeta[metaIdRowId].meta_value = localPayload;
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [
        allowedTermmetaResource({ resourceKey: metaIdResourceKey }),
      ],
    },
  };
  const plan = planFor(base, local, remote);

  const summary = summarizeWpTermmetaReleaseVerifierEvidence({
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
  assert.equal(summary.releaseGate.verdict, 'WP_TERMMETA_DRIVER_SEMANTICS_PRODUCTION_PROOF_REQUIRED');
  assert.equal(summary.releaseGate.evidenceScope, 'production-backed');
  assert.match(summary.releaseGate.note, /production-backed scope/);
  assert.match(summary.releaseGate.note, /release gate remains NO-GO/);
  assert.equal(summary.mutations[0].rowIdKind, 'meta_id');
  assert.equal(summary.mutations[0].termId, 487);
  assert.equal(summary.mutations[0].metaKey, '_forms_remote_term_payload_v5');
  assertNoRawTermmetaPayloads(summary, [basePayload, localPayload]);
});

test('RPP-0486 release verifier labels checked production-backed wp_termmeta semantics separately', () => {
  const basePayload = 'rpp-0486-base-production-backed-termmeta';
  const localPayload = 'rpp-0486-local-production-backed-termmeta';
  const base = baseSite({
    [metaIdRowId]: termmetaRow({
      termId: 487,
      metaKey: '_forms_remote_term_payload_v5',
      metaValue: basePayload,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_termmeta[metaIdRowId].meta_value = localPayload;
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [
        allowedTermmetaResource({ resourceKey: metaIdResourceKey }),
      ],
    },
  };
  const plan = planFor(base, local, remote);

  const summary = summarizeWpTermmetaReleaseVerifierEvidence({
    proof: releaseProof(plan),
    checkedProductionEvidence: true,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(summary.status, 'checked');
  assert.equal(summary.verdict, 'WP_TERMMETA_DRIVER_SEMANTICS_PRODUCTION_BACKED');
  assert.equal(summary.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGateEvidenceScope, 'production-backed');
  assert.equal(summary.checkedProductionEvidence, true);
  assert.equal(summary.productionBacked, true);
  assert.equal(summary.supportOnly, false);
  assert.equal(summary.acceptedForReleaseGate, true);
  assert.equal(summary.releaseGate.status, 'GO');
  assert.equal(summary.releaseGate.verdict, 'WP_TERMMETA_DRIVER_SEMANTICS_PRODUCTION_BACKED');
  assert.equal(summary.releaseGate.productionBacked, true);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, true);
  assert.match(summary.releaseGate.note, /production-backed/);
  assert.equal(summary.applyTimeRevalidation.verifiedBeforeFirstMutation, true);
  assert.deepEqual(summary.mutations.map((mutation) => mutation.resourceKey), [metaIdResourceKey]);
  assertNoRawTermmetaPayloads(summary, [basePayload, localPayload]);
});

test('RPP-0486 production-shaped release verifier carries wp_termmeta summary into pluginDriver proof', () => {
  const verifierSource = fs.readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(verifierSource, /summarizeWpTermmetaReleaseVerifierEvidence/);
  assert.match(
    verifierSource,
    /coreSemantics:\s*\{\s*wpPostmeta: wpPostmetaReleaseVerifierEvidence,\s*wpTermmeta: wpTermmetaReleaseVerifierEvidence,/,
  );
  assert.match(
    verifierSource,
    /const wpTermmetaReleaseVerifierEvidence = summarizeWpTermmetaReleaseVerifierEvidence\(\{\s*proof,\s*checkedProductionEvidence: packagedSourceFixture === null\s*&& Boolean\(explicitReleaseVerifySourceUrl\)\s*&& checkedDurableJournalAccepted,/,
  );
});
