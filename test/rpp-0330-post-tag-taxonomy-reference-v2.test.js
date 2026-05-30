import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildComplexSiteReleaseEvidence } from '../scripts/playground/local-production-complex-site-proof.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0330-post-tag-taxonomy-reference-v2.md',
);

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const postId = 71002;
const termId = 72931;
const termTaxonomyId = 72941;
const termResourceKey = rowResourceKey('wp_terms', `term_id:${termId}`);
const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${termTaxonomyId}`);
const relationshipResourceKey = rowResourceKey(
  'wp_term_relationships',
  `object_id:${postId}|term_taxonomy_id:${termTaxonomyId}`,
);
const releaseStateResourceKey = rowResourceKey('wp_reprint_push_release_state', 'state_id:1');
const graphResourceKeys = Object.freeze([
  termResourceKey,
  taxonomyResourceKey,
  relationshipResourceKey,
]);
const privateMarkers = Object.freeze([
  'RPP-0330 Private Post Tag Term',
  'rpp-0330-private-post-tag-term',
  'RPP-0330 private post_tag taxonomy description',
]);

test('RPP-0330 local-production verifier carries post_tag taxonomy reference through apply', () => {
  const { local, plan, applied } = buildReadyPostTagFixture();
  const releaseSummary = releaseSummaryFromPlan({
    plan,
    appliedSite: applied.site,
    localSite: local,
  });
  const releaseEvidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: { postTagTaxonomyGraph: true } },
    verifyOutput: JSON.stringify(releaseSummary, null, 2),
    verifyStatus: 0,
    verifySignal: null,
  });
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const taxonomyValue = deserializeResourceValue(taxonomyMutation.value);
  const carryThrough = postTagTaxonomyCarryThroughEvidence({
    plan,
    appliedSite: applied.site,
    taxonomyMutation,
    releaseEvidence,
  });
  const redactedEvidence = JSON.stringify({ releaseEvidence, carryThrough });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(new Set(plan.mutations.map((mutation) => mutation.resourceKey)), new Set(graphResourceKeys));
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(taxonomyMutation.action, 'put');
  assert.equal(taxonomyMutation.resource.table, 'wp_term_taxonomy');
  assert.equal(taxonomyMutation.resource.id, `term_taxonomy_id:${termTaxonomyId}`);
  assert.equal(taxonomyValue.term_taxonomy_id, termTaxonomyId);
  assert.equal(taxonomyValue.term_id, termId);
  assert.equal(taxonomyValue.taxonomy, 'post_tag');

  assert.equal(applied.appliedMutations, plan.mutations.length);
  assert.equal(resourceHash(applied.site, taxonomyMutation.resource), taxonomyMutation.localHash);
  assert.deepEqual(
    applied.site.db.wp_term_taxonomy[`term_taxonomy_id:${termTaxonomyId}`],
    local.db.wp_term_taxonomy[`term_taxonomy_id:${termTaxonomyId}`],
  );

  assert.equal(releaseEvidence.ok, true);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.required, true);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.resourceKey, taxonomyResourceKey);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.termResourceKey, termResourceKey);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.relationshipResourceKey, relationshipResourceKey);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.taxonomyMutationPlanned, true);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.taxonomyMutationIsPostTag, true);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.termTaxonomyId, termTaxonomyId);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.termId, termId);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.taxonomy, 'post_tag');
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.preconditionLive, true);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.applyRevalidated, true);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.finalMatchesLocal, true);
  assert.equal(releaseEvidence.invariants.postTagTaxonomyGraphCarriedInReleasePlan, true);
  assert.equal(releaseEvidence.invariants.postTagTaxonomyGraphHasReleasePrecondition, true);
  assert.equal(releaseEvidence.invariants.postTagTaxonomyGraphApplyRevalidated, true);
  assert.equal(releaseEvidence.invariants.postTagTaxonomyGraphFinalMatchesLocal, true);

  assert.equal(carryThrough.ok, true);
  assert.equal(carryThrough.release.productionBacked, false);
  assert.equal(carryThrough.release.finalRecommendation, 'NO-GO');
  assert.deepEqual(carryThrough.invariants, {
    mutationPlanned: true,
    mutationTargetsPostTagTaxonomy: true,
    mutationCarriesPostTagReference: true,
    livePrecondition: true,
    applyRevalidated: true,
    appliedHashMatchesLocal: true,
    verifierAccepted: true,
  });
  assertHashOnlyCarryThrough(carryThrough);

  for (const marker of privateMarkers) {
    assert.equal(redactedEvidence.includes(marker), false, `RPP-0330 evidence leaked ${marker}`);
  }
});

test('RPP-0330 verifier evidence fails closed when post_tag taxonomy apply revalidation is omitted', () => {
  const { local, plan, applied } = buildReadyPostTagFixture();
  const releaseSummary = releaseSummaryFromPlan({
    plan,
    appliedSite: applied.site,
    localSite: local,
    omitApplyRevalidationResourceKey: taxonomyResourceKey,
  });
  const releaseEvidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: { postTagTaxonomyGraph: true } },
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });
  const carryThrough = postTagTaxonomyCarryThroughEvidence({
    plan,
    appliedSite: applied.site,
    taxonomyMutation: mutationFor(plan, taxonomyResourceKey),
    releaseEvidence,
  });

  assert.equal(releaseEvidence.ok, false);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.taxonomyMutationPlanned, true);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.taxonomyMutationIsPostTag, true);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.preconditionLive, true);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.applyRevalidated, false);
  assert.equal(releaseEvidence.verifier.postTagTaxonomyGraph.finalMatchesLocal, true);
  assert.equal(releaseEvidence.invariants.postTagTaxonomyGraphApplyRevalidated, false);

  assert.equal(carryThrough.ok, false);
  assert.equal(carryThrough.invariants.mutationCarriesPostTagReference, true);
  assert.equal(carryThrough.invariants.livePrecondition, true);
  assert.equal(carryThrough.invariants.applyRevalidated, false);
  assert.equal(carryThrough.invariants.appliedHashMatchesLocal, true);
  assert.equal(carryThrough.invariants.verifierAccepted, false);
  assert.equal(carryThrough.release.finalRecommendation, 'NO-GO');
  assertHashOnlyCarryThrough(carryThrough);

  const serialized = JSON.stringify({ releaseEvidence, carryThrough });
  for (const marker of privateMarkers) {
    assert.equal(serialized.includes(marker), false, `RPP-0330 evidence leaked ${marker}`);
  }
});

test('RPP-0330 evidence docs state remaining unmapped WordPress surfaces', () => {
  const evidenceDoc = fs.readFileSync(evidencePath, 'utf8');

  assert.match(evidenceDoc, /^# RPP-0330 post_tag taxonomy reference v2 evidence$/m);
  assert.match(evidenceDoc, /^## Remaining unmapped WordPress surfaces$/m);
  assert.match(evidenceDoc, /`post_tag` is covered by the local-production verifier carry-through proof/);
  for (const documentedSurface of [
    '`wp_term_taxonomy.taxonomy = nav_menu`',
    'Custom/plugin taxonomy rows without an explicit equivalent identity-map target',
    '`wp_posts.post_type = nav_menu_item`',
    '`wp_navigation`',
    'Serialized block references',
  ]) {
    assert.ok(
      evidenceDoc.includes(documentedSurface),
      `missing documented surface: ${documentedSurface}`,
    );
  }
});

function buildReadyPostTagFixture() {
  const base = postTagSiteSnapshot('source');
  const local = postTagSiteSnapshot('local-edited');
  const remote = cloneJson(base);
  remote.meta.fixture = 'rpp-0330-remote';
  const plan = createPushPlan({ base, local, remote, now: fixedNow });
  const applied = applyPlan(cloneJson(remote), plan);

  assert.equal(plan.status, 'ready');
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.conflicts.length, 0);

  return { base, local, remote, plan, applied };
}

function releaseSummaryFromPlan({
  plan,
  appliedSite,
  localSite,
  omitApplyRevalidationResourceKey = null,
} = {}) {
  const releaseStateMutation = syntheticReleaseStateMutation();
  const mutations = [
    releaseStateMutation,
    ...cloneJson(plan.mutations),
  ];
  const preconditions = [
    {
      mutationId: releaseStateMutation.id,
      resourceKey: releaseStateMutation.resourceKey,
      checkedAgainst: 'live-remote',
      expectedHash: releaseStateMutation.baseHash,
    },
    ...cloneJson(plan.preconditions),
  ];
  const verifiedResourceKeys = mutations
    .map((mutation) => mutation.resourceKey)
    .filter((resourceKey) => resourceKey !== omitApplyRevalidationResourceKey);

  return {
    ok: true,
    releaseMovement: {
      allowed: true,
      gates: 'candidate-for-review',
      reason: 'checked local-production post_tag taxonomy carry-through evidence',
    },
    boundary: {
      firstRemainingProductionBoundary: null,
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      authSession: { verdict: 'LIVE_RELEASE_BOUNDARY_OK' },
      durableJournal: { verdict: 'LIVE_RELEASE_BOUNDARY_OK' },
      replayAndRetry: { verdict: 'LIVE_RELEASE_BOUNDARY_OK' },
    },
    authSessionBoundary: {
      verdict: 'AUTH_SESSION_BOUNDARY_OK',
      identityContinuity: {
        sameSession: true,
        sameUserLogin: true,
        manageOptions: true,
      },
    },
    releaseProof: {
      dryRun: {
        status: 200,
        receiptHash: 'a'.repeat(64),
      },
      apply: {
        status: 200,
        applyRevalidation: {
          verifiedCount: mutations.length,
          phase: 'before-first-mutation',
          checkedAgainst: 'live-remote',
          verifiedResourceKeys,
        },
      },
      after: {
        status: 200,
        finalMatchesLocal: isDeepStrictEqual(appliedSite.db, localSite.db),
      },
      planObject: {
        mutations,
        preconditions,
      },
    },
    durableJournal: {
      rows: mutations.length + 10,
      rowCount: mutations.length + 10,
      readbackPages: 1,
      paginationComplete: true,
      paginationTruncated: false,
      oldestSequence: 1,
      newestSequence: mutations.length + 10,
      mutationApplied: mutations.length,
      applyCommitted: true,
      checkedAccepted: true,
      ownership: {
        ownsJournal: true,
        restartReadable: true,
      },
    },
    replayEquivalence: {
      equivalent: true,
      mismatches: [],
    },
    gate2DurableRecoveryJournal: {
      ok: true,
    },
  };
}

function syntheticReleaseStateMutation() {
  return {
    id: 'mutation-rpp-0330-release-state',
    resourceKey: releaseStateResourceKey,
    action: 'put',
    resource: {
      type: 'row',
      table: 'wp_reprint_push_release_state',
      id: 'state_id:1',
      key: releaseStateResourceKey,
    },
    pluginOwnedResource: {
      pluginOwner: 'reprint-push',
      driver: 'reprint-push-release-state',
      table: 'wp_reprint_push_release_state',
      supportsDelete: false,
    },
    value: {
      value: {
        state_id: 1,
        payload: {
          owner: 'reprint-push',
          mode: 'local-rpp-0330',
          version: 2,
          releaseBoundaryProof: 'post-tag-taxonomy-reference-v2',
        },
        updated_marker: 'local-rpp-0330',
        __pluginOwner: 'reprint-push',
      },
    },
    baseHash: 'b'.repeat(64),
    remoteBeforeHash: 'b'.repeat(64),
    localHash: 'c'.repeat(64),
  };
}

function postTagTaxonomyCarryThroughEvidence({
  plan,
  appliedSite,
  taxonomyMutation,
  releaseEvidence,
} = {}) {
  const taxonomyValue = taxonomyMutation ? deserializeResourceValue(taxonomyMutation.value) : null;
  const precondition = preconditionFor(plan, taxonomyMutation);
  const appliedHash = taxonomyMutation ? resourceHash(appliedSite, taxonomyMutation.resource) : null;
  const invariants = {
    mutationPlanned: Boolean(taxonomyMutation),
    mutationTargetsPostTagTaxonomy: taxonomyMutation?.resource?.table === 'wp_term_taxonomy'
      && taxonomyMutation?.resource?.id === `term_taxonomy_id:${termTaxonomyId}`,
    mutationCarriesPostTagReference: Number(taxonomyValue?.term_taxonomy_id) === termTaxonomyId
      && Number(taxonomyValue?.term_id) === termId
      && taxonomyValue?.taxonomy === 'post_tag',
    livePrecondition: precondition?.checkedAgainst === 'live-remote'
      && hashPattern.test(precondition?.expectedHash || '')
      && precondition?.expectedHash === taxonomyMutation?.baseHash
      && precondition?.expectedHash === taxonomyMutation?.remoteBeforeHash,
    applyRevalidated: releaseEvidence?.verifier?.postTagTaxonomyGraph?.applyRevalidated === true,
    appliedHashMatchesLocal: hashPattern.test(appliedHash || '')
      && appliedHash === taxonomyMutation?.localHash,
    verifierAccepted: releaseEvidence?.ok === true,
  };
  const proof = {
    target: 'postTagTaxonomyReferenceVariant2',
    evidenceScope: 'local-production-verifier-carry-through',
    resourceKey: taxonomyResourceKey,
    termResourceKey,
    relationshipResourceKey,
    termTaxonomyId: Number(taxonomyValue?.term_taxonomy_id),
    termId: Number(taxonomyValue?.term_id),
    taxonomy: taxonomyValue?.taxonomy || null,
    hashes: {
      base: taxonomyMutation?.baseHash || null,
      remoteBefore: taxonomyMutation?.remoteBeforeHash || null,
      precondition: precondition?.expectedHash || null,
      local: taxonomyMutation?.localHash || null,
      applied: appliedHash,
      receipt: releaseEvidence?.verifier?.receipt?.hash || null,
    },
    verifier: {
      status: releaseEvidence?.verifier?.status ?? null,
      signal: releaseEvidence?.verifier?.signal ?? null,
      planMutations: releaseEvidence?.verifier?.plan?.mutations ?? null,
      planPreconditions: releaseEvidence?.verifier?.plan?.preconditions ?? null,
      finalMatchesLocal: releaseEvidence?.verifier?.postTagTaxonomyGraph?.finalMatchesLocal ?? null,
    },
    release: {
      productionBacked: false,
      finalRecommendation: 'NO-GO',
      caveat: 'local-production-verifier-evidence-only',
    },
    invariants,
  };

  return {
    ...proof,
    ok: Object.values(invariants).every(Boolean),
    proofHash: `sha256:${digest(proof)}`,
  };
}

function postTagSiteSnapshot(variant) {
  const local = variant === 'local-edited';
  const snapshot = {
    meta: {
      fixture: `rpp-0330-${variant}`,
    },
    files: {},
    plugins: {},
    db: emptyDb(),
  };

  snapshot.db.wp_posts[`ID:${postId}`] = {
    ID: postId,
    post_title: 'RPP-0330 taxonomy anchor post',
    post_name: 'rpp-0330-taxonomy-anchor-post',
    post_content: 'Stable anchor post for post_tag taxonomy variant 2 proof.',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };
  if (local) {
    snapshot.db.wp_terms[`term_id:${termId}`] = {
      term_id: termId,
      name: 'RPP-0330 Private Post Tag Term',
      slug: 'rpp-0330-private-post-tag-term',
      term_group: 0,
    };
    snapshot.db.wp_term_taxonomy[`term_taxonomy_id:${termTaxonomyId}`] = {
      term_taxonomy_id: termTaxonomyId,
      term_id: termId,
      taxonomy: 'post_tag',
      description: 'RPP-0330 private post_tag taxonomy description',
      parent: 0,
      count: 1,
    };
    snapshot.db.wp_term_relationships[
      `object_id:${postId}|term_taxonomy_id:${termTaxonomyId}`
    ] = {
      object_id: postId,
      term_taxonomy_id: termTaxonomyId,
      term_order: 0,
    };
  }

  return snapshot;
}

function emptyDb() {
  return {
    wp_posts: {},
    wp_users: {},
    wp_options: {},
    wp_postmeta: {},
    wp_reprint_push_forms_lab: {},
    wp_reprint_push_release_state: {},
    wp_terms: {},
    wp_term_taxonomy: {},
    wp_term_relationships: {},
    wp_termmeta: {},
    wp_comments: {},
    wp_commentmeta: {},
  };
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    const precondition = preconditionFor(plan, mutation);
    assert.ok(precondition, `missing live precondition for ${mutation.resourceKey}`);
    assert.equal(precondition.resourceKey, mutation.resourceKey);
    assert.equal(precondition.checkedAgainst, 'live-remote');
    assert.equal(precondition.expectedHash, mutation.baseHash);
    assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
    assert.match(precondition.expectedHash, hashPattern);
  }
}

function assertHashOnlyCarryThrough(evidence) {
  for (const [label, hash] of Object.entries(evidence.hashes)) {
    assert.match(hash, hashPattern, `${label} must be a 64-character hash`);
  }
  assert.equal(evidence.hashes.precondition, evidence.hashes.base);
  assert.equal(evidence.hashes.remoteBefore, evidence.hashes.base);
  assert.equal(evidence.hashes.applied, evidence.hashes.local);
  assert.match(evidence.proofHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(evidence, 'value'), false);
  assert.equal(Object.hasOwn(evidence, 'rawValue'), false);
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) =>
    precondition.mutationId === mutation?.id
    && precondition.resourceKey === mutation?.resourceKey) || null;
}
