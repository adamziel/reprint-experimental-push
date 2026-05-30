import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import {
  assertEvidenceHasNoRawValues,
  EVIDENCE_REDACTION_MARKER,
  redactEvidence,
} from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const sha256HashPattern = /^sha256:[a-f0-9]{64}$/;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResource(table, id) {
  return {
    type: 'row',
    table,
    id,
    key: rowResourceKey(table, id),
  };
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id);
}

function decisionFor(plan, resourceKey) {
  return plan.decisions.find((decision) => decision.resourceKey === resourceKey);
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function nonReadyTargetCount(coverage) {
  return Object.entries(coverage.statuses)
    .filter(([status]) => status !== 'ready')
    .reduce((sum, [, count]) => sum + count, 0);
}

function variant4Cases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('wp-comments-commentmeta-graph-v4'));
}

function selectVariant4Case(tag) {
  const testCase = variant4Cases().find((entry) => entry.tags.has(tag));
  assert.ok(testCase, `missing generated case with ${tag}`);
  return testCase;
}

function generatedPlanFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function assertVariant4CommentmetaCommentShape(testCase, { staleTarget }) {
  assert.ok(testCase.tags.has('wp-comments-commentmeta-graph'));
  assert.ok(testCase.tags.has('wp-comments-commentmeta-graph-v4'));
  assert.ok(testCase.tags.has('commentmeta-comment-graph'));
  assert.ok(testCase.tags.has('wp-commentmeta-create'));

  const baseCommentmeta = testCase.base.db.wp_commentmeta || {};
  const commentmetaRows = Object.entries(testCase.local.db.wp_commentmeta || {})
    .filter(([id, row]) =>
      !Object.hasOwn(baseCommentmeta, id)
      && row.meta_key.startsWith('_generated_commentmeta_graph_'));

  assert.equal(commentmetaRows.length, 1, `${testCase.id} should create one wp_commentmeta row`);

  const [commentmetaRowId, commentmetaRow] = commentmetaRows[0];
  const commentId = Number(commentmetaRow.comment_id);
  const commentRowId = `comment_ID:${commentId}`;
  const localComment = testCase.local.db.wp_comments?.[commentRowId];
  const baseComment = testCase.base.db.wp_comments?.[commentRowId];
  const remoteComment = testCase.remote.db.wp_comments?.[commentRowId];

  assert.ok(Number.isSafeInteger(commentId), `${testCase.id} should carry numeric comment_id identity`);
  assert.ok(localComment, `${testCase.id} should include the local wp_comments target`);
  assert.equal(localComment.comment_ID, commentId);
  assert.equal(commentmetaRow.comment_id, commentId);

  if (staleTarget) {
    assert.ok(baseComment, `${testCase.id} stale target should exist in base`);
    assert.ok(remoteComment, `${testCase.id} stale target should exist remotely`);
    assert.deepEqual(localComment, baseComment, `${testCase.id} local stale target should match base`);
    assert.notDeepEqual(remoteComment, baseComment, `${testCase.id} remote stale target should drift`);
    assert.ok(testCase.tags.has('wp-comments-commentmeta-graph-v4-stale'));
    assert.ok(testCase.tags.has('wp-comments-commentmeta-graph-v4-non-ready'));
  } else {
    assert.equal(baseComment, undefined, `${testCase.id} ready target should not exist in base`);
    assert.equal(remoteComment, undefined, `${testCase.id} ready target should not exist remotely`);
    assert.ok(testCase.tags.has('wp-comments-commentmeta-graph-v4-ready'));
  }

  return {
    commentId,
    commentRowId,
    commentmetaRowId,
    localComment,
    baseComment,
    remoteComment,
    commentmetaRow,
    commentResource: rowResource('wp_comments', commentRowId),
    commentmetaResource: rowResource('wp_commentmeta', commentmetaRowId),
    commentResourceKey: rowResourceKey('wp_comments', commentRowId),
    commentmetaResourceKey: rowResourceKey('wp_commentmeta', commentmetaRowId),
  };
}

function rawRowValues(shape) {
  return [
    shape.commentmetaRow.meta_key,
    shape.commentmetaRow.meta_value,
    shape.localComment?.comment_content,
    shape.baseComment?.comment_content,
    shape.remoteComment?.comment_content,
  ].filter((value) => typeof value === 'string' && value.length > 0);
}

function assertNoRawRowValues(value, forbiddenValues, label) {
  const serialized = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(serialized.includes(forbiddenValue), false, `${label} leaked ${forbiddenValue}`);
  }
}

function assertRedactedRowProbe(shape, label) {
  const forbiddenValues = rawRowValues(shape);
  const redacted = redactEvidence({
    generatedRows: {
      value: {
        comment: shape.localComment,
        baseComment: shape.baseComment,
        remoteComment: shape.remoteComment,
        commentmeta: shape.commentmetaRow,
      },
    },
  });
  const serialized = JSON.stringify(redacted);

  assert.ok(serialized.includes(EVIDENCE_REDACTION_MARKER), `${label} should redact raw row evidence`);
  assert.match(serialized, /"sha256":"[a-f0-9]{64}"/, `${label} should retain hash-only row evidence`);
  assertNoRawRowValues(redacted, forbiddenValues, label);
}

function assertHashOnlyChange(change, label) {
  assert.ok(change, `${label} missing change evidence`);
  for (const hash of [change.base.hash, change.local.hash, change.remote.hash]) {
    assert.match(hash, hashPattern, `${label} should expose hash-only state`);
  }
  assert.equal(Object.hasOwn(change.base, 'value'), false, `${label} leaked base value`);
  assert.equal(Object.hasOwn(change.local, 'value'), false, `${label} leaked local value`);
  assert.equal(Object.hasOwn(change.remote, 'value'), false, `${label} leaked remote value`);
}

function assertFocusedPrecondition(plan, mutation, resource) {
  const precondition = preconditionFor(plan, mutation);

  assert.ok(precondition, `missing live precondition for ${resource.key}`);
  assert.equal(precondition.resourceKey, resource.key);
  assert.equal(precondition.checkedAgainst, 'live-remote');
  assert.equal(precondition.expectedHash, mutation.remoteBeforeHash);
  return precondition;
}

function readyIdentityProof({ testCase, plan, result, applied, shape, commentMutation, commentmetaMutation }) {
  const plannedComment = deserializeResourceValue(commentMutation.value);
  const plannedCommentmeta = deserializeResourceValue(commentmetaMutation.value);
  const commentPrecondition = assertFocusedPrecondition(plan, commentMutation, shape.commentResource);
  const commentmetaPrecondition = assertFocusedPrecondition(plan, commentmetaMutation, shape.commentmetaResource);
  const proof = {
    rpp: 'RPP-0368',
    proofScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    caseId: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: plan.status,
    resultStatus: result.status,
    targetIdentity: {
      commentResourceKey: shape.commentResourceKey,
      commentmetaResourceKey: shape.commentmetaResourceKey,
      targetCommentId: shape.commentId,
      plannedCommentId: plannedComment.comment_ID,
      plannedCommentmetaCommentId: plannedCommentmeta.comment_id,
      appliedCommentId: applied.site.db.wp_comments[shape.commentRowId].comment_ID,
      appliedCommentmetaCommentId: applied.site.db.wp_commentmeta[shape.commentmetaRowId].comment_id,
    },
    hashes: {
      commentLocalHash: resourceHash(testCase.local, shape.commentResource),
      commentAppliedHash: resourceHash(applied.site, shape.commentResource),
      commentmetaLocalHash: resourceHash(testCase.local, shape.commentmetaResource),
      commentmetaAppliedHash: resourceHash(applied.site, shape.commentmetaResource),
    },
    mutations: {
      comment: {
        resourceKey: commentMutation.resourceKey,
        action: commentMutation.action,
        changeKind: commentMutation.changeKind,
        remoteBeforeHash: commentMutation.remoteBeforeHash,
        preconditionExpectedHash: commentPrecondition.expectedHash,
        rewriteCount: commentMutation.wordpressGraphIdentity?.rewrites?.length || 0,
      },
      commentmeta: {
        resourceKey: commentmetaMutation.resourceKey,
        action: commentmetaMutation.action,
        changeKind: commentmetaMutation.changeKind,
        remoteBeforeHash: commentmetaMutation.remoteBeforeHash,
        preconditionExpectedHash: commentmetaPrecondition.expectedHash,
        rewriteCount: commentmetaMutation.wordpressGraphIdentity?.rewrites?.length || 0,
      },
    },
    apply: {
      appliedMutations: applied.appliedMutations,
      journalHash: `sha256:${digest(applied.journal)}`,
      unplannedRemotePreserved: result.unplannedRemotePreserved,
      staleReplayRejected: result.staleReplayRejected,
      staleReplayRejectionCode: result.staleReplayRejectionCode,
      staleReplayRemoteUnchanged: result.staleReplayRemoteUnchanged,
    },
  };

  proof.proofHash = `sha256:${digest(proof)}`;
  return proof;
}

function staleIdentityProof({ testCase, plan, result, shape, blocker, reference, error, remoteBeforeHash, remoteAfterHash }) {
  const commentDecision = decisionFor(plan, shape.commentResourceKey);
  const proof = {
    rpp: 'RPP-0368',
    proofScope: 'local-generated-model',
    productionBacked: false,
    releaseGate: 'NO-GO',
    caseId: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    status: plan.status,
    resultStatus: result.status,
    targetIdentity: {
      commentResourceKey: shape.commentResourceKey,
      commentmetaResourceKey: shape.commentmetaResourceKey,
      targetCommentId: shape.commentId,
      sourceCommentId: shape.commentmetaRow.comment_id,
    },
    blocker: {
      class: blocker.class,
      resourceKey: blocker.resourceKey,
      reasonHash: `sha256:${digest(blocker.reason)}`,
      baseHash: blocker.baseHash,
      localHash: blocker.localHash,
      remoteHash: blocker.remoteHash,
      changeHash: `sha256:${digest(blocker.change)}`,
    },
    reference: {
      relationshipKey: reference.relationshipKey,
      relationshipType: reference.relationshipType,
      sourceResourceKey: reference.sourceResourceKey,
      targetResourceKey: reference.targetResourceKey,
      targetBaseHash: reference.targetBaseHash,
      targetLocalHash: reference.targetLocalHash,
      targetRemoteHash: reference.targetRemoteHash,
      targetLocalChange: reference.targetChange.localChange,
      targetRemoteChange: reference.targetChange.remoteChange,
      targetChangeHash: `sha256:${digest(reference.targetChange)}`,
    },
    decision: {
      resourceKey: commentDecision?.resourceKey || null,
      decision: commentDecision?.decision || null,
      decisionHash: `sha256:${digest(commentDecision || null)}`,
    },
    applyRefusal: {
      code: error.code,
      detailsHash: `sha256:${digest(error.details)}`,
      remoteBeforeHash,
      remoteAfterHash,
    },
  };

  proof.proofHash = `sha256:${digest(proof)}`;
  return proof;
}

test('RPP-0368 generated variant 4 target retains ready and stale commentmeta-comment coverage', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.wpCommentsCommentmetaGraphVariant4;
  const cases = variant4Cases();
  const readyCases = cases.filter((testCase) => testCase.tags.has('wp-comments-commentmeta-graph-v4-ready'));
  const staleCases = cases.filter((testCase) => testCase.tags.has('wp-comments-commentmeta-graph-v4-stale'));
  const nonReadyCases = cases.filter((testCase) => testCase.tags.has('wp-comments-commentmeta-graph-v4-non-ready'));

  assert.ok(coverage, 'missing variant 4 commentmeta comment target coverage');
  assert.equal(coverage.family, 'wp-comments-commentmeta-graph-variant4');
  assert.equal(coverage.total, report.summary.featureFamilies['wp-comments-commentmeta-graph-v4']);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.statuses.ready, 10);
  assert.equal(nonReadyTargetCount(coverage), 10);
  assert.equal(report.summary.featureFamilies['wp-comments-commentmeta-graph-v4-ready'], 10);
  assert.equal(report.summary.featureFamilies['wp-comments-commentmeta-graph-v4-stale'], 10);
  assert.equal(report.summary.featureFamilies['wp-comments-commentmeta-graph-v4-non-ready'], 10);
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(Array.from({ length: 10 }, (_, tier) => [String(tier), 2])),
  );
  assert.equal(cases.length, coverage.total);
  assert.equal(readyCases.length, 10, 'expected one ready v4 commentmeta comment case per tier');
  assert.equal(staleCases.length, 10, 'expected one stale v4 commentmeta comment case per tier');
  assert.equal(nonReadyCases.length, 10, 'expected one non-ready v4 commentmeta comment case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('RPP-0368 carries ready commentmeta comment identity through local planner/apply proof', () => {
  const testCase = selectVariant4Case('wp-comments-commentmeta-graph-v4-ready');
  const shape = assertVariant4CommentmetaCommentShape(testCase, { staleTarget: false });
  const plan = generatedPlanFor(testCase);
  const result = validateGeneratedCase(testCase);
  const applied = applyPlan(cloneJson(testCase.remote), plan);
  const commentMutation = mutationFor(plan, shape.commentResourceKey);
  const commentmetaMutation = mutationFor(plan, shape.commentmetaResourceKey);
  const plannedComment = deserializeResourceValue(commentMutation.value);
  const plannedCommentmeta = deserializeResourceValue(commentmetaMutation.value);
  const proof = readyIdentityProof({
    testCase,
    plan,
    result,
    applied,
    shape,
    commentMutation,
    commentmetaMutation,
  });
  const forbiddenValues = rawRowValues(shape);

  assert.equal(plan.status, 'ready');
  assert.equal(result.status, 'ready');
  assert.equal(result.applied, true);
  assert.equal(result.unplannedRemotePreserved, true);
  assert.equal(result.staleReplayRejected, true);
  assert.equal(result.staleReplayRejectionCode, 'PRECONDITION_FAILED');
  assert.ok(commentMutation, `${testCase.id} should plan the target comment row`);
  assert.ok(commentmetaMutation, `${testCase.id} should plan the commentmeta source row`);
  assert.equal(commentMutation.changeKind, 'create');
  assert.equal(commentmetaMutation.changeKind, 'create');
  assert.equal(plannedComment.comment_ID, shape.commentId);
  assert.equal(plannedCommentmeta.comment_id, shape.commentId);
  assert.equal(commentMutation.wordpressGraphIdentity?.rewrites?.length || 0, 0);
  assert.equal(commentmetaMutation.wordpressGraphIdentity?.rewrites?.length || 0, 0);
  assert.deepEqual(applied.site.db.wp_comments[shape.commentRowId], testCase.local.db.wp_comments[shape.commentRowId]);
  assert.deepEqual(
    applied.site.db.wp_commentmeta[shape.commentmetaRowId],
    testCase.local.db.wp_commentmeta[shape.commentmetaRowId],
  );
  assert.equal(proof.targetIdentity.targetCommentId, proof.targetIdentity.plannedCommentId);
  assert.equal(proof.targetIdentity.targetCommentId, proof.targetIdentity.plannedCommentmetaCommentId);
  assert.equal(proof.targetIdentity.targetCommentId, proof.targetIdentity.appliedCommentId);
  assert.equal(proof.targetIdentity.targetCommentId, proof.targetIdentity.appliedCommentmetaCommentId);
  assert.equal(proof.hashes.commentLocalHash, proof.hashes.commentAppliedHash);
  assert.equal(proof.hashes.commentmetaLocalHash, proof.hashes.commentmetaAppliedHash);
  assert.match(proof.proofHash, sha256HashPattern);
  assertNoRawRowValues(proof, forbiddenValues, 'ready RPP-0368 proof');
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0368 ready commentmeta comment proof',
  }));
  assertRedactedRowProbe(shape, 'ready RPP-0368 row probe');
});

test('RPP-0368 blocks stale commentmeta comment targets with hash-only planner/apply proof', () => {
  const testCase = selectVariant4Case('wp-comments-commentmeta-graph-v4-stale');
  const shape = assertVariant4CommentmetaCommentShape(testCase, { staleTarget: true });
  const plan = generatedPlanFor(testCase);
  const result = validateGeneratedCase(testCase);
  const blocker = plan.blockers.find((entry) => entry.resourceKey === shape.commentmetaResourceKey);
  const reference = blocker?.references.find((entry) => entry.relationshipType === 'commentmeta-comment');
  const remoteBefore = cloneJson(testCase.remote);
  const remoteBeforeHash = digest(remoteBefore);
  const error = captureError(() => applyPlan(remoteBefore, plan));
  const remoteAfterHash = digest(remoteBefore);
  const proof = staleIdentityProof({
    testCase,
    plan,
    result,
    shape,
    blocker,
    reference,
    error,
    remoteBeforeHash,
    remoteAfterHash,
  });
  const forbiddenValues = rawRowValues(shape);

  assert.equal(plan.status, 'blocked');
  assert.equal(result.status, 'blocked');
  assert.equal(result.applied, false);
  assert.equal(result.nonReadyRemoteUnchanged, true);
  assert.equal(mutationFor(plan, shape.commentResourceKey), undefined);
  assert.equal(mutationFor(plan, shape.commentmetaResourceKey), undefined);
  assert.ok(blocker, 'missing stale commentmeta comment blocker');
  assert.equal(blocker.class, 'stale-wordpress-graph-identity');
  assert.equal(blocker.resolutionPolicy, 'preserve-remote-wordpress-graph-and-stop');
  assert.match(blocker.baseHash, hashPattern);
  assert.match(blocker.localHash, hashPattern);
  assert.match(blocker.remoteHash, hashPattern);
  assertHashOnlyChange(blocker.change, 'commentmeta blocker change');
  assert.ok(reference, 'missing commentmeta comment reference evidence');
  assert.equal(reference.relationshipKey, 'wp_commentmeta.comment_id');
  assert.equal(reference.sourceResourceKey, shape.commentmetaResourceKey);
  assert.equal(reference.targetResourceKey, shape.commentResourceKey);
  assert.equal(reference.targetChange.localChange, 'unchanged');
  assert.equal(reference.targetChange.remoteChange, 'update');
  assert.match(reference.targetBaseHash, hashPattern);
  assert.match(reference.targetLocalHash, hashPattern);
  assert.match(reference.targetRemoteHash, hashPattern);
  assertHashOnlyChange(reference.targetChange, 'comment target reference change');
  assert.equal(decisionFor(plan, shape.commentResourceKey).decision, 'keep-remote');
  assert.ok(error instanceof PushPlanError);
  assert.equal(error.code, 'PLAN_NOT_READY');
  assert.equal(remoteAfterHash, remoteBeforeHash, 'stale apply proof must refuse before mutation');
  assert.equal(proof.targetIdentity.targetCommentId, proof.targetIdentity.sourceCommentId);
  assert.match(proof.proofHash, sha256HashPattern);
  assertNoRawRowValues(blocker, forbiddenValues, 'stale RPP-0368 blocker');
  assertNoRawRowValues(reference, forbiddenValues, 'stale RPP-0368 reference');
  assertNoRawRowValues(proof, forbiddenValues, 'stale RPP-0368 proof');
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, {
    label: 'RPP-0368 stale commentmeta comment proof',
  }));
  assertRedactedRowProbe(shape, 'stale RPP-0368 row probe');
});
