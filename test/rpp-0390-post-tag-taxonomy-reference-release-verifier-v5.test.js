import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildComplexSiteReleaseEvidence } from '../scripts/playground/local-production-complex-site-proof.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(
  repoRoot,
  'docs/evidence/rpp-0390-post-tag-taxonomy-reference-release-verifier-v5.md',
);
const checklistPath = path.join(repoRoot, 'docs/reprint-push-completion-checklist.md');

const postTagShape = Object.freeze({ postTagTaxonomyGraph: true });
const releaseStateResourceKey = 'row:["wp_reprint_push_release_state","state_id:1"]';
const postTagTaxonomyResourceKey = 'row:["wp_term_taxonomy","term_taxonomy_id:72941"]';
const postTagTermResourceKey = 'row:["wp_terms","term_id:72931"]';
const postTagRelationshipResourceKey = 'row:["wp_term_relationships","object_id:71002|term_taxonomy_id:72941"]';
const hashPattern = /^[a-f0-9]{64}$/;

function releaseEvidence(options = {}) {
  return buildComplexSiteReleaseEvidence({
    plannerProof: { ok: true, shape: postTagShape },
    verifyOutput: JSON.stringify(syntheticReleaseSummary(options), null, 2),
    verifyStatus: 0,
    verifySignal: null,
  });
}

test('RPP-0390 release verifier carries the post_tag taxonomy reference through apply', () => {
  const evidence = releaseEvidence();

  assert.equal(evidence.ok, true);
  assert.equal(evidence.verifier.status, 0);
  assert.match(evidence.verifier.receipt.hash, hashPattern);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.required, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.resourceKey, postTagTaxonomyResourceKey);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.termResourceKey, postTagTermResourceKey);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.relationshipResourceKey, postTagRelationshipResourceKey);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.taxonomyMutationPlanned, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.taxonomyMutationIsPostTag, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.termTaxonomyId, 72941);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.termId, 72931);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.taxonomy, 'post_tag');
  assert.equal(evidence.verifier.postTagTaxonomyGraph.preconditionLive, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.applyRevalidated, true);
  assert.equal(evidence.verifier.postTagTaxonomyGraph.finalMatchesLocal, true);
  assert.equal(evidence.invariants.postTagTaxonomyGraphCarriedInReleasePlan, true);
  assert.equal(evidence.invariants.postTagTaxonomyGraphHasReleasePrecondition, true);
  assert.equal(evidence.invariants.postTagTaxonomyGraphApplyRevalidated, true);
  assert.equal(evidence.invariants.postTagTaxonomyGraphFinalMatchesLocal, true);
});

test('RPP-0390 release verifier fails closed when post_tag release evidence is weakened', () => {
  const wrongTaxonomy = releaseEvidence({ plannedTaxonomy: 'product_cat' });
  assert.equal(wrongTaxonomy.ok, false);
  assert.equal(wrongTaxonomy.verifier.postTagTaxonomyGraph.taxonomyMutationIsPostTag, false);
  assert.equal(wrongTaxonomy.invariants.postTagTaxonomyGraphCarriedInReleasePlan, false);

  const mismatchedPrecondition = releaseEvidence({ postTagExpectedHash: '0'.repeat(64) });
  assert.equal(mismatchedPrecondition.ok, false);
  assert.equal(mismatchedPrecondition.verifier.postTagTaxonomyGraph.preconditionLive, true);
  assert.equal(mismatchedPrecondition.invariants.postTagTaxonomyGraphHasReleasePrecondition, false);

  const omittedApplyRevalidation = releaseEvidence({ revalidatePostTagTaxonomy: false });
  assert.equal(omittedApplyRevalidation.ok, false);
  assert.equal(omittedApplyRevalidation.verifier.postTagTaxonomyGraph.applyRevalidated, false);
  assert.equal(omittedApplyRevalidation.invariants.postTagTaxonomyGraphApplyRevalidated, false);
});

test('RPP-0390 evidence docs state remaining unmapped WordPress surfaces', () => {
  const evidenceDoc = fs.readFileSync(evidencePath, 'utf8');
  const checklist = fs.readFileSync(checklistPath, 'utf8');

  assert.match(evidenceDoc, /^# RPP-0390 post_tag taxonomy reference release verifier v5 evidence$/m);
  assert.match(evidenceDoc, /## Current unmapped WordPress surfaces/);
  assert.match(evidenceDoc, /`post_tag` is covered by the release-verifier carry-through proof/);
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
  assert.match(
    checklist,
    /^- \[x\] RPP-0390 \(Mid \/ graph-identity\) Carry through the release verifier for post_tag taxonomy reference, variant 5\. Success: docs state remaining unmapped WordPress surfaces\.$/m,
  );
});

function syntheticReleaseSummary({
  plannedTaxonomy = 'post_tag',
  postTagExpectedHash = 'e'.repeat(64),
  revalidatePostTagTaxonomy = true,
} = {}) {
  const mutations = [
    releaseStateMutation(),
    postTagTaxonomyMutation({ plannedTaxonomy }),
  ];
  const verifiedResourceKeys = mutations
    .map((mutation) => mutation.resourceKey)
    .filter((resourceKey) => revalidatePostTagTaxonomy || resourceKey !== postTagTaxonomyResourceKey);

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
          verifiedCount: mutations.length,
          phase: 'before-first-mutation',
          checkedAgainst: 'live-remote',
          verifiedResourceKeys,
        },
      },
      after: {
        status: 200,
        finalMatchesLocal: true,
      },
      planObject: {
        mutations,
        preconditions: [
          preconditionFor(mutations[0]),
          preconditionFor(mutations[1], { expectedHash: postTagExpectedHash }),
        ],
      },
    },
    durableJournal: {
      rows: 12,
      rowCount: 12,
      readbackPages: 1,
      paginationComplete: true,
      paginationTruncated: false,
      oldestSequence: 1,
      newestSequence: 12,
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

function releaseStateMutation() {
  return {
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
}

function postTagTaxonomyMutation({ plannedTaxonomy }) {
  return {
    id: 'mutation-post-tag-taxonomy-graph-taxonomy',
    resourceKey: postTagTaxonomyResourceKey,
    action: 'put',
    resource: {
      type: 'row',
      table: 'wp_term_taxonomy',
      id: 'term_taxonomy_id:72941',
      key: postTagTaxonomyResourceKey,
    },
    value: {
      value: {
        term_taxonomy_id: 72941,
        term_id: 72931,
        taxonomy: plannedTaxonomy,
        description: 'Local post_tag taxonomy graph fixture.',
        parent: 0,
        count: 1,
      },
    },
    baseHash: 'e'.repeat(64),
    remoteBeforeHash: 'e'.repeat(64),
    localHash: 'f'.repeat(64),
  };
}

function preconditionFor(mutation, { expectedHash = mutation.baseHash } = {}) {
  return {
    mutationId: mutation.id,
    resourceKey: mutation.resourceKey,
    checkedAgainst: 'live-remote',
    expectedHash,
  };
}
