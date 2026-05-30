import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { buildComplexSiteReleaseEvidence } from '../scripts/playground/local-production-complex-site-proof.js';

const proofNow = new Date('2026-05-30T09:00:00.000Z');
const releaseStateResourceKey = 'row:["wp_reprint_push_release_state","state_id:1"]';
const postResourceKey = 'row:["wp_posts","ID:71701"]';
const postmetaResourceKey = 'row:["wp_postmeta","post_id:71701:meta_key:reprint_push_postmeta_post_fixture"]';

const postmetaPostGraphShape = Object.freeze({
  postCount: 3,
  schemaMetaCount: 2,
  fileCount: 2,
  formsLabRows: 2,
  remoteDriftPosts: 1,
  remoteDriftFiles: 1,
  featuredImageGraph: false,
  taxonomyGraph: false,
  postTagTaxonomyGraph: false,
  postmetaPostGraph: true,
  postParentGraph: false,
  commentGraph: false,
});

test('RPP-0379 maps a same-plan post/postmeta create batch and release evidence carries it through apply', () => {
  const { base, local, remote } = postmetaPostCreateBatchSnapshots();
  const plan = createPushPlan({ base, local, remote, now: proofNow });
  const applied = applyPlan(remote, plan).site;
  const releaseSummary = localProductionReleaseSummaryFromPlan(plan);
  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: postmetaPostGraphShape },
    verifyOutput: JSON.stringify(releaseSummary, null, 2),
    verifyStatus: 0,
    verifySignal: null,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.blockers, 0);
  assert.equal(mutationFor(plan, postResourceKey).changeKind, 'create');
  assert.equal(mutationFor(plan, postmetaResourceKey).changeKind, 'create');
  assertEveryMutationHasLiveRemotePrecondition(plan);
  assert.equal(applied.db.wp_posts['ID:71701'].post_name, 'reprint-push-postmeta-post-graph');
  assert.equal(
    applied.db.wp_postmeta['post_id:71701:meta_key:reprint_push_postmeta_post_fixture'].post_id,
    71701,
  );
  assert.equal(
    applied.db.wp_postmeta['post_id:71701:meta_key:reprint_push_postmeta_post_fixture'].meta_key,
    'reprint_push_postmeta_post_fixture',
  );

  assert.equal(evidence.ok, true);
  assert.equal(evidence.verifier.postmetaPostGraph.required, true);
  assert.equal(evidence.verifier.postmetaPostGraph.postMutationPlanned, true);
  assert.equal(evidence.verifier.postmetaPostGraph.postmetaMutationPlanned, true);
  assert.equal(evidence.verifier.postmetaPostGraph.postId, 71701);
  assert.equal(evidence.verifier.postmetaPostGraph.metaKey, 'reprint_push_postmeta_post_fixture');
  assert.equal(evidence.verifier.postmetaPostGraph.postmetaReferencesPost, true);
  assert.equal(evidence.verifier.postmetaPostGraph.preconditionLive, true);
  assert.equal(evidence.verifier.postmetaPostGraph.applyRevalidated, true);
  assert.equal(evidence.verifier.postmetaPostGraph.finalMatchesLocal, true);
  assert.equal(evidence.invariants.postmetaPostGraphCarriedInReleasePlan, true);
  assert.equal(evidence.invariants.postmetaPostGraphHasReleasePrecondition, true);
  assert.equal(evidence.invariants.postmetaPostGraphApplyRevalidated, true);
  assert.equal(evidence.invariants.postmetaPostGraphFinalMatchesLocal, true);
});

test('RPP-0379 release evidence fails closed when the postmeta batch target is not apply-revalidated', () => {
  const { base, local, remote } = postmetaPostCreateBatchSnapshots();
  const plan = createPushPlan({ base, local, remote, now: proofNow });
  const releaseSummary = localProductionReleaseSummaryFromPlan(plan);
  const verifiedKeys = releaseSummary.releaseProof.apply.applyRevalidation.verifiedResourceKeys;
  const postmetaIndex = verifiedKeys.indexOf(postmetaResourceKey);
  assert.notEqual(postmetaIndex, -1, 'test setup must include the postmeta target in apply revalidation');
  verifiedKeys[postmetaIndex] = 'row:["wp_posts","ID:79999"]';

  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: postmetaPostGraphShape },
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });

  assert.equal(evidence.ok, false);
  assert.equal(evidence.invariants.applyRevalidationCoveredEveryMutation, true);
  assert.equal(evidence.verifier.postmetaPostGraph.applyRevalidated, false);
  assert.equal(evidence.invariants.postmetaPostGraphApplyRevalidated, false);
});

function postmetaPostCreateBatchSnapshots() {
  const base = minimalSnapshot('source');
  const local = minimalSnapshot('local-edited');
  const remote = minimalSnapshot('remote-changed');

  local.db.wp_posts['ID:71701'] = {
    ID: 71701,
    post_title: 'Reprint Push Postmeta Post Graph Target',
    post_name: 'reprint-push-postmeta-post-graph',
    post_content: 'Local post target used for postmeta post_id graph proof.',
    post_status: 'publish',
    post_type: 'post',
    post_parent: 0,
    post_author: 0,
  };
  local.db.wp_postmeta['post_id:71701:meta_key:reprint_push_postmeta_post_fixture'] = {
    post_id: 71701,
    meta_key: 'reprint_push_postmeta_post_fixture',
    meta_value: 'local-postmeta-post-reference',
  };

  return { base, local, remote };
}

function minimalSnapshot(fixture) {
  return {
    meta: {
      fixture,
      site_url: `http://127.0.0.1/${fixture}`,
    },
    files: {},
    plugins: {},
    db: {
      wp_posts: {},
      wp_postmeta: {},
    },
  };
}

function localProductionReleaseSummaryFromPlan(plan) {
  const pluginDriverMutation = {
    id: 'mutation-release-state',
    resourceKey: releaseStateResourceKey,
    action: 'update',
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
    baseHash: 'b'.repeat(64),
    remoteBeforeHash: 'b'.repeat(64),
    localHash: 'c'.repeat(64),
  };
  const mutationList = [
    pluginDriverMutation,
    mutationFor(plan, postResourceKey),
    mutationFor(plan, postmetaResourceKey),
  ];
  const preconditions = [
    {
      mutationId: pluginDriverMutation.id,
      resourceKey: pluginDriverMutation.resourceKey,
      checkedAgainst: 'live-remote',
      expectedHash: pluginDriverMutation.baseHash,
    },
    ...plan.preconditions.filter((precondition) =>
      precondition.resourceKey === postResourceKey || precondition.resourceKey === postmetaResourceKey),
  ];

  return {
    ok: true,
    releaseMovement: {
      allowed: true,
      gates: 'candidate-for-review',
      reason: 'checked live source/local/changed topology passed without packaged fallback',
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
          verifiedCount: mutationList.length,
          phase: 'before-first-mutation',
          checkedAgainst: 'live-remote',
          verifiedResourceKeys: mutationList.map((mutation) => mutation.resourceKey),
        },
      },
      after: {
        status: 200,
        finalMatchesLocal: true,
      },
      planObject: {
        mutations: mutationList,
        preconditions,
      },
    },
    durableJournal: {
      rows: mutationList.length + 10,
      rowCount: mutationList.length + 10,
      readbackPages: 2,
      paginationComplete: true,
      paginationTruncated: false,
      oldestSequence: 1,
      newestSequence: mutationList.length + 10,
      mutationApplied: mutationList.length,
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

function mutationFor(plan, resourceKey) {
  const mutation = plan.mutations.find((entry) => entry.resourceKey === resourceKey);
  assert.ok(mutation, `Missing mutation ${resourceKey}`);
  return mutation;
}

function assertEveryMutationHasLiveRemotePrecondition(plan) {
  for (const mutation of plan.mutations) {
    assert.ok(
      plan.preconditions.some((precondition) =>
        precondition.mutationId === mutation.id
        && precondition.resourceKey === mutation.resourceKey
        && precondition.checkedAgainst === 'live-remote'
        && /^[a-f0-9]{64}$/.test(precondition.expectedHash)),
      `Missing live precondition for ${mutation.resourceKey}`,
    );
  }
}
