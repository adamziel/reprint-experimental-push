import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildComplexSiteReleaseEvidence } from '../scripts/playground/local-production-complex-site-proof.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const postId = 71001;
const termId = 72901;
const termTaxonomyId = 72911;
const termmetaId = 72921;
const termResourceKey = rowResourceKey('wp_terms', `term_id:${termId}`);
const taxonomyResourceKey = rowResourceKey('wp_term_taxonomy', `term_taxonomy_id:${termTaxonomyId}`);
const relationshipResourceKey = rowResourceKey(
  'wp_term_relationships',
  `object_id:${postId}|term_taxonomy_id:${termTaxonomyId}`,
);
const termmetaResourceKey = rowResourceKey('wp_termmeta', `meta_id:${termmetaId}`);
const releaseStateResourceKey = rowResourceKey('wp_reprint_push_release_state', 'state_id:1');
const graphResourceKeys = Object.freeze([
  termResourceKey,
  taxonomyResourceKey,
  relationshipResourceKey,
  termmetaResourceKey,
]);
const privateMarkers = Object.freeze([
  'RPP-0329 Private Category Term',
  'rpp-0329-private-category-term',
  'RPP-0329 private category taxonomy description',
  'rpp-0329-private-termmeta',
]);

test('RPP-0329 local-production verifier carries category term_taxonomy reference through apply', () => {
  const { local, plan, applied } = buildReadyCategoryFixture();
  const releaseSummary = releaseSummaryFromPlan({
    plan,
    appliedSite: applied.site,
    localSite: local,
  });
  const releaseEvidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: { taxonomyGraph: true } },
    verifyOutput: JSON.stringify(releaseSummary, null, 2),
    verifyStatus: 0,
    verifySignal: null,
  });
  const taxonomyMutation = mutationFor(plan, taxonomyResourceKey);
  const taxonomyValue = deserializeResourceValue(taxonomyMutation.value);
  const carryThrough = categoryTermTaxonomyCarryThroughEvidence({
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
  assert.equal(taxonomyValue.taxonomy, 'category');

  assert.equal(applied.appliedMutations, plan.mutations.length);
  assert.equal(resourceHash(applied.site, taxonomyMutation.resource), taxonomyMutation.localHash);
  assert.deepEqual(
    applied.site.db.wp_term_taxonomy[`term_taxonomy_id:${termTaxonomyId}`],
    local.db.wp_term_taxonomy[`term_taxonomy_id:${termTaxonomyId}`],
  );

  assert.equal(releaseEvidence.ok, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.required, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.resourceKey, taxonomyResourceKey);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.termResourceKey, termResourceKey);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.termTaxonomyMutationPlanned, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.termTaxonomyMutationCarriesTermReference, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.termTaxonomyId, termTaxonomyId);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.termId, termId);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.taxonomy, 'category');
  assert.equal(releaseEvidence.verifier.taxonomyGraph.preconditionLive, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.applyRevalidated, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.finalMatchesLocal, true);
  assert.equal(releaseEvidence.invariants.taxonomyGraphTermTaxonomyCarriedInReleasePlan, true);
  assert.equal(releaseEvidence.invariants.taxonomyGraphTermTaxonomyHasReleasePrecondition, true);
  assert.equal(releaseEvidence.invariants.taxonomyGraphTermTaxonomyApplyRevalidated, true);
  assert.equal(releaseEvidence.invariants.taxonomyGraphTermTaxonomyFinalMatchesLocal, true);

  assert.equal(carryThrough.ok, true);
  assert.equal(carryThrough.release.productionBacked, false);
  assert.equal(carryThrough.release.finalRecommendation, 'NO-GO');
  assert.deepEqual(carryThrough.invariants, {
    mutationPlanned: true,
    mutationTargetsCategoryTaxonomy: true,
    mutationCarriesTermReference: true,
    livePrecondition: true,
    applyRevalidated: true,
    appliedHashMatchesLocal: true,
    verifierAccepted: true,
  });
  assertHashOnlyCarryThrough(carryThrough);

  for (const marker of privateMarkers) {
    assert.equal(redactedEvidence.includes(marker), false, `RPP-0329 evidence leaked ${marker}`);
  }
});

test('RPP-0329 verifier evidence fails closed when category term_taxonomy apply revalidation is omitted', () => {
  const { local, plan, applied } = buildReadyCategoryFixture();
  const releaseSummary = releaseSummaryFromPlan({
    plan,
    appliedSite: applied.site,
    localSite: local,
    omitApplyRevalidationResourceKey: taxonomyResourceKey,
  });
  const releaseEvidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: { taxonomyGraph: true } },
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });
  const carryThrough = categoryTermTaxonomyCarryThroughEvidence({
    plan,
    appliedSite: applied.site,
    taxonomyMutation: mutationFor(plan, taxonomyResourceKey),
    releaseEvidence,
  });

  assert.equal(releaseEvidence.ok, false);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.termTaxonomyMutationPlanned, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.termTaxonomyMutationCarriesTermReference, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.preconditionLive, true);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.applyRevalidated, false);
  assert.equal(releaseEvidence.verifier.taxonomyGraph.finalMatchesLocal, true);
  assert.equal(releaseEvidence.invariants.taxonomyGraphTermTaxonomyApplyRevalidated, false);

  assert.equal(carryThrough.ok, false);
  assert.equal(carryThrough.invariants.mutationCarriesTermReference, true);
  assert.equal(carryThrough.invariants.livePrecondition, true);
  assert.equal(carryThrough.invariants.applyRevalidated, false);
  assert.equal(carryThrough.invariants.appliedHashMatchesLocal, true);
  assert.equal(carryThrough.invariants.verifierAccepted, false);
  assert.equal(carryThrough.release.finalRecommendation, 'NO-GO');
  assertHashOnlyCarryThrough(carryThrough);

  const serialized = JSON.stringify({ releaseEvidence, carryThrough });
  for (const marker of privateMarkers) {
    assert.equal(serialized.includes(marker), false, `RPP-0329 evidence leaked ${marker}`);
  }
});

function buildReadyCategoryFixture() {
  const base = categorySiteSnapshot('source');
  const local = categorySiteSnapshot('local-edited');
  const remote = cloneJson(base);
  remote.meta.fixture = 'rpp-0329-remote';
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
      reason: 'checked local-production category term taxonomy carry-through evidence',
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
    id: 'mutation-rpp-0329-release-state',
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
          mode: 'local-rpp-0329',
          version: 2,
          releaseBoundaryProof: 'category-term-taxonomy-reference-v2',
        },
        updated_marker: 'local-rpp-0329',
        __pluginOwner: 'reprint-push',
      },
    },
    baseHash: 'b'.repeat(64),
    remoteBeforeHash: 'b'.repeat(64),
    localHash: 'c'.repeat(64),
  };
}

function categoryTermTaxonomyCarryThroughEvidence({
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
    mutationTargetsCategoryTaxonomy: taxonomyMutation?.resource?.table === 'wp_term_taxonomy'
      && taxonomyMutation?.resource?.id === `term_taxonomy_id:${termTaxonomyId}`,
    mutationCarriesTermReference: Number(taxonomyValue?.term_taxonomy_id) === termTaxonomyId
      && Number(taxonomyValue?.term_id) === termId
      && taxonomyValue?.taxonomy === 'category',
    livePrecondition: precondition?.checkedAgainst === 'live-remote'
      && hashPattern.test(precondition?.expectedHash || '')
      && precondition?.expectedHash === taxonomyMutation?.baseHash
      && precondition?.expectedHash === taxonomyMutation?.remoteBeforeHash,
    applyRevalidated: releaseEvidence?.verifier?.taxonomyGraph?.applyRevalidated === true,
    appliedHashMatchesLocal: hashPattern.test(appliedHash || '')
      && appliedHash === taxonomyMutation?.localHash,
    verifierAccepted: releaseEvidence?.ok === true,
  };
  const proof = {
    target: 'categoryTermTaxonomyReferenceVariant2',
    evidenceScope: 'local-production-verifier-carry-through',
    resourceKey: taxonomyResourceKey,
    termResourceKey,
    relationshipResourceKey,
    termmetaResourceKey,
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
      finalMatchesLocal: releaseEvidence?.verifier?.taxonomyGraph?.finalMatchesLocal ?? null,
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

function categorySiteSnapshot(variant) {
  const local = variant === 'local-edited';
  const snapshot = {
    meta: {
      fixture: `rpp-0329-${variant}`,
    },
    files: {},
    plugins: {},
    db: emptyDb(),
  };

  snapshot.db.wp_posts[`ID:${postId}`] = {
    ID: postId,
    post_title: 'RPP-0329 taxonomy anchor post',
    post_name: 'rpp-0329-taxonomy-anchor-post',
    post_content: 'Stable anchor post for category term taxonomy variant 2 proof.',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };
  if (local) {
    snapshot.db.wp_terms[`term_id:${termId}`] = {
      term_id: termId,
      name: 'RPP-0329 Private Category Term',
      slug: 'rpp-0329-private-category-term',
      term_group: 0,
    };
    snapshot.db.wp_term_taxonomy[`term_taxonomy_id:${termTaxonomyId}`] = {
      term_taxonomy_id: termTaxonomyId,
      term_id: termId,
      taxonomy: 'category',
      description: 'RPP-0329 private category taxonomy description',
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
    snapshot.db.wp_termmeta[`meta_id:${termmetaId}`] = {
      meta_id: termmetaId,
      term_id: termId,
      meta_key: 'reprint_push_taxonomy_fixture',
      meta_value: 'rpp-0329-private-termmeta',
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
