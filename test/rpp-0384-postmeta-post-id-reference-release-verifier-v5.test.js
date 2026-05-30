import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComplexSitePlannerProof,
  buildComplexSiteReleaseEvidence,
} from '../scripts/playground/local-production-complex-site-proof.js';

const postmetaPostId = 71701;
const postmetaMetaKey = 'reprint_push_postmeta_post_fixture';
const postResourceKey = `row:["wp_posts","ID:${postmetaPostId}"]`;
const postmetaResourceKey = `row:["wp_postmeta","post_id:${postmetaPostId}:meta_key:${postmetaMetaKey}"]`;
const releaseStateResourceKey = 'row:["wp_reprint_push_release_state","state_id:1"]';
const rawPostmetaPayload = 'local-private-postmeta-post-reference-rpp-0384';
const rawPostTitle = 'RPP-0384 Local Post Target Private';

const smallShape = Object.freeze({
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

test('RPP-0384 local production planner records the postmeta post_id graph target', () => {
  const proof = buildComplexSitePlannerProof({
    sourceSnapshot: syntheticComplexSnapshot('source'),
    localEditedSnapshot: syntheticComplexSnapshot('local-edited'),
    remoteChangedSnapshot: syntheticComplexSnapshot('remote-changed'),
    brewcommerceBlueprintDir: '/tmp/wp-blueprints-brewcommerce/blueprints/brewcommerce',
    shape: smallShape,
  });

  assert.equal(proof.ok, true);
  assert.equal(proof.counts.source.postmetaPostGraphPosts, 0);
  assert.equal(proof.counts.source.postmetaPostGraphMeta, 0);
  assert.equal(proof.counts.localEdited.postmetaPostGraphPosts, 1);
  assert.equal(proof.counts.localEdited.postmetaPostGraphMeta, 1);
  assert.equal(proof.postmetaPostGraphEvidence.type, 'postmeta-post-id');
  assert.equal(proof.postmetaPostGraphEvidence.postResourceKey, postResourceKey);
  assert.equal(proof.postmetaPostGraphEvidence.postmetaResourceKey, postmetaResourceKey);
  assert.equal(proof.postmetaPostGraphEvidence.allResourcesPlanned, true);
  assert.equal(proof.postmetaPostGraphEvidence.postmetaReferencesPost, true);
  assert.equal(proof.postmetaPostGraphEvidence.staleGraphBlockers, 0);
  assert.equal(proof.invariants.postmetaPostGraphCountsPresent, true);
  assert.equal(proof.invariants.postmetaPostGraphPlanned, true);
  assert.equal(proof.invariants.postmetaPostGraphHasLivePreconditions, true);
  assert.equal(proof.invariants.postmetaPostGraphNoStaleBlocker, true);
});

test('RPP-0384 release evidence carries the postmeta post_id target through apply', () => {
  const releaseSummary = syntheticReleaseSummary();
  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: smallShape },
    verifyOutput: JSON.stringify(releaseSummary, null, 2),
    verifyStatus: 0,
    verifySignal: null,
  });
  const evidenceJson = JSON.stringify(evidence);

  assert.equal(evidence.ok, true);
  assert.equal(evidence.verifier.postmetaPostGraph.required, true);
  assert.equal(evidence.verifier.postmetaPostGraph.postResourceKey, postResourceKey);
  assert.equal(evidence.verifier.postmetaPostGraph.postmetaResourceKey, postmetaResourceKey);
  assert.equal(evidence.verifier.postmetaPostGraph.postMutationPlanned, true);
  assert.equal(evidence.verifier.postmetaPostGraph.postmetaMutationPlanned, true);
  assert.equal(evidence.verifier.postmetaPostGraph.postId, postmetaPostId);
  assert.equal(evidence.verifier.postmetaPostGraph.metaKey, postmetaMetaKey);
  assert.equal(evidence.verifier.postmetaPostGraph.postmetaReferencesPost, true);
  assert.equal(evidence.verifier.postmetaPostGraph.preconditionLive, true);
  assert.equal(evidence.verifier.postmetaPostGraph.applyRevalidated, true);
  assert.equal(evidence.verifier.postmetaPostGraph.finalMatchesLocal, true);
  assert.equal(evidence.invariants.postmetaPostGraphCarriedInReleasePlan, true);
  assert.equal(evidence.invariants.postmetaPostGraphHasReleasePrecondition, true);
  assert.equal(evidence.invariants.postmetaPostGraphApplyRevalidated, true);
  assert.equal(evidence.invariants.postmetaPostGraphFinalMatchesLocal, true);
  assert.equal(evidenceJson.includes(rawPostmetaPayload), false);
  assert.equal(evidenceJson.includes(rawPostTitle), false);
});

test('RPP-0384 release evidence fails closed when apply revalidation omits the postmeta row', () => {
  const releaseSummary = syntheticReleaseSummary();
  const verifiedResourceKeys = releaseSummary.releaseProof.apply.applyRevalidation.verifiedResourceKeys
    .filter((resourceKey) => resourceKey !== postmetaResourceKey);
  releaseSummary.releaseProof.apply.applyRevalidation.verifiedResourceKeys = verifiedResourceKeys;
  releaseSummary.releaseProof.apply.applyRevalidation.verifiedCount = verifiedResourceKeys.length;

  const evidence = buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: smallShape },
    verifyOutput: JSON.stringify(releaseSummary),
    verifyStatus: 0,
    verifySignal: null,
  });

  assert.equal(evidence.ok, false);
  assert.equal(evidence.verifier.postmetaPostGraph.applyRevalidated, false);
  assert.equal(evidence.invariants.applyRevalidationCoveredEveryMutation, false);
  assert.equal(evidence.invariants.postmetaPostGraphApplyRevalidated, false);
});

function syntheticComplexSnapshot(variant) {
  const snapshot = {
    meta: {
      fixture: `synthetic-${variant}`,
      site_url: `local-${variant}`,
      pluginOwnedResources: {
        allowedResources: [
          {
            resourceKey: 'row:["wp_options","option_name:reprint_push_forms_fixture"]',
            pluginOwner: 'forms',
            driver: 'wp-option',
          },
          {
            resourceKey: releaseStateResourceKey,
            pluginOwner: 'reprint-push',
            driver: 'reprint-push-release-state',
            table: 'wp_reprint_push_release_state',
            supportsDelete: false,
          },
        ],
      },
    },
    files: {},
    plugins: {},
    db: {
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
    },
  };
  const local = variant === 'local-edited';
  const remote = variant === 'remote-changed';

  for (let index = 1; index <= smallShape.postCount; index += 1) {
    const id = 71000 + index;
    const drift = remote && index <= smallShape.remoteDriftPosts;
    const marker = local ? 'local-edit' : drift ? 'remote-drift' : 'base';
    snapshot.db.wp_posts[`ID:${id}`] = {
      ID: id,
      post_title: `Brewcommerce Complex Item ${index} ${marker}`,
      post_name: `brewcommerce-complex-${String(index).padStart(2, '0')}`,
      post_content: `Complex content ${index} ${marker}`,
      post_status: 'publish',
      post_type: index % 3 === 0 ? 'product' : 'post',
      post_parent: 0,
      post_author: 0,
    };
    if (index <= smallShape.schemaMetaCount) {
      snapshot.db.wp_postmeta[`post_id:${id}:meta_key:_reprint_push_forms_schema`] = {
        post_id: id,
        meta_key: '_reprint_push_forms_schema',
        meta_value: {
          owner: 'forms',
          form: `complex-checkout-${String(index).padStart(2, '0')}`,
          marker,
        },
        __pluginOwner: 'forms',
      };
      snapshot.meta.pluginOwnedResources.allowedResources.push({
        resourceKey: `row:["wp_postmeta","post_id:${id}:meta_key:_reprint_push_forms_schema"]`,
        pluginOwner: 'forms',
        driver: 'wp-postmeta',
      });
    }
  }

  if (local) {
    snapshot.db.wp_posts[`ID:${postmetaPostId}`] = {
      ID: postmetaPostId,
      post_title: rawPostTitle,
      post_name: 'reprint-push-postmeta-post-graph',
      post_content: 'Local post target used for postmeta post_id graph proof.',
      post_status: 'publish',
      post_type: 'post',
      post_parent: 0,
      post_author: 0,
    };
    snapshot.db.wp_postmeta[`post_id:${postmetaPostId}:meta_key:${postmetaMetaKey}`] = {
      post_id: postmetaPostId,
      meta_key: postmetaMetaKey,
      meta_value: rawPostmetaPayload,
    };
  }

  for (let index = 1; index <= smallShape.fileCount; index += 1) {
    const drift = remote && index <= smallShape.remoteDriftFiles;
    const marker = local ? 'local-edit' : drift ? 'remote-drift' : 'base';
    snapshot.files[`wp-content/uploads/reprint-push/brewcommerce-complex-${String(index).padStart(2, '0')}.json`] =
      JSON.stringify({ marker, index });
  }

  for (let index = 1; index <= smallShape.formsLabRows; index += 1) {
    snapshot.db.wp_reprint_push_forms_lab[`id:${index}`] = {
      id: index,
      form_slug: `complex-checkout-${index}`,
      payload: { owner: 'forms', mode: 'production', version: '1' },
      updated_marker: 'production',
      __pluginOwner: 'forms',
    };
  }

  const optionMarker = local ? 'local-edit' : remote ? 'remote-drift' : 'base';
  snapshot.db.wp_options['option_name:reprint_push_forms_fixture'] = {
    option_name: 'reprint_push_forms_fixture',
    option_value: {
      owner: 'forms',
      revision: optionMarker,
      complexSite: true,
    },
    __pluginOwner: 'forms',
  };
  snapshot.db.wp_reprint_push_release_state['state_id:1'] = {
    state_id: 1,
    payload: {
      owner: 'reprint-push',
      mode: local ? 'local-update' : remote ? 'remote-changed' : 'base',
      version: local ? 2 : remote ? 3 : 1,
      releaseBoundaryProof: 'plugin-driver-boundary',
    },
    updated_marker: local ? 'local-update' : remote ? 'remote-changed' : 'base',
    __pluginOwner: 'reprint-push',
  };

  return snapshot;
}

function syntheticReleaseSummary() {
  const mutationList = [
    {
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
    },
    {
      id: 'mutation-postmeta-post-target',
      resourceKey: postResourceKey,
      action: 'put',
      resource: {
        type: 'row',
        table: 'wp_posts',
        id: `ID:${postmetaPostId}`,
        key: postResourceKey,
      },
      value: {
        value: {
          ID: postmetaPostId,
          post_title: rawPostTitle,
          post_name: 'reprint-push-postmeta-post-graph',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      baseHash: 'd'.repeat(64),
      remoteBeforeHash: 'd'.repeat(64),
      localHash: 'e'.repeat(64),
    },
    {
      id: 'mutation-postmeta-post-id-reference',
      resourceKey: postmetaResourceKey,
      action: 'put',
      resource: {
        type: 'row',
        table: 'wp_postmeta',
        id: `post_id:${postmetaPostId}:meta_key:${postmetaMetaKey}`,
        key: postmetaResourceKey,
      },
      value: {
        value: {
          post_id: postmetaPostId,
          meta_key: postmetaMetaKey,
          meta_value: rawPostmetaPayload,
        },
      },
      baseHash: 'f'.repeat(64),
      remoteBeforeHash: 'f'.repeat(64),
      localHash: '1'.repeat(64),
    },
  ];

  return {
    ok: true,
    releaseMovement: {
      allowed: true,
      gates: 'candidate-for-review',
      reason: 'checked live source/local/changed topology carried postmeta post_id evidence',
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
        preconditions: mutationList.map((mutation) => ({
          mutationId: mutation.id,
          resourceKey: mutation.resourceKey,
          checkedAgainst: 'live-remote',
          expectedHash: mutation.baseHash,
        })),
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
