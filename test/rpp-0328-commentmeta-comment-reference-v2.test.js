import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const expectedTiers = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const hashPattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

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

function generatedCommentmetaCommentCases() {
  return generatePushHarnessCases()
    .filter((testCase) => testCase.tags.has('commentmeta-comment-graph'));
}

function generatedPlanFor(testCase) {
  return createPushPlan({
    base: testCase.base,
    local: testCase.local,
    remote: testCase.remote,
    now: fixedGeneratedHarnessNow,
  });
}

function mutationFor(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey) || null;
}

function preconditionFor(plan, mutation) {
  return plan.preconditions.find((precondition) => precondition.mutationId === mutation.id) || null;
}

function captureFailedApply(remote, plan) {
  const candidateRemote = cloneJson(remote);
  const beforeHash = digest(candidateRemote);
  let beforeMutationCalls = 0;
  let caughtError = null;

  try {
    applyPlan(candidateRemote, plan, {
      beforeMutation() {
        beforeMutationCalls += 1;
      },
    });
  } catch (error) {
    caughtError = error;
  }

  assert.ok(caughtError instanceof PushPlanError, 'apply should fail with PushPlanError');

  return {
    code: caughtError.code,
    beforeMutationCalls,
    preMutationRefusal: beforeMutationCalls === 0,
    remoteUnchanged: digest(candidateRemote) === beforeHash,
    beforeHash,
    afterHash: digest(candidateRemote),
    detailsHash: `sha256:${digest(caughtError.details || {})}`,
  };
}

function nonReadyTargetCount(coverage) {
  return Object.entries(coverage.statuses)
    .filter(([status]) => status !== 'ready')
    .reduce((sum, [, count]) => sum + count, 0);
}

function assertGeneratedCommentmetaCommentShape(testCase, { staleTarget }) {
  assert.ok(testCase.tags.has('wp-comments-commentmeta-graph'));
  assert.ok(testCase.tags.has('commentmeta-comment-graph'));
  assert.ok(testCase.tags.has('wp-commentmeta-create'));
  assert.ok(testCase.tags.has('same-plan-graph'));

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
  assert.equal(localComment.comment_content, `Generated comment graph target ${commentId}`);

  if (staleTarget) {
    assert.ok(baseComment, `${testCase.id} stale target should exist in base`);
    assert.ok(remoteComment, `${testCase.id} stale target should exist remotely`);
    assert.deepEqual(localComment, baseComment, `${testCase.id} local stale target should match base`);
    assert.notDeepEqual(remoteComment, baseComment, `${testCase.id} remote stale target should drift`);
    assert.equal(remoteComment.comment_content, `Remote stale comment graph target ${commentId}`);
    assert.ok(testCase.tags.has('stale-graph'));
    assert.ok(testCase.tags.has('wp-comments-remote-drift'));
  } else {
    assert.equal(baseComment, undefined, `${testCase.id} ready target should not exist in base`);
    assert.equal(remoteComment, undefined, `${testCase.id} ready target should not exist remotely`);
    assert.ok(testCase.tags.has('wp-comments-create'));
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

function rawGeneratedValues(shape) {
  return [
    shape.commentmetaRow.meta_key,
    shape.commentmetaRow.meta_value,
    shape.localComment?.comment_content,
    shape.baseComment?.comment_content,
    shape.remoteComment?.comment_content,
    'comment_content',
    'meta_value',
  ].filter((value) => typeof value === 'string' && value.length > 0);
}

function assertNoRawGeneratedValues(value, shape, label) {
  const serialized = JSON.stringify(value);

  for (const forbiddenValue of rawGeneratedValues(shape)) {
    assert.equal(serialized.includes(forbiddenValue), false, `${label} leaked ${forbiddenValue}`);
  }
}

function assertHashOnlyChange(change, label) {
  assert.ok(change, `${label} missing change evidence`);
  for (const state of ['base', 'local', 'remote']) {
    assert.match(change[state].hash, hashPattern, `${label}.${state}.hash`);
    assert.equal(Object.hasOwn(change[state], 'value'), false, `${label}.${state} leaked raw value`);
  }
}

function readyGeneratedEvidence({ testCase, shape, plan, validation, applied }) {
  const commentMutation = mutationFor(plan, shape.commentResourceKey);
  const commentmetaMutation = mutationFor(plan, shape.commentmetaResourceKey);
  const commentPrecondition = preconditionFor(plan, commentMutation);
  const commentmetaPrecondition = preconditionFor(plan, commentmetaMutation);
  const plannedComment = deserializeResourceValue(commentMutation.value);
  const plannedCommentmeta = deserializeResourceValue(commentmetaMutation.value);
  const commentAppliedHash = resourceHash(applied.site, shape.commentResource);
  const commentmetaAppliedHash = resourceHash(applied.site, shape.commentmetaResource);
  const proof = {
    rpp: 'RPP-0328',
    evidenceSource: 'generated-commentmeta-comment-reference-v2',
    source: 'generated-ready',
    caseId: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    relationship: {
      relationshipType: 'commentmeta-comment',
      relationshipKey: 'wp_commentmeta.comment_id',
      commentResourceKey: shape.commentResourceKey,
      commentmetaResourceKey: shape.commentmetaResourceKey,
      targetCommentId: shape.commentId,
    },
    plan: {
      status: plan.status,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      blockerCount: plan.blockers.length,
      hash: `sha256:${digest(plan)}`,
    },
    mutations: {
      comment: {
        resourceKey: commentMutation.resourceKey,
        action: commentMutation.action,
        changeKind: commentMutation.changeKind,
        plannedCommentId: plannedComment.comment_ID,
        remoteBeforeHash: commentMutation.remoteBeforeHash,
        localHash: commentMutation.localHash,
        rewriteCount: commentMutation.wordpressGraphIdentity?.rewrites?.length || 0,
      },
      commentmeta: {
        resourceKey: commentmetaMutation.resourceKey,
        action: commentmetaMutation.action,
        changeKind: commentmetaMutation.changeKind,
        plannedCommentId: plannedCommentmeta.comment_id,
        remoteBeforeHash: commentmetaMutation.remoteBeforeHash,
        localHash: commentmetaMutation.localHash,
        rewriteCount: commentmetaMutation.wordpressGraphIdentity?.rewrites?.length || 0,
      },
    },
    preconditions: {
      commentLiveRemote: commentPrecondition?.checkedAgainst === 'live-remote'
        && commentPrecondition.expectedHash === commentMutation.remoteBeforeHash,
      commentmetaLiveRemote: commentmetaPrecondition?.checkedAgainst === 'live-remote'
        && commentmetaPrecondition.expectedHash === commentmetaMutation.remoteBeforeHash,
      commentHash: commentPrecondition?.expectedHash || null,
      commentmetaHash: commentmetaPrecondition?.expectedHash || null,
    },
    apply: {
      appliedMutations: applied.appliedMutations,
      commentAppliedHash,
      commentmetaAppliedHash,
      commentMatchesLocal: commentAppliedHash === resourceHash(testCase.local, shape.commentResource),
      commentmetaMatchesLocal: commentmetaAppliedHash === resourceHash(testCase.local, shape.commentmetaResource),
      unplannedRemotePreserved: validation.unplannedRemotePreserved === true,
      staleReplayRejected: validation.staleReplayRejected === true,
      staleReplayRejectionCode: validation.staleReplayRejectionCode || null,
    },
  };
  const invariants = {
    readyPlan: proof.plan.status === 'ready',
    validationReady: validation.status === 'ready',
    commentMutationPlanned: Boolean(commentMutation),
    commentmetaMutationPlanned: Boolean(commentmetaMutation),
    commentIdentityCarried:
      proof.relationship.targetCommentId === proof.mutations.comment.plannedCommentId
      && proof.relationship.targetCommentId === proof.mutations.commentmeta.plannedCommentId,
    noGraphRewrites:
      proof.mutations.comment.rewriteCount === 0
      && proof.mutations.commentmeta.rewriteCount === 0,
    liveRemotePreconditions:
      proof.preconditions.commentLiveRemote
      && proof.preconditions.commentmetaLiveRemote
      && hashPattern.test(proof.preconditions.commentHash)
      && hashPattern.test(proof.preconditions.commentmetaHash),
    appliedRowsMatchLocal: proof.apply.commentMatchesLocal && proof.apply.commentmetaMatchesLocal,
    staleReplayRejected:
      proof.apply.staleReplayRejected
      && proof.apply.staleReplayRejectionCode === 'PRECONDITION_FAILED',
  };

  return {
    ...proof,
    status: Object.values(invariants).every(Boolean) ? 'checked' : 'blocked',
    verdict: Object.values(invariants).every(Boolean)
      ? 'COMMENTMETA_COMMENT_GENERATED_READY_CARRIED_V2'
      : 'COMMENTMETA_COMMENT_GENERATED_READY_REQUIRED_V2',
    invariants,
    proofHash: `sha256:${digest({ proof, invariants })}`,
  };
}

function staleGeneratedEvidence({ testCase, shape, plan, validation, failedApply }) {
  const blocker = plan.blockers.find((entry) => entry.resourceKey === shape.commentmetaResourceKey);
  const reference = blocker?.references.find((entry) => entry.relationshipType === 'commentmeta-comment');
  const proof = {
    rpp: 'RPP-0328',
    evidenceSource: 'generated-commentmeta-comment-reference-v2',
    source: 'generated-stale',
    caseId: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    relationship: {
      relationshipType: 'commentmeta-comment',
      relationshipKey: 'wp_commentmeta.comment_id',
      commentResourceKey: shape.commentResourceKey,
      commentmetaResourceKey: shape.commentmetaResourceKey,
      targetCommentId: shape.commentId,
    },
    plan: {
      status: plan.status,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      blockerCount: plan.blockers.length,
      hash: `sha256:${digest(plan)}`,
    },
    graphIdentity: {
      blockerClass: blocker?.class || null,
      resolutionPolicy: blocker?.resolutionPolicy || null,
      sourceBaseHash: blocker?.baseHash || null,
      sourceLocalHash: blocker?.localHash || null,
      sourceRemoteHash: blocker?.remoteHash || null,
      reference: reference ? {
        relationshipType: reference.relationshipType,
        relationshipKey: reference.relationshipKey,
        sourceResourceKey: reference.sourceResourceKey,
        targetResourceKey: reference.targetResourceKey,
        targetLocalChange: reference.targetChange.localChange,
        targetRemoteChange: reference.targetChange.remoteChange,
        targetBaseHash: reference.targetBaseHash,
        targetLocalHash: reference.targetLocalHash,
        targetRemoteHash: reference.targetRemoteHash,
        targetSupportClass: reference.targetSupport?.className || null,
        targetSupportReasonHash: reference.targetSupport?.reason
          ? `sha256:${digest(reference.targetSupport.reason)}`
          : null,
      } : null,
    },
    refusal: failedApply,
    validation: {
      status: validation.status,
      applied: validation.applied === true,
      nonReadyRemoteUnchanged: validation.nonReadyRemoteUnchanged === true,
    },
  };
  const invariants = {
    nonReadyPlan: proof.plan.status !== 'ready',
    validationNonReady: validation.status !== 'ready',
    commentMutationAbsent: mutationFor(plan, shape.commentResourceKey) === null,
    commentmetaMutationAbsent: mutationFor(plan, shape.commentmetaResourceKey) === null,
    staleGraphBlockerPresent:
      proof.graphIdentity.blockerClass === 'stale-wordpress-graph-identity'
      && proof.graphIdentity.resolutionPolicy === 'preserve-remote-wordpress-graph-and-stop',
    referenceTargetsComment:
      proof.graphIdentity.reference?.relationshipKey === 'wp_commentmeta.comment_id'
      && proof.graphIdentity.reference?.targetResourceKey === shape.commentResourceKey,
    targetRemoteDriftCarried:
      proof.graphIdentity.reference?.targetLocalChange === 'unchanged'
      && proof.graphIdentity.reference?.targetRemoteChange === 'update',
    hashOnlyReferenceEvidence: [
      proof.graphIdentity.sourceBaseHash,
      proof.graphIdentity.sourceLocalHash,
      proof.graphIdentity.sourceRemoteHash,
      proof.graphIdentity.reference?.targetBaseHash,
      proof.graphIdentity.reference?.targetLocalHash,
      proof.graphIdentity.reference?.targetRemoteHash,
    ].every((hash) => hashPattern.test(hash || '')),
    applyRefusedBeforeMutation:
      proof.refusal.code === 'PLAN_NOT_READY'
      && proof.refusal.preMutationRefusal === true
      && proof.refusal.remoteUnchanged === true,
    validationDidNotApply:
      proof.validation.applied === false
      && proof.validation.nonReadyRemoteUnchanged === true,
  };

  return {
    ...proof,
    status: Object.values(invariants).every(Boolean) ? 'checked' : 'blocked',
    verdict: Object.values(invariants).every(Boolean)
      ? 'COMMENTMETA_COMMENT_GENERATED_STALE_STOPPED_V2'
      : 'COMMENTMETA_COMMENT_GENERATED_STALE_REQUIRED_V2',
    invariants,
    proofHash: `sha256:${digest({ proof, invariants })}`,
  };
}

test('RPP-0328 generated harness includes ready and stale commentmeta comment cases', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.commentmetaCommentGraph;
  const cases = generatedCommentmetaCommentCases();
  const readyCases = cases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-ready');
  const staleCases = cases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-stale');

  assert.ok(coverage, 'missing commentmeta comment graph target coverage');
  assert.equal(coverage.family, 'wp-comments-commentmeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['commentmeta-comment-graph']);
  assert.equal(coverage.total, 20);
  assert.equal(coverage.statuses.ready, 10, 'expected one ready case per tier');
  assert.equal(nonReadyTargetCount(coverage), 10, 'expected one stale/non-ready case per tier');
  assert.deepEqual(
    coverage.perTier,
    Object.fromEntries(expectedTiers.map((tier) => [String(tier), 2])),
  );
  assert.equal(cases.length, coverage.total);
  assert.equal(readyCases.length, 10);
  assert.equal(staleCases.length, 10);
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), expectedTiers);
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), expectedTiers);
});

test('RPP-0328 ready generated commentmeta comment cases carry the comment reference through apply', () => {
  const readyCases = generatedCommentmetaCommentCases()
    .filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-ready');
  const evidence = readyCases.map((testCase) => {
    const shape = assertGeneratedCommentmetaCommentShape(testCase, { staleTarget: false });
    const plan = generatedPlanFor(testCase);
    const validation = validateGeneratedCase(testCase);
    const applied = applyPlan(cloneJson(testCase.remote), plan);
    const proof = readyGeneratedEvidence({ testCase, shape, plan, validation, applied });

    assert.equal(plan.status, 'ready', `${testCase.id} should be ready`);
    assert.equal(validation.status, 'ready', `${testCase.id} validation should be ready`);
    assert.equal(proof.status, 'checked', `${testCase.id} ready proof should be checked`);
    assert.equal(proof.verdict, 'COMMENTMETA_COMMENT_GENERATED_READY_CARRIED_V2');
    assert.match(proof.proofHash, sha256Pattern);
    assertNoRawGeneratedValues(proof, shape, `${testCase.id} ready proof`);
    assert.doesNotThrow(() =>
      assertEvidenceHasNoRawValues(proof, { label: `${testCase.id} RPP-0328 ready proof` }));
    return proof;
  });
  const aggregate = {
    rpp: 'RPP-0328',
    evidenceSource: 'generated-commentmeta-comment-reference-v2',
    source: 'generated-ready-aggregate',
    status: evidence.every((entry) => entry.status === 'checked') ? 'checked' : 'blocked',
    readyCases: evidence.length,
    readyTiers: [...new Set(evidence.map((entry) => entry.tier))].sort((a, b) => a - b),
    caseProofHash: `sha256:${digest(evidence.map((entry) => ({
      caseId: entry.caseId,
      tier: entry.tier,
      proofHash: entry.proofHash,
    })))}`,
  };

  aggregate.proofHash = `sha256:${digest(aggregate)}`;

  assert.equal(aggregate.status, 'checked');
  assert.equal(aggregate.readyCases, 10);
  assert.deepEqual(aggregate.readyTiers, expectedTiers);
  assert.match(aggregate.proofHash, sha256Pattern);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(aggregate, { label: 'RPP-0328 ready aggregate proof' }));
});

test('RPP-0328 stale generated commentmeta comment cases stop before mutation with hash-only reference evidence', () => {
  const staleCases = generatedCommentmetaCommentCases()
    .filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-stale');
  const evidence = staleCases.map((testCase) => {
    const shape = assertGeneratedCommentmetaCommentShape(testCase, { staleTarget: true });
    const plan = generatedPlanFor(testCase);
    const validation = validateGeneratedCase(testCase);
    const failedApply = captureFailedApply(testCase.remote, plan);
    const blocker = plan.blockers.find((entry) => entry.resourceKey === shape.commentmetaResourceKey);
    const reference = blocker?.references.find((entry) => entry.relationshipType === 'commentmeta-comment');
    const proof = staleGeneratedEvidence({ testCase, shape, plan, validation, failedApply });

    assert.notEqual(plan.status, 'ready', `${testCase.id} should not be ready`);
    assert.notEqual(validation.status, 'ready', `${testCase.id} validation should not be ready`);
    assert.ok(blocker, `${testCase.id} should include a stale graph blocker`);
    assert.ok(reference, `${testCase.id} should include commentmeta-comment reference evidence`);
    assert.equal(mutationFor(plan, shape.commentResourceKey), null);
    assert.equal(mutationFor(plan, shape.commentmetaResourceKey), null);
    assert.equal(reference.relationshipKey, 'wp_commentmeta.comment_id');
    assert.equal(reference.targetResourceKey, shape.commentResourceKey);
    assertHashOnlyChange(blocker.change, `${testCase.id} blocker change`);
    assertHashOnlyChange(reference.targetChange, `${testCase.id} target change`);
    assert.equal(proof.status, 'checked', `${testCase.id} stale proof should be checked`);
    assert.equal(proof.verdict, 'COMMENTMETA_COMMENT_GENERATED_STALE_STOPPED_V2');
    assert.match(proof.proofHash, sha256Pattern);
    assertNoRawGeneratedValues(blocker, shape, `${testCase.id} stale blocker`);
    assertNoRawGeneratedValues(reference, shape, `${testCase.id} stale reference`);
    assertNoRawGeneratedValues(proof, shape, `${testCase.id} stale proof`);
    assert.doesNotThrow(() =>
      assertEvidenceHasNoRawValues(proof, { label: `${testCase.id} RPP-0328 stale proof` }));
    return proof;
  });
  const aggregate = {
    rpp: 'RPP-0328',
    evidenceSource: 'generated-commentmeta-comment-reference-v2',
    source: 'generated-stale-aggregate',
    status: evidence.every((entry) => entry.status === 'checked') ? 'checked' : 'blocked',
    staleCases: evidence.length,
    staleTiers: [...new Set(evidence.map((entry) => entry.tier))].sort((a, b) => a - b),
    stoppedBeforeMutation: evidence.every((entry) =>
      entry.refusal.preMutationRefusal === true && entry.refusal.remoteUnchanged === true),
    caseProofHash: `sha256:${digest(evidence.map((entry) => ({
      caseId: entry.caseId,
      tier: entry.tier,
      proofHash: entry.proofHash,
    })))}`,
  };

  aggregate.proofHash = `sha256:${digest(aggregate)}`;

  assert.equal(aggregate.status, 'checked');
  assert.equal(aggregate.staleCases, 10);
  assert.deepEqual(aggregate.staleTiers, expectedTiers);
  assert.equal(aggregate.stoppedBeforeMutation, true);
  assert.match(aggregate.proofHash, sha256Pattern);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(aggregate, { label: 'RPP-0328 stale aggregate proof' }));
});
