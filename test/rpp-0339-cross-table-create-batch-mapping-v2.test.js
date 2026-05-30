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

const postId = 71701;
const metaKey = 'reprint_push_postmeta_post_fixture';
const postResourceKey = rowResourceKey('wp_posts', `ID:${postId}`);
const postmetaResourceKey = rowResourceKey('wp_postmeta', `post_id:${postId}:meta_key:${metaKey}`);
const releaseStateResourceKey = rowResourceKey('wp_reprint_push_release_state', 'state_id:1');
const batchResourceKeys = Object.freeze([
  postResourceKey,
  postmetaResourceKey,
]);
const privateMarkers = Object.freeze([
  'RPP-0339 Private Cross Table Post Target',
  'rpp-0339-private-cross-table-post',
  'RPP-0339 private post content',
  'local-private-rpp-0339-postmeta-reference',
]);

test('RPP-0339 local-production verifier carries a cross-table create batch through apply', () => {
  const { local, plan, applied } = buildReadyCrossTableCreateBatchFixture();
  const releaseSummary = releaseSummaryFromPlan({
    plan,
    appliedSite: applied.site,
    localSite: local,
  });
  const releaseEvidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: { postmetaPostGraph: true } },
    verifyOutput: JSON.stringify(releaseSummary, null, 2),
    verifyStatus: 0,
    verifySignal: null,
  });
  const postMutation = mutationFor(plan, postResourceKey);
  const postmetaMutation = mutationFor(plan, postmetaResourceKey);
  const postmetaValue = deserializeResourceValue(postmetaMutation.value);
  const carryThrough = crossTableCreateBatchCarryThroughEvidence({
    plan,
    appliedSite: applied.site,
    releaseEvidence,
  });
  const redactedEvidence = JSON.stringify({ releaseEvidence, carryThrough });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.conflicts.length, 0);
  assert.deepEqual(new Set(plan.mutations.map((mutation) => mutation.resourceKey)), new Set(batchResourceKeys));
  assertEveryMutationHasLiveRemotePrecondition(plan);

  assert.equal(postMutation.action, 'put');
  assert.equal(postMutation.changeKind, 'create');
  assert.equal(postMutation.resource.table, 'wp_posts');
  assert.equal(postMutation.resource.id, `ID:${postId}`);
  assert.equal(postmetaMutation.action, 'put');
  assert.equal(postmetaMutation.changeKind, 'create');
  assert.equal(postmetaMutation.resource.table, 'wp_postmeta');
  assert.equal(postmetaMutation.resource.id, `post_id:${postId}:meta_key:${metaKey}`);
  assert.equal(postmetaValue.post_id, postId);
  assert.equal(postmetaValue.meta_key, metaKey);

  assert.equal(applied.appliedMutations, plan.mutations.length);
  assert.equal(resourceHash(applied.site, postMutation.resource), postMutation.localHash);
  assert.equal(resourceHash(applied.site, postmetaMutation.resource), postmetaMutation.localHash);
  assert.deepEqual(applied.site.db.wp_posts[`ID:${postId}`], local.db.wp_posts[`ID:${postId}`]);
  assert.deepEqual(
    applied.site.db.wp_postmeta[`post_id:${postId}:meta_key:${metaKey}`],
    local.db.wp_postmeta[`post_id:${postId}:meta_key:${metaKey}`],
  );

  assert.equal(releaseEvidence.ok, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.required, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.postResourceKey, postResourceKey);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.postmetaResourceKey, postmetaResourceKey);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.postMutationPlanned, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.postmetaMutationPlanned, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.postId, postId);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.metaKey, metaKey);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.postmetaReferencesPost, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.preconditionLive, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.applyRevalidated, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.finalMatchesLocal, true);
  assert.equal(releaseEvidence.invariants.postmetaPostGraphCarriedInReleasePlan, true);
  assert.equal(releaseEvidence.invariants.postmetaPostGraphHasReleasePrecondition, true);
  assert.equal(releaseEvidence.invariants.postmetaPostGraphApplyRevalidated, true);
  assert.equal(releaseEvidence.invariants.postmetaPostGraphFinalMatchesLocal, true);

  assert.equal(carryThrough.ok, true);
  assert.equal(carryThrough.release.productionBacked, false);
  assert.equal(carryThrough.release.finalRecommendation, 'NO-GO');
  assert.deepEqual(carryThrough.referenceEdges, [
    {
      relationshipKey: 'wp_postmeta.post_id',
      sourceResourceKey: postmetaResourceKey,
      targetResourceKey: postResourceKey,
      preserved: true,
    },
  ]);
  assert.deepEqual(carryThrough.invariants, {
    postMutationPlanned: true,
    postmetaMutationPlanned: true,
    everyMutationCreate: true,
    postmetaReferencesCreatedPost: true,
    everyMutationHasLivePrecondition: true,
    applyRevalidatedBatch: true,
    appliedHashesMatchLocal: true,
    verifierAccepted: true,
  });
  assertHashOnlyCarryThrough(carryThrough);

  for (const marker of privateMarkers) {
    assert.equal(redactedEvidence.includes(marker), false, `RPP-0339 evidence leaked ${marker}`);
  }
});

test('RPP-0339 verifier evidence fails closed when the dependent row is not apply-revalidated', () => {
  const { local, plan, applied } = buildReadyCrossTableCreateBatchFixture();
  const releaseSummary = releaseSummaryFromPlan({
    plan,
    appliedSite: applied.site,
    localSite: local,
    replaceApplyRevalidationResourceKey: postmetaResourceKey,
  });
  const releaseEvidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: { postmetaPostGraph: true } },
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });
  const carryThrough = crossTableCreateBatchCarryThroughEvidence({
    plan,
    appliedSite: applied.site,
    releaseEvidence,
  });
  const serialized = JSON.stringify({ releaseEvidence, carryThrough });

  assert.equal(releaseEvidence.ok, false);
  assert.equal(releaseEvidence.invariants.applyRevalidationCoveredEveryMutation, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.postMutationPlanned, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.postmetaMutationPlanned, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.postmetaReferencesPost, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.preconditionLive, true);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.applyRevalidated, false);
  assert.equal(releaseEvidence.verifier.postmetaPostGraph.finalMatchesLocal, true);
  assert.equal(releaseEvidence.invariants.postmetaPostGraphApplyRevalidated, false);

  assert.equal(carryThrough.ok, false);
  assert.equal(carryThrough.invariants.postmetaReferencesCreatedPost, true);
  assert.equal(carryThrough.invariants.everyMutationHasLivePrecondition, true);
  assert.equal(carryThrough.invariants.applyRevalidatedBatch, false);
  assert.equal(carryThrough.invariants.appliedHashesMatchLocal, true);
  assert.equal(carryThrough.invariants.verifierAccepted, false);
  assertHashOnlyCarryThrough(carryThrough);

  for (const marker of privateMarkers) {
    assert.equal(serialized.includes(marker), false, `RPP-0339 evidence leaked ${marker}`);
  }
});

function buildReadyCrossTableCreateBatchFixture() {
  const base = crossTableCreateBatchSiteSnapshot('source');
  const local = crossTableCreateBatchSiteSnapshot('local-edited');
  const remote = cloneJson(base);
  remote.meta.fixture = 'rpp-0339-remote';
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
  replaceApplyRevalidationResourceKey = null,
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
  const verifiedResourceKeys = mutations.map((mutation) =>
    mutation.resourceKey === replaceApplyRevalidationResourceKey
      ? rowResourceKey('wp_posts', 'ID:73339')
      : mutation.resourceKey);

  return {
    ok: true,
    releaseMovement: {
      allowed: true,
      gates: 'candidate-for-review',
      reason: 'checked local-production cross-table create batch carry-through evidence',
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
    id: 'mutation-rpp-0339-release-state',
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
          mode: 'local-rpp-0339',
          version: 2,
          releaseBoundaryProof: 'cross-table-create-batch-mapping-v2',
        },
        updated_marker: 'local-rpp-0339',
        __pluginOwner: 'reprint-push',
      },
    },
    baseHash: 'b'.repeat(64),
    remoteBeforeHash: 'b'.repeat(64),
    localHash: 'c'.repeat(64),
  };
}

function crossTableCreateBatchCarryThroughEvidence({
  plan,
  appliedSite,
  releaseEvidence,
} = {}) {
  const postMutation = mutationFor(plan, postResourceKey);
  const postmetaMutation = mutationFor(plan, postmetaResourceKey);
  const postmetaValue = postmetaMutation ? deserializeResourceValue(postmetaMutation.value) : null;
  const postPrecondition = preconditionFor(plan, postMutation);
  const postmetaPrecondition = preconditionFor(plan, postmetaMutation);
  const postAppliedHash = postMutation ? resourceHash(appliedSite, postMutation.resource) : null;
  const postmetaAppliedHash = postmetaMutation ? resourceHash(appliedSite, postmetaMutation.resource) : null;
  const invariants = {
    postMutationPlanned: Boolean(postMutation),
    postmetaMutationPlanned: Boolean(postmetaMutation),
    everyMutationCreate: [postMutation, postmetaMutation].every((mutation) =>
      mutation?.action === 'put' && mutation?.changeKind === 'create'),
    postmetaReferencesCreatedPost: Number(postmetaValue?.post_id) === postId
      && postmetaValue?.meta_key === metaKey,
    everyMutationHasLivePrecondition: [
      [postMutation, postPrecondition],
      [postmetaMutation, postmetaPrecondition],
    ].every(([mutation, precondition]) =>
      precondition?.checkedAgainst === 'live-remote'
      && hashPattern.test(precondition?.expectedHash || '')
      && precondition?.expectedHash === mutation?.baseHash
      && precondition?.expectedHash === mutation?.remoteBeforeHash),
    applyRevalidatedBatch: releaseEvidence?.verifier?.postmetaPostGraph?.applyRevalidated === true,
    appliedHashesMatchLocal: hashPattern.test(postAppliedHash || '')
      && hashPattern.test(postmetaAppliedHash || '')
      && postAppliedHash === postMutation?.localHash
      && postmetaAppliedHash === postmetaMutation?.localHash,
    verifierAccepted: releaseEvidence?.ok === true,
  };
  const proof = {
    target: 'crossTableCreateBatchMappingVariant2',
    evidenceScope: 'local-production-verifier-carry-through',
    batch: {
      resourceKeys: batchResourceKeys,
      tables: ['wp_postmeta', 'wp_posts'],
      createMutationCount: plan.mutations.length,
    },
    referenceEdges: [
      {
        relationshipKey: 'wp_postmeta.post_id',
        sourceResourceKey: postmetaResourceKey,
        targetResourceKey: postResourceKey,
        preserved: invariants.postmetaReferencesCreatedPost,
      },
    ],
    postId: Number(postmetaValue?.post_id),
    metaKey: postmetaValue?.meta_key || null,
    hashes: {
      post: {
        base: postMutation?.baseHash || null,
        remoteBefore: postMutation?.remoteBeforeHash || null,
        precondition: postPrecondition?.expectedHash || null,
        local: postMutation?.localHash || null,
        applied: postAppliedHash,
      },
      postmeta: {
        base: postmetaMutation?.baseHash || null,
        remoteBefore: postmetaMutation?.remoteBeforeHash || null,
        precondition: postmetaPrecondition?.expectedHash || null,
        local: postmetaMutation?.localHash || null,
        applied: postmetaAppliedHash,
      },
      receipt: releaseEvidence?.verifier?.receipt?.hash || null,
    },
    verifier: {
      status: releaseEvidence?.verifier?.status ?? null,
      signal: releaseEvidence?.verifier?.signal ?? null,
      planMutations: releaseEvidence?.verifier?.plan?.mutations ?? null,
      planPreconditions: releaseEvidence?.verifier?.plan?.preconditions ?? null,
      finalMatchesLocal: releaseEvidence?.verifier?.postmetaPostGraph?.finalMatchesLocal ?? null,
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

function crossTableCreateBatchSiteSnapshot(variant) {
  const local = variant === 'local-edited';
  const snapshot = {
    meta: {
      fixture: `rpp-0339-${variant}`,
    },
    files: {},
    plugins: {},
    db: emptyDb(),
  };

  if (local) {
    snapshot.db.wp_posts[`ID:${postId}`] = {
      ID: postId,
      post_title: 'RPP-0339 Private Cross Table Post Target',
      post_name: 'rpp-0339-private-cross-table-post',
      post_content: 'RPP-0339 private post content',
      post_status: 'publish',
      post_type: 'post',
      post_parent: 0,
      post_author: 0,
    };
    snapshot.db.wp_postmeta[`post_id:${postId}:meta_key:${metaKey}`] = {
      post_id: postId,
      meta_key: metaKey,
      meta_value: 'local-private-rpp-0339-postmeta-reference',
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
  for (const [label, hash] of Object.entries(evidence.hashes.post)) {
    assert.match(hash, hashPattern, `post ${label} must be a 64-character hash`);
  }
  for (const [label, hash] of Object.entries(evidence.hashes.postmeta)) {
    assert.match(hash, hashPattern, `postmeta ${label} must be a 64-character hash`);
  }
  assert.match(evidence.hashes.receipt, hashPattern, 'receipt must be a 64-character hash');
  assert.equal(evidence.hashes.post.precondition, evidence.hashes.post.base);
  assert.equal(evidence.hashes.post.remoteBefore, evidence.hashes.post.base);
  assert.equal(evidence.hashes.post.applied, evidence.hashes.post.local);
  assert.equal(evidence.hashes.postmeta.precondition, evidence.hashes.postmeta.base);
  assert.equal(evidence.hashes.postmeta.remoteBefore, evidence.hashes.postmeta.base);
  assert.equal(evidence.hashes.postmeta.applied, evidence.hashes.postmeta.local);
  assert.match(evidence.proofHash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(evidence, 'value'), false);
  assert.equal(Object.hasOwn(evidence, 'rawValue'), false);
  assert.equal(Object.hasOwn(evidence, 'postTitle'), false);
  assert.equal(Object.hasOwn(evidence, 'postContent'), false);
  assert.equal(Object.hasOwn(evidence, 'metaValue'), false);
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
