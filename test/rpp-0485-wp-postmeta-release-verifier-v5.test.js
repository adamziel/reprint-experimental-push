import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPushPlan } from '../src/planner.js';
import {
  summarizeWpPostmetaReleaseVerifierEvidence,
} from '../scripts/playground/production-shaped-release-verify.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const postKeyRowId = 'post_id:85:meta_key:_forms:payload:v5';
const postKeyResourceKey = 'row:["wp_postmeta","post_id:85:meta_key:_forms:payload:v5"]';
const metaIdRowId = 'meta_id:485';
const metaIdResourceKey = 'row:["wp_postmeta","meta_id:485"]';

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function postmetaRow({
  postId = 85,
  metaKey = '_forms:payload:v5',
  metaId = undefined,
  metaValue = 'base-postmeta-payload',
} = {}) {
  return {
    ...(metaId === undefined ? {} : { meta_id: metaId }),
    post_id: postId,
    meta_key: metaKey,
    meta_value: metaValue,
    __pluginOwner: 'forms',
  };
}

function baseSite(wpPostmeta) {
  return {
    files: {
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_posts: {
        'ID:85': { ID: 85, post_title: 'RPP-0485 post', post_status: 'publish' },
        'ID:486': { ID: 486, post_title: 'RPP-0485 remote post', post_status: 'publish' },
      },
      wp_postmeta: wpPostmeta,
    },
  };
}

function allowedPostmetaResource({
  resourceKey = postKeyResourceKey,
  driver = 'wp-postmeta',
  table = 'wp_postmeta',
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

function assertNoRawPostmetaPayloads(value, forbiddenValues) {
  const json = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(json.includes(forbiddenValue), false, `leaked raw postmeta payload ${forbiddenValue}`);
  }
  assert.equal(json.includes('meta_value'), false, 'release verifier summary must not include raw meta_value fields');
  assert.equal(json.includes('metaValue'), false, 'release verifier summary must not include raw metaValue fields');
}

test('RPP-0485 release verifier labels local wp_postmeta semantics as support-only NO-GO evidence', () => {
  const basePayload = 'sensitive-base-meta-payload-0485';
  const localPayload = 'sensitive-local-meta-payload-0485';
  const base = baseSite({
    [postKeyRowId]: postmetaRow({ metaValue: basePayload }),
  });
  const local = cloneJson(base);
  local.db.wp_postmeta[postKeyRowId].meta_value = localPayload;
  local.pushIntents = [
    {
      id: 'rpp-0485-local-postmeta-release-verifier',
      kind: 'plugin-data-update',
      requireAtomic: true,
      resources: [postKeyResourceKey],
      resourcePolicy: pluginOwnedResourcePolicy(
        allowedPostmetaResource({ driver: 'wp-post-meta' }),
      ),
    },
  ];
  const remote = cloneJson(base);
  const plan = planFor(base, local, remote);

  const summary = summarizeWpPostmetaReleaseVerifierEvidence({
    proof: releaseProof(plan),
    checkedProductionEvidence: false,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(summary.checked, true);
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.verdict, 'WP_POSTMETA_DRIVER_SEMANTICS_SUPPORT_ONLY');
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
    resourceKey: postKeyResourceKey,
    action: 'put',
    driver: 'wp-post-meta',
    owner: 'forms',
    supportsDelete: false,
    table: 'wp_postmeta',
    rowId: postKeyRowId,
    rowIdKind: 'post_id_meta_key',
    postId: 85,
    metaKey: '_forms:payload:v5',
    policySource: 'push-intent:rpp-0485-local-postmeta-release-verifier',
    supported: true,
    evidenceScope: 'local-candidate',
    releaseGateEvidenceScope: 'local-candidate',
    baseHash: plan.mutations[0].baseHash,
    remoteBeforeHash: plan.mutations[0].remoteBeforeHash,
    localHash: plan.mutations[0].localHash,
    driverEvidenceHash: summary.mutations[0].driverEvidenceHash,
  });
  assert.match(summary.mutations[0].driverEvidenceHash, /^[a-f0-9]{64}$/);
  assertNoRawPostmetaPayloads(summary, [basePayload, localPayload]);
});

test('RPP-0485 release verifier keeps production-scoped wp_postmeta evidence NO-GO without checked production proof', () => {
  const basePayload = 'rpp-0485-base-production-scope-postmeta';
  const localPayload = 'rpp-0485-local-production-scope-postmeta';
  const base = baseSite({
    [metaIdRowId]: postmetaRow({
      postId: 486,
      metaKey: '_forms_remote_payload_v5',
      metaId: 485,
      metaValue: basePayload,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_postmeta[metaIdRowId].meta_value = localPayload;
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [
        allowedPostmetaResource({ resourceKey: metaIdResourceKey }),
      ],
    },
  };
  const plan = planFor(base, local, remote);

  const summary = summarizeWpPostmetaReleaseVerifierEvidence({
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
  assert.equal(summary.releaseGate.verdict, 'WP_POSTMETA_DRIVER_SEMANTICS_PRODUCTION_PROOF_REQUIRED');
  assert.equal(summary.releaseGate.evidenceScope, 'production-backed');
  assert.match(summary.releaseGate.note, /production-backed scope/);
  assert.match(summary.releaseGate.note, /release gate remains NO-GO/);
  assert.equal(summary.mutations[0].rowIdKind, 'meta_id');
  assert.equal(summary.mutations[0].postId, 486);
  assert.equal(summary.mutations[0].metaKey, '_forms_remote_payload_v5');
  assertNoRawPostmetaPayloads(summary, [basePayload, localPayload]);
});

test('RPP-0485 release verifier labels checked production-backed wp_postmeta semantics separately', () => {
  const basePayload = 'rpp-0485-base-production-backed-postmeta';
  const localPayload = 'rpp-0485-local-production-backed-postmeta';
  const base = baseSite({
    [metaIdRowId]: postmetaRow({
      postId: 486,
      metaKey: '_forms_remote_payload_v5',
      metaId: 485,
      metaValue: basePayload,
    }),
  });
  const local = cloneJson(base);
  local.db.wp_postmeta[metaIdRowId].meta_value = localPayload;
  const remote = cloneJson(base);
  remote.meta = {
    evidenceScope: 'production-backed',
    pluginOwnedResources: {
      allowedResources: [
        allowedPostmetaResource({ resourceKey: metaIdResourceKey }),
      ],
    },
  };
  const plan = planFor(base, local, remote);

  const summary = summarizeWpPostmetaReleaseVerifierEvidence({
    proof: releaseProof(plan),
    checkedProductionEvidence: true,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(summary.status, 'checked');
  assert.equal(summary.verdict, 'WP_POSTMETA_DRIVER_SEMANTICS_PRODUCTION_BACKED');
  assert.equal(summary.evidenceScope, 'production-backed');
  assert.equal(summary.releaseGateEvidenceScope, 'production-backed');
  assert.equal(summary.checkedProductionEvidence, true);
  assert.equal(summary.productionBacked, true);
  assert.equal(summary.supportOnly, false);
  assert.equal(summary.acceptedForReleaseGate, true);
  assert.equal(summary.releaseGate.status, 'GO');
  assert.equal(summary.releaseGate.verdict, 'WP_POSTMETA_DRIVER_SEMANTICS_PRODUCTION_BACKED');
  assert.equal(summary.releaseGate.productionBacked, true);
  assert.equal(summary.releaseGate.acceptedForReleaseGate, true);
  assert.match(summary.releaseGate.note, /production-backed/);
  assert.equal(summary.applyTimeRevalidation.verifiedBeforeFirstMutation, true);
  assert.deepEqual(summary.mutations.map((mutation) => mutation.resourceKey), [metaIdResourceKey]);
  assertNoRawPostmetaPayloads(summary, [basePayload, localPayload]);
});

test('RPP-0485 production-shaped release verifier carries wp_postmeta summary into pluginDriver proof', () => {
  const verifierSource = fs.readFileSync(
    path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs'),
    'utf8',
  );

  assert.match(verifierSource, /summarizeWpPostmetaReleaseVerifierEvidence/);
  assert.match(verifierSource, /coreSemantics:\s*\{/);
  assert.match(verifierSource, /wpPostmeta: wpPostmetaReleaseVerifierEvidence,/);
  assert.match(
    verifierSource,
    /checkedProductionEvidence: packagedSourceFixture === null\s*&& Boolean\(explicitReleaseVerifySourceUrl\)\s*&& checkedDurableJournalAccepted/,
  );
});
