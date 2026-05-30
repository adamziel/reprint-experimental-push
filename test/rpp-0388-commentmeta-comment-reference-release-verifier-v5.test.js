import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import {
  generatePushHarnessCases,
  runGeneratedPushHarness,
  validateGeneratedCase,
} from '../scripts/harness/generated-push-cases.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierPath = path.join(repoRoot, 'scripts/playground/production-shaped-release-verify.mjs');
const authenticatedPushClientPath = path.join(repoRoot, 'src/authenticated-http-push-client.js');
const fixedGeneratedHarnessNow = new Date('2026-05-28T00:00:00.000Z');
const expectedTiers = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const hashPattern = /^[a-f0-9]{64}$/;
const forbiddenGeneratedFixtureFragments = Object.freeze([
  'generated commentmeta graph ',
  'Generated comment graph target',
  'Remote stale comment graph target',
  '"comment_content"',
  '"meta_value"',
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowResourceKey(table, id) {
  return `row:${JSON.stringify([table, id])}`;
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

function preconditionFor(plan, resourceKey) {
  return plan.preconditions.find((precondition) => precondition.resourceKey === resourceKey) || null;
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

function releaseVerifierProofForReadyPlan({ plan, appliedSite, validation }) {
  const receiptHash = digest({ kind: 'rpp-0388-dry-run-receipt', plan });
  const mutationResourceKeys = plan.mutations.map((mutation) => mutation.resourceKey);
  return {
    ok: true,
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
        preconditionSetHash: digest(plan.preconditions),
        mutationSetHash: digest(plan.mutations.map((mutation) => ({
          id: mutation.id,
          resourceKey: mutation.resourceKey,
          baseHash: mutation.baseHash,
          remoteBeforeHash: mutation.remoteBeforeHash,
          localHash: mutation.localHash,
        }))),
        verifiedCount: mutationResourceKeys.length,
        verifiedResourceKeys: mutationResourceKeys,
      },
    },
    after: {
      status: 200,
      targetRowsChecked: true,
      unplannedRemotePreserved: validation.unplannedRemotePreserved === true,
      appliedSnapshotHash: digest(appliedSite),
    },
    planObject: plan,
  };
}

function releaseVerifierBlockedProofFor(plan) {
  return {
    ok: false,
    code: 'PLAN_NOT_READY_LOCALLY',
    dryRun: null,
    apply: null,
    dbJournal: null,
    planObject: plan,
  };
}

function assertGeneratedCommentmetaCommentShape(testCase, { staleTarget }) {
  assert.ok(testCase.tags.has('wp-comments-commentmeta-graph'));
  assert.ok(testCase.tags.has('commentmeta-comment-graph'));
  assert.ok(testCase.tags.has('wp-commentmeta-create'));

  const commentmetaRows = Object.entries(testCase.local.db.wp_commentmeta)
    .filter(([id, row]) =>
      !testCase.base.db.wp_commentmeta[id]
      && row.meta_key.startsWith('_generated_commentmeta_graph_'));

  assert.equal(commentmetaRows.length, 1, `${testCase.id} should create one wp_commentmeta row`);

  const [commentmetaRowId, commentmetaRow] = commentmetaRows[0];
  const commentId = Number(commentmetaRow.comment_id);
  const commentRowId = `comment_ID:${commentId}`;
  const localComment = testCase.local.db.wp_comments[commentRowId];
  const baseComment = testCase.base.db.wp_comments[commentRowId];
  const remoteComment = testCase.remote.db.wp_comments[commentRowId];

  assert.ok(Number.isSafeInteger(commentId), `${testCase.id} comment_id should be numeric`);
  assert.ok(localComment, `${testCase.id} should carry a local wp_comments target`);
  assert.equal(localComment.comment_ID, commentId);
  assert.equal(localComment.comment_content, `Generated comment graph target ${commentId}`);

  if (staleTarget) {
    assert.ok(baseComment, `${testCase.id} stale target should exist in base`);
    assert.ok(remoteComment, `${testCase.id} stale target should exist remotely`);
    assert.deepEqual(localComment, baseComment, `${testCase.id} local stale target should match base`);
    assert.notDeepEqual(remoteComment, baseComment, `${testCase.id} stale target should drift remotely`);
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
    commentResourceKey: rowResourceKey('wp_comments', commentRowId),
    commentmetaResourceKey: rowResourceKey('wp_commentmeta', commentmetaRowId),
  };
}

function summarizeReadyReleaseVerifierEvidence({ testCase, plan, proof, appliedSite, shape, validation }) {
  const commentMutation = mutationFor(plan, shape.commentResourceKey);
  const commentmetaMutation = mutationFor(plan, shape.commentmetaResourceKey);
  const commentPrecondition = preconditionFor(plan, shape.commentResourceKey);
  const commentmetaPrecondition = preconditionFor(plan, shape.commentmetaResourceKey);
  const plannedCommentmeta = commentmetaMutation
    ? deserializeResourceValue(commentmetaMutation.value)
    : null;
  const applyRevalidation = proof.apply?.applyRevalidation || {};
  const verifiedResourceKeys = Array.isArray(applyRevalidation.verifiedResourceKeys)
    ? applyRevalidation.verifiedResourceKeys
    : [];
  const mutationResourceKeys = plan.mutations.map((mutation) => mutation.resourceKey);

  const evidence = {
    rpp: 'RPP-0388',
    evidenceSource: 'commentmeta-comment-reference-release-verifier-v5',
    source: 'generated-ready',
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    relationship: {
      relationshipType: 'commentmeta-comment',
      relationshipKey: 'wp_commentmeta.comment_id',
      commentResourceKey: shape.commentResourceKey,
      commentmetaResourceKey: shape.commentmetaResourceKey,
      commentId: shape.commentId,
    },
    plan: {
      status: plan.status,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      blockerCount: plan.blockers.length,
      planHash: digest(plan),
    },
    mutationBoundary: {
      commentPlanned: Boolean(commentMutation),
      commentmetaPlanned: Boolean(commentmetaMutation),
      commentChangeKind: commentMutation?.changeKind || null,
      commentmetaChangeKind: commentmetaMutation?.changeKind || null,
      commentmetaCarriesComment: Number(plannedCommentmeta?.comment_id) === shape.commentId,
      commentMutationHash: commentMutation ? digest({
        resourceKey: commentMutation.resourceKey,
        action: commentMutation.action,
        changeKind: commentMutation.changeKind,
        baseHash: commentMutation.baseHash,
        remoteBeforeHash: commentMutation.remoteBeforeHash,
        localHash: commentMutation.localHash,
      }) : null,
      commentmetaMutationHash: commentmetaMutation ? digest({
        resourceKey: commentmetaMutation.resourceKey,
        action: commentmetaMutation.action,
        changeKind: commentmetaMutation.changeKind,
        baseHash: commentmetaMutation.baseHash,
        remoteBeforeHash: commentmetaMutation.remoteBeforeHash,
        localHash: commentmetaMutation.localHash,
        commentId: Number(plannedCommentmeta?.comment_id),
      }) : null,
    },
    preconditions: {
      commentLiveRemote: commentPrecondition?.checkedAgainst === 'live-remote'
        && commentPrecondition.expectedHash === commentMutation?.remoteBeforeHash
        && hashPattern.test(commentPrecondition.expectedHash),
      commentmetaLiveRemote: commentmetaPrecondition?.checkedAgainst === 'live-remote'
        && commentmetaPrecondition.expectedHash === commentmetaMutation?.remoteBeforeHash
        && hashPattern.test(commentmetaPrecondition.expectedHash),
      commentExpectedHash: commentPrecondition?.expectedHash || null,
      commentmetaExpectedHash: commentmetaPrecondition?.expectedHash || null,
    },
    applyRevalidation: {
      required: applyRevalidation.required || null,
      phase: applyRevalidation.phase || null,
      checkedAgainst: applyRevalidation.checkedAgainst || null,
      verifiedCount: applyRevalidation.verifiedCount ?? null,
      verifiedResourceKeysHash: digest(verifiedResourceKeys),
      coversComment: verifiedResourceKeys.includes(shape.commentResourceKey),
      coversCommentmeta: verifiedResourceKeys.includes(shape.commentmetaResourceKey),
      exactMutationSet: JSON.stringify(verifiedResourceKeys) === JSON.stringify(mutationResourceKeys),
      planHashMatches: applyRevalidation.planHash === digest(plan),
      receiptHashMatches: applyRevalidation.receiptHash === proof.dryRun?.receiptHash,
    },
    after: {
      targetRowsChecked: proof.after?.targetRowsChecked === true,
      unplannedRemotePreserved: proof.after?.unplannedRemotePreserved === true,
      appliedCommentMatchesLocal:
        digest(appliedSite.db.wp_comments[shape.commentRowId])
        === digest(testCase.local.db.wp_comments[shape.commentRowId]),
      appliedCommentmetaMatchesLocal:
        digest(appliedSite.db.wp_commentmeta[shape.commentmetaRowId])
        === digest(testCase.local.db.wp_commentmeta[shape.commentmetaRowId]),
      appliedCommentmetaCarriesComment:
        Number(appliedSite.db.wp_commentmeta[shape.commentmetaRowId]?.comment_id) === shape.commentId,
    },
    validation: {
      applied: validation.applied === true,
      staleReplayRejected: validation.staleReplayRejected === true,
      staleReplayRejectionCode: validation.staleReplayRejectionCode || null,
    },
  };

  const invariants = {
    readyPlan: evidence.plan.status === 'ready',
    noGraphBlockers: evidence.plan.blockerCount === 0,
    commentMutationPlanned: evidence.mutationBoundary.commentPlanned,
    commentmetaMutationPlanned: evidence.mutationBoundary.commentmetaPlanned,
    commentmetaCarriesComment: evidence.mutationBoundary.commentmetaCarriesComment,
    commentHasLiveRemotePrecondition: evidence.preconditions.commentLiveRemote,
    commentmetaHasLiveRemotePrecondition: evidence.preconditions.commentmetaLiveRemote,
    applyRevalidatesBeforeFirstMutation:
      evidence.applyRevalidation.required === 'fresh-live-hashes-before-first-mutation'
      && evidence.applyRevalidation.phase === 'before-first-mutation'
      && evidence.applyRevalidation.checkedAgainst === 'live-remote',
    applyRevalidationCoversCommentmetaCommentResources:
      evidence.applyRevalidation.coversComment && evidence.applyRevalidation.coversCommentmeta,
    applyRevalidationBindsExactMutationSet:
      evidence.applyRevalidation.verifiedCount === evidence.plan.mutationCount
      && evidence.applyRevalidation.exactMutationSet
      && evidence.applyRevalidation.planHashMatches
      && evidence.applyRevalidation.receiptHashMatches,
    appliedRowsMatchLocal:
      evidence.after.appliedCommentMatchesLocal && evidence.after.appliedCommentmetaMatchesLocal,
    appliedCommentmetaCarriesComment: evidence.after.appliedCommentmetaCarriesComment,
    generatedValidationApplied: evidence.validation.applied,
    generatedStaleReplayRejected:
      evidence.validation.staleReplayRejected
      && evidence.validation.staleReplayRejectionCode === 'PRECONDITION_FAILED',
  };

  return {
    ...evidence,
    status: Object.values(invariants).every(Boolean) ? 'checked' : 'blocked',
    verdict: Object.values(invariants).every(Boolean)
      ? 'COMMENTMETA_COMMENT_RELEASE_VERIFIER_READY_CARRIED'
      : 'COMMENTMETA_COMMENT_RELEASE_VERIFIER_READY_REQUIRED',
    invariants,
    evidenceHash: digest({ evidence, invariants }),
  };
}

function summarizeStaleReleaseVerifierEvidence({ testCase, plan, proof, shape, validation, beforeHash, afterHash, error }) {
  const staleBlocker = plan.blockers.find((blocker) => blocker.resourceKey === shape.commentmetaResourceKey) || null;
  const staleReference = staleBlocker?.references.find((reference) =>
    reference.relationshipType === 'commentmeta-comment') || null;
  const evidence = {
    rpp: 'RPP-0388',
    evidenceSource: 'commentmeta-comment-reference-release-verifier-v5',
    source: 'generated-stale',
    id: testCase.id,
    tier: testCase.tier,
    family: testCase.family,
    releaseVerifier: {
      ok: proof.ok === true,
      code: proof.code || null,
      dryRunAttempted: proof.dryRun !== null,
      applyAttempted: proof.apply !== null,
      durableJournalAttempted: proof.dbJournal !== null,
    },
    plan: {
      status: plan.status,
      mutationCount: plan.mutations.length,
      preconditionCount: plan.preconditions.length,
      blockerCount: plan.blockers.length,
      planHash: digest(plan),
    },
    graphIdentity: {
      relationshipType: 'commentmeta-comment',
      relationshipKey: 'wp_commentmeta.comment_id',
      commentResourceKey: shape.commentResourceKey,
      commentmetaResourceKey: shape.commentmetaResourceKey,
      blockerClass: staleBlocker?.class || null,
      resolutionPolicy: staleBlocker?.resolutionPolicy || null,
      baseHash: staleBlocker?.baseHash || null,
      localHash: staleBlocker?.localHash || null,
      remoteHash: staleBlocker?.remoteHash || null,
      reference: staleReference ? {
        relationshipType: staleReference.relationshipType || null,
        relationshipKey: staleReference.relationshipKey || null,
        sourceResourceKey: staleReference.sourceResourceKey || null,
        targetResourceKey: staleReference.targetResourceKey || null,
        targetRemoteChange: staleReference.targetChange?.remoteChange || null,
        targetBaseHash: staleReference.targetBaseHash || null,
        targetLocalHash: staleReference.targetLocalHash || null,
        targetRemoteHash: staleReference.targetRemoteHash || null,
        targetSupportClass: staleReference.targetSupport?.className || null,
        targetSupportReasonHash: staleReference.targetSupport?.reason
          ? digest(staleReference.targetSupport.reason)
          : null,
      } : null,
    },
    refusal: {
      errorName: error instanceof Error ? error.name : null,
      errorCode: error?.code || null,
      beforeHash,
      afterHash,
      remoteUnchanged: beforeHash === afterHash,
    },
    validation: {
      applied: validation.applied === true,
      nonReadyRemoteUnchanged: validation.nonReadyRemoteUnchanged === true,
    },
  };

  const invariants = {
    nonReadyPlan: evidence.plan.status !== 'ready',
    releaseVerifierStoppedBeforeDryRun:
      evidence.releaseVerifier.code === 'PLAN_NOT_READY_LOCALLY'
      && evidence.releaseVerifier.dryRunAttempted === false
      && evidence.releaseVerifier.applyAttempted === false,
    commentmetaMutationAbsent: mutationFor(plan, shape.commentmetaResourceKey) === null,
    staleGraphBlockerPresent: evidence.graphIdentity.blockerClass === 'stale-wordpress-graph-identity',
    referenceTargetsComment:
      evidence.graphIdentity.reference?.relationshipKey === 'wp_commentmeta.comment_id'
      && evidence.graphIdentity.reference?.targetResourceKey === shape.commentResourceKey,
    targetRemoteDriftCarried: evidence.graphIdentity.reference?.targetRemoteChange === 'update',
    hashOnlyReferenceEvidence: [
      evidence.graphIdentity.baseHash,
      evidence.graphIdentity.localHash,
      evidence.graphIdentity.remoteHash,
      evidence.graphIdentity.reference?.targetBaseHash,
      evidence.graphIdentity.reference?.targetLocalHash,
      evidence.graphIdentity.reference?.targetRemoteHash,
    ].every((hash) => hashPattern.test(hash || '')),
    applyRefusesBeforeMutation:
      error instanceof PushPlanError
      && error.code === 'PLAN_NOT_READY'
      && evidence.refusal.remoteUnchanged === true,
    generatedValidationDidNotApply:
      evidence.validation.applied === false && evidence.validation.nonReadyRemoteUnchanged === true,
  };

  return {
    ...evidence,
    status: Object.values(invariants).every(Boolean) ? 'checked' : 'blocked',
    verdict: Object.values(invariants).every(Boolean)
      ? 'COMMENTMETA_COMMENT_RELEASE_VERIFIER_STALE_STOPPED'
      : 'COMMENTMETA_COMMENT_RELEASE_VERIFIER_STALE_REQUIRED',
    invariants,
    evidenceHash: digest({ evidence, invariants }),
  };
}

function assertNoRawGeneratedFixtureValues(value, label) {
  const json = JSON.stringify(value);
  for (const forbidden of forbiddenGeneratedFixtureFragments) {
    assert.equal(json.includes(forbidden), false, `${label} leaked ${forbidden}`);
  }
}

test('RPP-0388 carries generated ready commentmeta comment cases through release verifier proof shape', () => {
  const report = runGeneratedPushHarness();
  const coverage = report.summary.targetCoverage.commentmetaCommentGraph;
  const cases = generatePushHarnessCases();
  const targetCases = cases.filter((testCase) => testCase.tags.has('commentmeta-comment-graph'));
  const readyCases = targetCases.filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-ready');

  assert.ok(coverage, 'missing commentmeta comment graph target coverage');
  assert.equal(coverage.family, 'wp-comments-commentmeta-graph-ready');
  assert.equal(coverage.total, report.summary.featureFamilies['commentmeta-comment-graph']);
  assert.equal(coverage.statuses.ready, 10, 'expected one ready commentmeta comment case per tier');
  assert.equal(nonReadyTargetCount(coverage), 10, 'expected one stale/non-ready commentmeta comment case per tier');
  assert.deepEqual(readyCases.map((testCase) => testCase.tier), expectedTiers);

  const readyEvidence = readyCases.map((testCase) => {
    const shape = assertGeneratedCommentmetaCommentShape(testCase, { staleTarget: false });
    const plan = generatedPlanFor(testCase);
    const validation = validateGeneratedCase(testCase);
    const appliedSite = applyPlan(cloneJson(testCase.remote), plan).site;
    const proof = releaseVerifierProofForReadyPlan({ plan, appliedSite, validation });
    const evidence = summarizeReadyReleaseVerifierEvidence({
      testCase,
      plan,
      proof,
      appliedSite,
      shape,
      validation,
    });

    assert.equal(plan.status, 'ready', `${testCase.id} should be ready`);
    assert.equal(validation.status, 'ready', `${testCase.id} validation should be ready`);
    assert.equal(evidence.status, 'checked', `${testCase.id} release verifier evidence should be checked`);
    assert.equal(evidence.verdict, 'COMMENTMETA_COMMENT_RELEASE_VERIFIER_READY_CARRIED');
    assert.match(evidence.evidenceHash, hashPattern);
    assert.equal(evidence.applyRevalidation.coversComment, true);
    assert.equal(evidence.applyRevalidation.coversCommentmeta, true);
    assert.equal(evidence.after.appliedCommentmetaCarriesComment, true);
    assertNoRawGeneratedFixtureValues(evidence, testCase.id);
    assert.doesNotThrow(() =>
      assertEvidenceHasNoRawValues(evidence, { label: `${testCase.id} ready release verifier evidence` }));
    return evidence;
  });

  const aggregate = {
    rpp: 'RPP-0388',
    evidenceSource: 'commentmeta-comment-reference-release-verifier-v5',
    status: readyEvidence.every((entry) => entry.status === 'checked') ? 'checked' : 'blocked',
    verdict: readyEvidence.every((entry) => entry.status === 'checked')
      ? 'COMMENTMETA_COMMENT_GENERATED_READY_RELEASE_VERIFIER_CARRIED'
      : 'COMMENTMETA_COMMENT_GENERATED_READY_RELEASE_VERIFIER_REQUIRED',
    generated: {
      requiredTag: 'commentmeta-comment-graph',
      readyCases: readyEvidence.length,
      readyTiers: [...new Set(readyEvidence.map((entry) => entry.tier))].sort((a, b) => a - b),
      coverageTotal: coverage.total,
      coverageStatuses: coverage.statuses,
      perTier: coverage.perTier,
      caseEvidenceHash: digest(readyEvidence.map((entry) => ({
        id: entry.id,
        tier: entry.tier,
        evidenceHash: entry.evidenceHash,
      }))),
    },
  };
  aggregate.evidenceHash = digest(aggregate);

  assert.equal(aggregate.status, 'checked');
  assert.equal(aggregate.generated.readyCases, 10);
  assert.deepEqual(aggregate.generated.readyTiers, expectedTiers);
  assert.match(aggregate.evidenceHash, hashPattern);
  assertNoRawGeneratedFixtureValues(aggregate, 'RPP-0388 ready aggregate');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(aggregate, { label: 'RPP-0388 ready aggregate evidence' }));
});

test('RPP-0388 carries generated stale commentmeta comment cases as release verifier stop-before-mutation evidence', () => {
  const cases = generatePushHarnessCases();
  const staleCases = cases
    .filter((testCase) => testCase.tags.has('commentmeta-comment-graph'))
    .filter((testCase) => testCase.family === 'wp-comments-commentmeta-graph-stale');

  assert.equal(staleCases.length, 10, 'expected one stale commentmeta comment case per tier');
  assert.deepEqual(staleCases.map((testCase) => testCase.tier), expectedTiers);

  const staleEvidence = staleCases.map((testCase) => {
    const shape = assertGeneratedCommentmetaCommentShape(testCase, { staleTarget: true });
    const plan = generatedPlanFor(testCase);
    const validation = validateGeneratedCase(testCase);
    const proof = releaseVerifierBlockedProofFor(plan);
    const remoteBefore = cloneJson(testCase.remote);
    const beforeHash = digest(remoteBefore);
    const error = captureError(() => applyPlan(remoteBefore, plan));
    const afterHash = digest(remoteBefore);
    const evidence = summarizeStaleReleaseVerifierEvidence({
      testCase,
      plan,
      proof,
      shape,
      validation,
      beforeHash,
      afterHash,
      error,
    });

    assert.notEqual(plan.status, 'ready', `${testCase.id} should not be ready`);
    assert.notEqual(validation.status, 'ready', `${testCase.id} validation should not be ready`);
    assert.equal(evidence.status, 'checked', `${testCase.id} stale release verifier evidence should be checked`);
    assert.equal(evidence.verdict, 'COMMENTMETA_COMMENT_RELEASE_VERIFIER_STALE_STOPPED');
    assert.equal(evidence.releaseVerifier.dryRunAttempted, false);
    assert.equal(evidence.releaseVerifier.applyAttempted, false);
    assert.equal(evidence.graphIdentity.reference.relationshipKey, 'wp_commentmeta.comment_id');
    assert.equal(evidence.graphIdentity.reference.targetResourceKey, shape.commentResourceKey);
    assert.equal(evidence.refusal.remoteUnchanged, true);
    assert.match(evidence.evidenceHash, hashPattern);
    assertNoRawGeneratedFixtureValues(evidence, testCase.id);
    assert.doesNotThrow(() =>
      assertEvidenceHasNoRawValues(evidence, { label: `${testCase.id} stale release verifier evidence` }));
    return evidence;
  });

  const aggregate = {
    rpp: 'RPP-0388',
    evidenceSource: 'commentmeta-comment-reference-release-verifier-v5',
    status: staleEvidence.every((entry) => entry.status === 'checked') ? 'checked' : 'blocked',
    verdict: staleEvidence.every((entry) => entry.status === 'checked')
      ? 'COMMENTMETA_COMMENT_GENERATED_STALE_RELEASE_VERIFIER_STOPPED'
      : 'COMMENTMETA_COMMENT_GENERATED_STALE_RELEASE_VERIFIER_REQUIRED',
    generated: {
      requiredTag: 'commentmeta-comment-graph',
      staleCases: staleEvidence.length,
      staleTiers: [...new Set(staleEvidence.map((entry) => entry.tier))].sort((a, b) => a - b),
      stoppedBeforeDryRun: staleEvidence.every((entry) =>
        entry.releaseVerifier.dryRunAttempted === false
        && entry.releaseVerifier.applyAttempted === false),
      caseEvidenceHash: digest(staleEvidence.map((entry) => ({
        id: entry.id,
        tier: entry.tier,
        evidenceHash: entry.evidenceHash,
      }))),
    },
  };
  aggregate.evidenceHash = digest(aggregate);

  assert.equal(aggregate.status, 'checked');
  assert.equal(aggregate.generated.staleCases, 10);
  assert.deepEqual(aggregate.generated.staleTiers, expectedTiers);
  assert.equal(aggregate.generated.stoppedBeforeDryRun, true);
  assert.match(aggregate.evidenceHash, hashPattern);
  assertNoRawGeneratedFixtureValues(aggregate, 'RPP-0388 stale aggregate');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(aggregate, { label: 'RPP-0388 stale aggregate evidence' }));
});

test('RPP-0388 production-shaped release verifier contract revalidates planned resources before apply', () => {
  const verifierSource = fs.readFileSync(verifierPath, 'utf8');
  const authenticatedPushClientSource = fs.readFileSync(authenticatedPushClientPath, 'utf8');

  assert.match(verifierSource, /proof\.apply\.applyRevalidation\?\.phase, 'before-first-mutation'/);
  assert.match(verifierSource, /proof\.apply\.applyRevalidation\?\.checkedAgainst, 'live-remote'/);
  assert.match(verifierSource, /proof\.apply\.applyRevalidation\?\.planHash, digest\(proof\.planObject\)/);
  assert.match(verifierSource, /proof\.apply\.applyRevalidation\?\.verifiedCount, proof\.planObject\.mutations\.length/);
  assert.match(
    verifierSource,
    /proof\.apply\.applyRevalidation\?\.verifiedResourceKeys,[\s\S]*proof\.planObject\.mutations\.map\(\(mutation\) => mutation\.resourceKey\)/,
  );
  assert.equal(
    authenticatedPushClientSource.includes("summary.code = 'PLAN_NOT_READY_LOCALLY';"),
    true,
  );
  assert.equal(
    authenticatedPushClientSource.includes("if (plan.status !== 'ready')"),
    true,
  );
});
