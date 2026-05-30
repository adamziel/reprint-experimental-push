import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = path.join(repoRoot, 'docs/evidence/rpp-0385-comment-post-reference-release-verifier-v5.md');
const fixedNow = new Date('2026-05-30T12:38:50.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const targetPostId = 385;
const commentId = 38501;
const targetPostRowId = `ID:${targetPostId}`;
const commentRowId = `comment_ID:${commentId}`;
const targetPostResourceKey = rowResourceKey('wp_posts', targetPostRowId);
const commentResourceKey = rowResourceKey('wp_comments', commentRowId);
const rawFixtures = Object.freeze([
  'base-private-rpp0385-comment-post-title',
  'base-private-rpp0385-comment-post-body',
  'local-private-rpp0385-comment-post-title',
  'local-private-rpp0385-comment-post-body',
  'local-private-rpp0385-comment-body',
  'remote-private-rpp0385-comment-post-drift',
]);

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowResourceKey(table, id),
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "rpp-0385";',
    },
    plugins: {},
    db: {
      wp_posts: {
        [targetPostRowId]: {
          ID: targetPostId,
          post_title: 'base-private-rpp0385-comment-post-title',
          post_name: 'rpp-0385-comment-post-target',
          post_content: 'base-private-rpp0385-comment-post-body',
          post_status: 'publish',
          post_type: 'post',
          post_parent: 0,
          post_author: 0,
        },
      },
      wp_comments: {},
    },
  };
}

function commentPostReferenceFixture() {
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.db.wp_posts[targetPostRowId] = {
    ...local.db.wp_posts[targetPostRowId],
    post_title: 'local-private-rpp0385-comment-post-title',
    post_content: 'local-private-rpp0385-comment-post-body',
  };
  local.db.wp_comments[commentRowId] = {
    comment_ID: commentId,
    comment_post_ID: targetPostId,
    comment_parent: 0,
    user_id: 0,
    comment_content: 'local-private-rpp0385-comment-body',
    comment_approved: '1',
  };

  return { base, local, remote };
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey) || null;
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function releaseProofForPlan(plan, applied) {
  const verifiedResourceKeys = plan.mutations.map((mutation) => mutation.resourceKey);
  return {
    planObject: plan,
    apply: {
      status: 200,
      applyRevalidation: {
        required: 'fresh-live-hashes-before-first-mutation',
        phase: 'before-first-mutation',
        checkedAgainst: 'live-remote',
        planHash: digest(plan),
        verifiedCount: verifiedResourceKeys.length,
        verifiedResourceKeys,
      },
    },
    after: {
      status: 200,
      finalMatchesLocal: true,
      siteHash: digest(applied.site),
    },
  };
}

function buildStaleReplayEvidence(plan, remote) {
  const staleRemote = cloneJson(remote);
  staleRemote.db.wp_posts[targetPostRowId].post_title = 'remote-private-rpp0385-comment-post-drift';

  const postResource = rowResource('wp_posts', targetPostRowId);
  const rowHashBefore = resourceHash(staleRemote, postResource);
  const remoteHashBefore = digest(staleRemote);
  const error = captureError(() => applyPlan(staleRemote, plan, { mutateRemote: true }));
  const rowHashAfter = resourceHash(staleRemote, postResource);
  const remoteHashAfter = digest(staleRemote);

  assert.ok(error instanceof PushPlanError);
  return {
    preMutation: true,
    code: error.code,
    targetPostHashBefore: rowHashBefore,
    targetPostHashAfter: rowHashAfter,
    targetPostPreserved: rowHashAfter === rowHashBefore,
    remoteHashBefore: sha256Evidence(staleRemote),
    remoteHashAfter: sha256Evidence(staleRemote),
    remoteUnchanged: remoteHashAfter === remoteHashBefore,
    commentCreated: Boolean(staleRemote.db.wp_comments?.[commentRowId]),
  };
}

function summarizeRpp0385CommentPostReleaseVerifierProof({ plan, proof, applied, staleReplay }) {
  const targetPostMutation = mutationFor(plan, targetPostResourceKey);
  const commentMutation = mutationFor(plan, commentResourceKey);
  const targetPostPrecondition = preconditionFor(plan, targetPostResourceKey);
  const commentPrecondition = preconditionFor(plan, commentResourceKey);
  const plannedComment = commentMutation ? deserializeResourceValue(commentMutation.value) : null;
  const verifiedResourceKeys = proof.apply.applyRevalidation.verifiedResourceKeys;
  const appliedComment = applied.site.db.wp_comments[commentRowId] || null;

  return {
    rpp: 'RPP-0385',
    evidenceSource: 'release-verifier-comment-post-reference-v5',
    status: 'support_only',
    verdict: 'COMMENT_POST_REFERENCE_APPLY_REVALIDATED_SUPPORT_ONLY',
    evidenceScope: 'local-release-verifier',
    productionBacked: false,
    releaseGate: {
      status: 'NO-GO',
      verdict: 'REPRINT_PUSH_LIVE_SOURCE_REQUIRED',
      acceptedForReleaseGate: false,
      note: 'comment_post_ID release-verifier carry-through is local/support-only; production-backed release gate evidence is still required',
    },
    rawValuesIncluded: false,
    plan: {
      status: plan.status,
      summary: { ...plan.summary },
      hash: sha256Evidence(plan),
    },
    relationship: {
      relationshipKey: 'wp_comments.comment_post_ID',
      relationshipType: 'comment-post',
      sourceResourceKey: commentResourceKey,
      sourceTable: 'wp_comments',
      sourceRowId: commentRowId,
      targetResourceKey: targetPostResourceKey,
      targetTable: 'wp_posts',
      targetRowId: targetPostRowId,
    },
    targetPostMutation: targetPostMutation ? {
      resourceKey: targetPostMutation.resourceKey,
      action: targetPostMutation.action,
      changeKind: targetPostMutation.changeKind,
      table: targetPostMutation.resource.table,
      rowId: targetPostMutation.resource.id,
      baseHash: targetPostMutation.baseHash,
      remoteBeforeHash: targetPostMutation.remoteBeforeHash,
      localHash: targetPostMutation.localHash,
      mutationHash: sha256Evidence(targetPostMutation),
    } : null,
    commentMutation: commentMutation ? {
      resourceKey: commentMutation.resourceKey,
      action: commentMutation.action,
      changeKind: commentMutation.changeKind,
      table: commentMutation.resource.table,
      rowId: commentMutation.resource.id,
      commentPostId: Number(plannedComment?.comment_post_ID),
      exactCommentPostReference: Number(plannedComment?.comment_post_ID) === targetPostId,
      graphRewriteCount: commentMutation.wordpressGraphIdentity?.rewrites?.length || 0,
      baseHash: commentMutation.baseHash,
      remoteBeforeHash: commentMutation.remoteBeforeHash,
      localHash: commentMutation.localHash,
      mutationHash: sha256Evidence(commentMutation),
    } : null,
    preconditions: {
      targetPost: targetPostPrecondition ? {
        resourceKey: targetPostPrecondition.resourceKey,
        checkedAgainst: targetPostPrecondition.checkedAgainst,
        expectedHash: targetPostPrecondition.expectedHash,
        expectedHashMatchesMutation: targetPostPrecondition.expectedHash === targetPostMutation?.remoteBeforeHash,
      } : null,
      comment: commentPrecondition ? {
        resourceKey: commentPrecondition.resourceKey,
        checkedAgainst: commentPrecondition.checkedAgainst,
        expectedHash: commentPrecondition.expectedHash,
        expectedHashMatchesMutation: commentPrecondition.expectedHash === commentMutation?.remoteBeforeHash,
      } : null,
    },
    applyTimeRevalidation: {
      required: proof.apply.applyRevalidation.required,
      phase: proof.apply.applyRevalidation.phase,
      checkedAgainst: proof.apply.applyRevalidation.checkedAgainst,
      planHash: sha256Evidence(proof.planObject),
      verifiedCount: proof.apply.applyRevalidation.verifiedCount,
      targetPostVerifiedBeforeFirstMutation: verifiedResourceKeys.includes(targetPostResourceKey),
      commentVerifiedBeforeFirstMutation: verifiedResourceKeys.includes(commentResourceKey),
    },
    applyCarryThrough: {
      finalMatchesLocal: proof.after.finalMatchesLocal,
      targetPostApplied: applied.site.db.wp_posts[targetPostRowId]?.post_title === 'local-private-rpp0385-comment-post-title',
      commentApplied: Boolean(appliedComment),
      commentPostId: Number(appliedComment?.comment_post_ID),
      commentReferencesTargetPost: Number(appliedComment?.comment_post_ID) === targetPostId,
    },
    staleReplay,
    proofHash: sha256Evidence({
      planHash: digest(plan),
      relationshipKey: 'wp_comments.comment_post_ID',
      targetPostResourceKey,
      commentResourceKey,
      staleReplay,
    }),
  };
}

function assertHashOnlyReleaseSummary(summary) {
  const serialized = JSON.stringify(summary);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `release summary leaked raw fixture ${raw}`);
  }
  for (const rawField of ['post_title', 'post_content', 'comment_content']) {
    assert.equal(serialized.includes(rawField), false, `release summary exposed raw field ${rawField}`);
  }
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(summary, { label: 'RPP-0385 comment post release verifier proof' }));
}

test('RPP-0385 release verifier carries comment_post_ID through apply revalidation and stale replay', () => {
  const { base, local, remote } = commentPostReferenceFixture();
  const plan = planFor(base, local, remote);
  const applied = applyPlan(cloneJson(remote), plan);
  const proof = releaseProofForPlan(plan, applied);
  const staleReplay = buildStaleReplayEvidence(plan, remote);
  const summary = summarizeRpp0385CommentPostReleaseVerifierProof({
    plan,
    proof,
    applied,
    staleReplay,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 2);
  assert.equal(plan.summary.blockers, 0);
  assert.equal(plan.summary.conflicts, 0);

  assert.equal(summary.rpp, 'RPP-0385');
  assert.equal(summary.status, 'support_only');
  assert.equal(summary.verdict, 'COMMENT_POST_REFERENCE_APPLY_REVALIDATED_SUPPORT_ONLY');
  assert.equal(summary.productionBacked, false);
  assert.equal(summary.releaseGate.status, 'NO-GO');
  assert.equal(summary.releaseGate.acceptedForReleaseGate, false);
  assert.equal(summary.relationship.relationshipKey, 'wp_comments.comment_post_ID');
  assert.equal(summary.relationship.relationshipType, 'comment-post');
  assert.equal(summary.relationship.targetResourceKey, targetPostResourceKey);

  assert.equal(summary.targetPostMutation.changeKind, 'update');
  assert.equal(summary.targetPostMutation.resourceKey, targetPostResourceKey);
  assert.equal(summary.commentMutation.changeKind, 'create');
  assert.equal(summary.commentMutation.resourceKey, commentResourceKey);
  assert.equal(summary.commentMutation.commentPostId, targetPostId);
  assert.equal(summary.commentMutation.exactCommentPostReference, true);
  assert.equal(summary.commentMutation.graphRewriteCount, 0);

  assert.equal(summary.preconditions.targetPost.checkedAgainst, 'live-remote');
  assert.equal(summary.preconditions.targetPost.expectedHashMatchesMutation, true);
  assert.equal(summary.preconditions.comment.checkedAgainst, 'live-remote');
  assert.equal(summary.preconditions.comment.expectedHashMatchesMutation, true);
  assert.match(summary.preconditions.targetPost.expectedHash, sha256Pattern);
  assert.match(summary.preconditions.comment.expectedHash, sha256Pattern);

  assert.equal(summary.applyTimeRevalidation.phase, 'before-first-mutation');
  assert.equal(summary.applyTimeRevalidation.checkedAgainst, 'live-remote');
  assert.equal(summary.applyTimeRevalidation.verifiedCount, 2);
  assert.equal(summary.applyTimeRevalidation.targetPostVerifiedBeforeFirstMutation, true);
  assert.equal(summary.applyTimeRevalidation.commentVerifiedBeforeFirstMutation, true);
  assert.match(summary.applyTimeRevalidation.planHash, sha256EvidencePattern);

  assert.equal(summary.applyCarryThrough.finalMatchesLocal, true);
  assert.equal(summary.applyCarryThrough.targetPostApplied, true);
  assert.equal(summary.applyCarryThrough.commentApplied, true);
  assert.equal(summary.applyCarryThrough.commentPostId, targetPostId);
  assert.equal(summary.applyCarryThrough.commentReferencesTargetPost, true);

  assert.equal(summary.staleReplay.preMutation, true);
  assert.equal(summary.staleReplay.code, 'PRECONDITION_FAILED');
  assert.equal(summary.staleReplay.targetPostPreserved, true);
  assert.equal(summary.staleReplay.remoteUnchanged, true);
  assert.equal(summary.staleReplay.commentCreated, false);
  assert.match(summary.staleReplay.targetPostHashBefore, sha256Pattern);
  assert.equal(summary.staleReplay.targetPostHashAfter, summary.staleReplay.targetPostHashBefore);
  assert.match(summary.proofHash, sha256EvidencePattern);
  assertHashOnlyReleaseSummary(summary);
});

test('RPP-0385 evidence doc states remaining unmapped WordPress surfaces', () => {
  const doc = fs.readFileSync(evidencePath, 'utf8');

  assert.match(doc, /^## Remaining unmapped WordPress surfaces/m);
  for (const phrase of [
    'nav_menu_item',
    'wp_navigation',
    'revision',
    'nav_menu',
    'product_cat',
    'serialized block references',
    'stale-wordpress-graph-identity',
    'hash-only',
  ]) {
    assert.ok(doc.includes(phrase), `evidence doc missing ${phrase}`);
  }
});
