import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const fixedNow = new Date('2026-05-30T16:35:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const rawFixtures = Object.freeze([
  'rpp-0386-private-stable-parent-comment',
  'rpp-0386-private-stable-child-comment',
  'rpp-0386-private-mapped-parent-comment',
  'rpp-0386-private-mapped-child-comment',
]);

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
    },
    plugins: {},
    db: {
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'RPP-0386 base post',
          post_status: 'publish',
        },
      },
      wp_comments: {},
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function planFor(base, local, remote) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey);
}

function releaseSummaryFor(plan, appliedSite) {
  const receiptHash = digest({
    rpp: 'RPP-0386',
    planHash: digest(plan),
    mutationKeys: plan.mutations.map((mutation) => mutation.resourceKey),
  });

  return {
    ok: true,
    releaseMovement: {
      allowed: true,
      gates: 'candidate-for-review',
      reason: 'local release-verifier-shaped comment parent carry-through proof',
    },
    boundary: {
      firstRemainingProductionBoundary: null,
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      authSession: { verdict: 'LIVE_RELEASE_BOUNDARY_OK' },
      durableJournal: { verdict: 'LIVE_RELEASE_BOUNDARY_OK' },
      replayAndRetry: { verdict: 'LIVE_RELEASE_BOUNDARY_OK' },
    },
    releaseProof: {
      dryRun: {
        status: 200,
        receiptHash,
      },
      apply: {
        status: 200,
        applyRevalidation: {
          required: 'fresh-live-hashes-before-first-mutation',
          phase: 'before-first-mutation',
          checkedAgainst: 'live-remote',
          planHash: digest(plan),
          receiptHash,
          verifiedCount: plan.mutations.length,
          verifiedResourceKeys: plan.mutations.map((mutation) => mutation.resourceKey),
        },
      },
      after: {
        status: 200,
        finalMatchesLocal: true,
        finalHash: digest(appliedSite),
      },
      planObject: cloneJson(plan),
    },
    durableJournal: {
      mutationApplied: plan.mutations.length,
      applyCommitted: true,
      checkedAccepted: true,
    },
    replayEquivalence: {
      equivalent: true,
      mismatches: [],
    },
  };
}

function stableCommentParentCase() {
  const parentResourceKey = rowResourceKey('wp_comments', 'comment_ID:3861');
  const childResourceKey = rowResourceKey('wp_comments', 'comment_ID:3862');
  const base = baseSite();
  base.db.wp_comments['comment_ID:3861'] = {
    comment_ID: 3861,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 0,
    comment_content: 'rpp-0386-private-stable-parent-comment',
  };
  const local = cloneJson(base);
  const remote = cloneJson(base);
  local.db.wp_comments['comment_ID:3862'] = {
    comment_ID: 3862,
    comment_post_ID: 1,
    comment_parent: 3861,
    user_id: 0,
    comment_content: 'rpp-0386-private-stable-child-comment',
  };

  return {
    base,
    local,
    remote,
    parentResourceKey,
    childResourceKey,
    expectedCommentParent: 3861,
  };
}

function mappedCommentParentCase() {
  const sourceParentResourceKey = rowResourceKey('wp_comments', 'comment_ID:4861');
  const targetParentResourceKey = rowResourceKey('wp_comments', 'comment_ID:5861');
  const childResourceKey = rowResourceKey('wp_comments', 'comment_ID:4862');
  const base = baseSite();
  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.meta = {
    wordpressGraphIdentityMap: {
      rows: [
        { table: 'wp_comments', localId: 'comment_ID:4861', remoteId: 'comment_ID:5861' },
      ],
    },
  };
  local.db.wp_comments['comment_ID:4861'] = {
    comment_ID: 4861,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 0,
    comment_content: 'rpp-0386-private-mapped-parent-comment',
  };
  remote.db.wp_comments['comment_ID:5861'] = {
    comment_ID: 5861,
    comment_post_ID: 1,
    comment_parent: 0,
    user_id: 0,
    comment_content: 'rpp-0386-private-mapped-parent-comment',
  };
  local.db.wp_comments['comment_ID:4862'] = {
    comment_ID: 4862,
    comment_post_ID: 1,
    comment_parent: 4861,
    user_id: 0,
    comment_content: 'rpp-0386-private-mapped-child-comment',
  };

  return {
    base,
    local,
    remote,
    sourceParentResourceKey,
    targetParentResourceKey,
    childResourceKey,
    expectedCommentParent: 5861,
  };
}

function summarizeCommentParentThreadReleaseEvidence({
  releaseSummary,
  childResourceKey,
  expectedCommentParent,
  parentResourceKey,
  sourceParentResourceKey = parentResourceKey,
  mode,
}) {
  const releaseProof = releaseSummary?.releaseProof || {};
  const plan = releaseProof.planObject || {};
  const mutations = Array.isArray(plan.mutations) ? plan.mutations : [];
  const preconditions = Array.isArray(plan.preconditions) ? plan.preconditions : [];
  const mutation = mutations.find((entry) => entry?.resourceKey === childResourceKey) || null;
  const precondition = preconditions.find((entry) => entry?.resourceKey === childResourceKey) || null;
  const applyRevalidation = releaseProof.apply?.applyRevalidation || {};
  const verifiedResourceKeys = Array.isArray(applyRevalidation.verifiedResourceKeys)
    ? applyRevalidation.verifiedResourceKeys
    : [];
  const plannedComment = mutation ? deserializeResourceValue(mutation.value) : null;
  const plannedCommentParent = Number(plannedComment?.comment_parent);
  const rewrites = Array.isArray(mutation?.wordpressGraphIdentity?.rewrites)
    ? mutation.wordpressGraphIdentity.rewrites
    : [];
  const parentRewrite = rewrites.find((rewrite) =>
    rewrite?.relationshipType === 'comment-parent') || null;
  const preconditionLive = precondition?.checkedAgainst === 'live-remote'
    && typeof precondition?.expectedHash === 'string'
    && sha256Pattern.test(precondition.expectedHash)
    && precondition.expectedHash === mutation?.remoteBeforeHash;
  const applyRevalidated = applyRevalidation.phase === 'before-first-mutation'
    && applyRevalidation.checkedAgainst === 'live-remote'
    && verifiedResourceKeys.includes(childResourceKey);
  const stableIdentityProven = mode === 'stable'
    && !parentRewrite
    && plannedCommentParent === expectedCommentParent;
  const identityRewritten = mode === 'rewrite'
    && plannedCommentParent === expectedCommentParent
    && parentRewrite?.relationshipKey === 'wp_comments.comment_parent'
    && parentRewrite?.sourceTargetResourceKey === sourceParentResourceKey
    && parentRewrite?.targetResourceKey === parentResourceKey;
  const mapperRewritesOrStableIdentity = stableIdentityProven || identityRewritten;

  const base = {
    rpp: 'RPP-0386',
    evidenceSource: 'release-verifier-comment-parent-thread-reference-v5',
    status: 'support_only',
    productionBacked: false,
    releaseGate: 'NO-GO',
    verdict: mapperRewritesOrStableIdentity
      ? 'COMMENT_PARENT_THREAD_REFERENCE_CARRIED_SUPPORT_ONLY'
      : 'COMMENT_PARENT_THREAD_REFERENCE_NOT_CARRIED',
    releaseVerifier: {
      checkedBy: 'scripts/playground/production-shaped-release-verify.mjs',
      outputPath: 'releaseProof.planObject.mutations[]',
      applyRevalidationPath: 'releaseProof.apply.applyRevalidation.verifiedResourceKeys',
      variant: 'v5',
    },
    plan: {
      status: plan.status || null,
      mutations: mutations.length,
      preconditions: preconditions.length,
      blockers: plan.summary?.blockers ?? null,
      hash: `sha256:${digest(plan)}`,
    },
    target: {
      relationshipKey: 'wp_comments.comment_parent',
      relationshipType: 'comment-parent',
      childResourceKey,
      parentResourceKey,
      sourceParentResourceKey,
      expectedCommentParent,
      plannedCommentParent: Number.isFinite(plannedCommentParent) ? plannedCommentParent : null,
      stableIdentityProven,
      identityRewritten,
      rewrite: parentRewrite ? {
        relationshipKey: parentRewrite.relationshipKey || null,
        relationshipType: parentRewrite.relationshipType || null,
        sourceResourceKey: parentRewrite.sourceResourceKey || null,
        sourceTargetResourceKey: parentRewrite.sourceTargetResourceKey || null,
        targetResourceKey: parentRewrite.targetResourceKey || null,
        identityMapSource: parentRewrite.identityMapSource || null,
      } : null,
    },
    mutation: mutation ? {
      id: mutation.id,
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      changeKind: mutation.changeKind,
      table: mutation.resource?.table || null,
      rowId: mutation.resource?.id || null,
      baseHash: mutation.baseHash,
      remoteBeforeHash: mutation.remoteBeforeHash,
      localHash: mutation.localHash,
      mutationHash: `sha256:${digest({
        resourceKey: mutation.resourceKey,
        action: mutation.action,
        changeKind: mutation.changeKind,
        plannedCommentParent,
        rewrites,
        baseHash: mutation.baseHash,
        remoteBeforeHash: mutation.remoteBeforeHash,
        localHash: mutation.localHash,
      })}`,
    } : null,
    precondition: precondition ? {
      mutationId: precondition.mutationId,
      resourceKey: precondition.resourceKey,
      checkedAgainst: precondition.checkedAgainst || null,
      expectedHash: precondition.expectedHash || null,
      matchesMutationRemoteBefore: precondition.expectedHash === mutation?.remoteBeforeHash,
      liveRemote: preconditionLive,
    } : null,
    applyRevalidation: {
      required: applyRevalidation.required || null,
      phase: applyRevalidation.phase || null,
      checkedAgainst: applyRevalidation.checkedAgainst || null,
      planHash: applyRevalidation.planHash || null,
      receiptHash: applyRevalidation.receiptHash || null,
      verifiedCount: applyRevalidation.verifiedCount ?? null,
      childVerified: verifiedResourceKeys.includes(childResourceKey),
      allMutationsVerified: Number.isInteger(applyRevalidation.verifiedCount)
        && applyRevalidation.verifiedCount === mutations.length,
    },
    carryThrough: {
      releaseSummaryOk: releaseSummary?.ok === true,
      planReady: plan.status === 'ready',
      noBlockers: plan.summary?.blockers === 0,
      commentParentCarriesExpectedTarget: plannedCommentParent === expectedCommentParent,
      mapperRewritesOrStableIdentity,
      liveRemotePrecondition: preconditionLive,
      applyRevalidated,
      finalMatchesLocal: releaseProof.after?.finalMatchesLocal === true,
    },
    rawValuesIncluded: false,
  };

  return {
    ...base,
    ok: Object.values(base.carryThrough).every(Boolean),
    proofHash: `sha256:${digest(base)}`,
  };
}

function assertNoRawFixtures(evidence, label) {
  const serialized = JSON.stringify(evidence);
  for (const raw of rawFixtures) {
    assert.equal(serialized.includes(raw), false, `${label} leaked raw fixture ${raw}`);
  }
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label }));
}

function assertReleaseEvidenceOk(evidence, { mode, expectedCommentParent }) {
  assert.equal(evidence.rpp, 'RPP-0386');
  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.verdict, 'COMMENT_PARENT_THREAD_REFERENCE_CARRIED_SUPPORT_ONLY');
  assert.equal(evidence.ok, true);
  assert.equal(evidence.releaseVerifier.variant, 'v5');
  assert.equal(evidence.releaseVerifier.checkedBy, 'scripts/playground/production-shaped-release-verify.mjs');
  assert.equal(evidence.plan.status, 'ready');
  assert.equal(evidence.plan.blockers, 0);
  assert.match(evidence.plan.hash, sha256EvidencePattern);
  assert.equal(evidence.target.relationshipKey, 'wp_comments.comment_parent');
  assert.equal(evidence.target.relationshipType, 'comment-parent');
  assert.equal(evidence.target.plannedCommentParent, expectedCommentParent);
  assert.equal(evidence.target.stableIdentityProven, mode === 'stable');
  assert.equal(evidence.target.identityRewritten, mode === 'rewrite');
  assert.equal(evidence.carryThrough.mapperRewritesOrStableIdentity, true);
  assert.equal(evidence.carryThrough.liveRemotePrecondition, true);
  assert.equal(evidence.carryThrough.applyRevalidated, true);
  assert.equal(evidence.carryThrough.finalMatchesLocal, true);
  assert.equal(evidence.precondition.liveRemote, true);
  assert.equal(evidence.precondition.matchesMutationRemoteBefore, true);
  assert.match(evidence.precondition.expectedHash, sha256Pattern);
  assert.equal(evidence.applyRevalidation.required, 'fresh-live-hashes-before-first-mutation');
  assert.equal(evidence.applyRevalidation.phase, 'before-first-mutation');
  assert.equal(evidence.applyRevalidation.checkedAgainst, 'live-remote');
  assert.equal(evidence.applyRevalidation.childVerified, true);
  assert.equal(evidence.applyRevalidation.allMutationsVerified, true);
  assert.match(evidence.applyRevalidation.planHash, sha256Pattern);
  assert.match(evidence.applyRevalidation.receiptHash, sha256Pattern);
  assert.match(evidence.mutation.baseHash, sha256Pattern);
  assert.match(evidence.mutation.remoteBeforeHash, sha256Pattern);
  assert.match(evidence.mutation.localHash, sha256Pattern);
  assert.match(evidence.mutation.mutationHash, sha256EvidencePattern);
  assert.match(evidence.proofHash, sha256EvidencePattern);
  assertNoRawFixtures(evidence, `RPP-0386 ${mode} release verifier evidence`);
}

test('RPP-0386 release verifier carries stable comment_parent identity through apply revalidation', () => {
  const {
    base,
    local,
    remote,
    parentResourceKey,
    childResourceKey,
    expectedCommentParent,
  } = stableCommentParentCase();

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);
  const childMutation = mutationFor(plan, childResourceKey);
  const childValue = deserializeResourceValue(childMutation.value);
  const evidence = summarizeCommentParentThreadReleaseEvidence({
    releaseSummary: releaseSummaryFor(plan, result.site),
    childResourceKey,
    expectedCommentParent,
    parentResourceKey,
    mode: 'stable',
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.summary.mutations, 1);
  assert.equal(decisionFor(plan, parentResourceKey), undefined);
  assert.equal(childMutation.changeKind, 'create');
  assert.equal(childMutation.wordpressGraphIdentity?.rewrites?.length || 0, 0);
  assert.equal(preconditionFor(plan, childResourceKey).checkedAgainst, 'live-remote');
  assert.equal(childValue.comment_parent, expectedCommentParent);
  assert.equal(result.site.db.wp_comments['comment_ID:3861'].comment_content, 'rpp-0386-private-stable-parent-comment');
  assert.equal(result.site.db.wp_comments['comment_ID:3862'].comment_parent, expectedCommentParent);
  assertReleaseEvidenceOk(evidence, { mode: 'stable', expectedCommentParent });
});

test('RPP-0386 release verifier carries rewritten comment_parent identity-map evidence', () => {
  const {
    base,
    local,
    remote,
    sourceParentResourceKey,
    targetParentResourceKey,
    childResourceKey,
    expectedCommentParent,
  } = mappedCommentParentCase();

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);
  const childMutation = mutationFor(plan, childResourceKey);
  const childValue = deserializeResourceValue(childMutation.value);
  const parentRewrite = childMutation.wordpressGraphIdentity.rewrites.find((rewrite) =>
    rewrite.relationshipType === 'comment-parent');
  const evidence = summarizeCommentParentThreadReleaseEvidence({
    releaseSummary: releaseSummaryFor(plan, result.site),
    childResourceKey,
    expectedCommentParent,
    parentResourceKey: targetParentResourceKey,
    sourceParentResourceKey,
    mode: 'rewrite',
  });

  assert.equal(plan.status, 'ready');
  assert.equal(mutationFor(plan, sourceParentResourceKey), undefined);
  assert.equal(decisionFor(plan, sourceParentResourceKey).decision, 'map-local-identity-to-remote');
  assert.equal(decisionFor(plan, targetParentResourceKey).decision, 'keep-remote');
  assert.equal(childMutation.changeKind, 'create');
  assert.equal(childValue.comment_parent, expectedCommentParent);
  assert.ok(parentRewrite, 'missing comment_parent identity rewrite evidence');
  assert.equal(parentRewrite.relationshipKey, 'wp_comments.comment_parent');
  assert.equal(parentRewrite.sourceTargetResourceKey, sourceParentResourceKey);
  assert.equal(parentRewrite.targetResourceKey, targetParentResourceKey);
  assert.equal(result.site.db.wp_comments['comment_ID:4861'], undefined);
  assert.equal(result.site.db.wp_comments['comment_ID:5861'].comment_content, 'rpp-0386-private-mapped-parent-comment');
  assert.equal(result.site.db.wp_comments['comment_ID:4862'].comment_parent, expectedCommentParent);
  assertReleaseEvidenceOk(evidence, { mode: 'rewrite', expectedCommentParent });
  assert.equal(evidence.target.rewrite.relationshipType, 'comment-parent');
  assert.equal(evidence.target.rewrite.sourceTargetResourceKey, sourceParentResourceKey);
  assert.equal(evidence.target.rewrite.targetResourceKey, targetParentResourceKey);
});

test('RPP-0386 release evidence fails closed if the carried comment_parent changes', () => {
  const {
    base,
    local,
    remote,
    sourceParentResourceKey,
    targetParentResourceKey,
    childResourceKey,
    expectedCommentParent,
  } = mappedCommentParentCase();

  const plan = planFor(base, local, remote);
  const result = applyPlan(remote, plan);
  const releaseSummary = releaseSummaryFor(plan, result.site);
  const childMutation = releaseSummary.releaseProof.planObject.mutations.find((mutation) =>
    mutation.resourceKey === childResourceKey);
  childMutation.value.value.comment_parent = 999999;

  const evidence = summarizeCommentParentThreadReleaseEvidence({
    releaseSummary,
    childResourceKey,
    expectedCommentParent,
    parentResourceKey: targetParentResourceKey,
    sourceParentResourceKey,
    mode: 'rewrite',
  });

  assert.equal(evidence.ok, false);
  assert.equal(evidence.verdict, 'COMMENT_PARENT_THREAD_REFERENCE_NOT_CARRIED');
  assert.equal(evidence.target.plannedCommentParent, 999999);
  assert.equal(evidence.target.identityRewritten, false);
  assert.equal(evidence.carryThrough.commentParentCarriesExpectedTarget, false);
  assert.equal(evidence.carryThrough.mapperRewritesOrStableIdentity, false);
  assert.equal(evidence.carryThrough.liveRemotePrecondition, true);
  assert.equal(evidence.carryThrough.applyRevalidated, true);
  assertNoRawFixtures(evidence, 'RPP-0386 failed release verifier evidence');
});

test('RPP-0386 production-shaped verifier emits the plan and apply-revalidation surfaces used by this proof', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');

  assert.match(verifierSource, /releaseProof:\s*proof/);
  assert.match(verifierSource, /proof\.apply\.applyRevalidation\?\.verifiedResourceKeys/);
  assert.match(
    verifierSource,
    /proof\.planObject\.mutations\.map\(\(mutation\) => mutation\.resourceKey\)/,
  );
});
