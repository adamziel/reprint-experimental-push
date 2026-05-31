import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0773-apply-batch-sizing-v4';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const mutationCount = 17;
const applyBatchSize = 5;
const interruptedAfterCommittedChunks = 2;
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const expectedGateIds = Object.freeze([
  'deterministic-apply-batch-size',
  'ordered-transfer-chunks',
  'complete-mutation-coverage',
  'chunk-window-hashes-match',
  'deterministic-resume-evidence',
  'resume-skips-durable-chunks',
  'resume-applies-only-missing-chunks',
  'completed-resume-replay-skips-all-chunks',
  'no-duplicate-mutation-work',
  'storage-boundary-cas-before-resume-mutations',
  'hash-only-chunk-transfer-evidence',
  'runtime-resource-budget',
  'support-only-release-no-go',
]);
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

test('RPP-0773 variant 4 generated chunk transfer resume regression cases gate output', () => {
  const cases = generatedChunkTransferRegressionCases();
  const decisions = cases.map((chunkCase) => {
    const decision = resolveApplyBatchSizingChunkTransferProof(chunkCase.evidence, {
      repeatedEvidence: chunkCase.repeatedEvidence,
    });

    assert.equal(decision.updated, chunkCase.expected.updated, chunkCase.id);
    assert.equal(decision.outputEmitted, chunkCase.expected.updated, chunkCase.id);
    assert.equal(decision.correctnessGatesHold, chunkCase.expected.updated, chunkCase.id);
    assert.equal(decision.attemptedPassBlocked, !chunkCase.expected.updated, chunkCase.id);
    assert.equal(decision.output === null, !chunkCase.expected.updated, chunkCase.id);
    assert.deepEqual(decision.recomputedGates.map((gate) => gate.id), expectedGateIds, chunkCase.id);

    if (chunkCase.expected.updated) {
      assert.deepEqual(decision.recomputedGates.map((gate) => gate.status), [
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
        'pass',
      ], chunkCase.id);
      assert.deepEqual(decision.blockedBy, [], chunkCase.id);
      assert.match(decision.outputHash, sha256Pattern, chunkCase.id);
    } else {
      assert.equal(decision.outputHash, null, chunkCase.id);
      for (const blocker of chunkCase.expected.blockedBy) {
        assert.ok(decision.blockedBy.includes(blocker), `${chunkCase.id} missing ${blocker}`);
      }
    }

    assert.match(decision.decisionHash, hexSha256Pattern, chunkCase.id);
    assertHashOnlyChunkTransferEvidence(decision);
    return { ...decision, caseId: chunkCase.id };
  });
  const summary = generatedCoverageSummary(decisions);

  assert.equal(summary.caseCount, 10);
  assert.equal(summary.outputEmitted, 1);
  assert.equal(summary.blockedCaseCount, 9);
  assert.equal(summary.unsafeOutputs, 0);
  assert.equal(summary.blockerCounts['resume-skips-durable-chunks'], 2);
  assert.equal(summary.blockerCounts['completed-resume-replay-skips-all-chunks'], 1);
  assert.equal(summary.blockerCounts['no-duplicate-mutation-work'], 2);
  assert.equal(summary.blockerCounts['storage-boundary-cas-before-resume-mutations'], 1);
  assert.equal(summary.blockerCounts['hash-only-chunk-transfer-evidence'], 1);
  assert.equal(summary.blockerCounts['ordered-transfer-chunks'], 1);
  assert.equal(summary.blockerCounts['runtime-resource-budget'], 1);
  assert.equal(summary.blockerCounts['correctness-gates-not-recorded'], 1);
});

test('RPP-0773 variant 4 proves chunk transfer resumes without duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildVariant4Proof();

  assert.equal(proof.rppId, 'RPP-0773');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.generatedCoverage.source, 'local-support-generated-apply-batch-chunk-resume-regression-cases');
  assert.equal(proof.generatedCoverage.caseCount, 10);
  assert.equal(proof.generatedCoverage.outputEmitted, 1);
  assert.equal(proof.generatedCoverage.blockedCaseCount, 9);
  assert.equal(proof.generatedCoverage.unsafeOutputs, 0);

  assert.equal(proof.builtOn.rppId, 'RPP-0713');
  assert.equal(proof.builtOn.previousVariantRppId, 'RPP-0753');
  assert.equal(proof.builtOn.applyBatchSizing.mode, 'apply');
  assert.equal(proof.builtOn.applyBatchSizing.maxBatchSize, 500);
  assert.equal(proof.builtOn.applyBatchSizing.storageBoundary, 'per-mutation-storage-boundary-cas');
  assert.match(proof.builtOn.evidenceHash, hexSha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationMs, 0);
  assert.equal(proof.runtime.durationMs <= maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= maxHeapUsedBytes, true);
  assert.equal(proof.resources.apply.mutationCount, mutationCount);
  assert.equal(proof.resources.apply.applyBatchSize, applyBatchSize);
  assert.equal(proof.resources.apply.chunkCount, 4);

  assert.equal(proof.chunkTransfer.mutationCount, mutationCount);
  assert.equal(proof.chunkTransfer.applyBatchSize, applyBatchSize);
  assert.equal(proof.chunkTransfer.chunkCount, 4);
  assert.deepEqual(proof.chunkTransfer.chunkStarts, [0, 5, 10, 15]);
  assert.deepEqual(proof.chunkTransfer.chunkEnds, [4, 9, 14, 16]);
  assert.deepEqual(proof.chunkTransfer.chunkSizes, [5, 5, 5, 2]);
  assert.equal(proof.chunkTransfer.totalChunkMutations, mutationCount);
  assert.equal(proof.chunkTransfer.uniqueMutationIdHashes, mutationCount);
  assert.equal(proof.chunkTransfer.observedCoverageHash, proof.chunkTransfer.expectedCoverageHash);
  assert.match(proof.chunkTransfer.chunkCollectionHash, sha256Pattern);
  assert.ok(proof.chunkTransfer.chunkWindows.every((window) => window.mutationCount <= applyBatchSize));
  assert.ok(proof.chunkTransfer.chunkWindows.every((window) => window.chunkHash.match(sha256Pattern)));

  assert.equal(proof.firstAttempt.outcome, 'interrupted-after-committed-chunk');
  assert.deepEqual(proof.firstAttempt.committedChunkIndexes, [0, 1]);
  assert.equal(proof.firstAttempt.appliedMutationCount, 10);
  assert.equal(proof.firstAttempt.duplicateMutationWork, 0);
  assert.equal(proof.firstAttempt.durableChunkReceiptCount, 2);

  assert.equal(proof.resume.resumeMode, 'receipt-prefix-skip-then-apply-missing-chunks');
  assert.deepEqual(proof.resume.skippedChunkIndexes, [0, 1]);
  assert.equal(proof.resume.skippedMutationWork, 0);
  assert.equal(proof.resume.skippedMutations, 10);
  assert.deepEqual(proof.resume.appliedChunkIndexes, [2, 3]);
  assert.equal(proof.resume.appliedMutationsAfterResume, 7);
  assert.equal(proof.resume.finalAppliedMutations, mutationCount);
  assert.equal(proof.resume.duplicateMutationWork, 0);
  assert.equal(proof.resume.maxMutationWorkCount, 1);
  assert.equal(proof.resume.storageBoundaryFailures, 0);
  assert.ok(proof.resume.storageBoundaryChecks.every((check) => check.passed === true));

  assert.equal(proof.secondResume.resumeMode, 'receipt-prefix-skip-then-apply-missing-chunks');
  assert.deepEqual(proof.secondResume.skippedChunkIndexes, [0, 1, 2, 3]);
  assert.equal(proof.secondResume.skippedMutationWork, 0);
  assert.equal(proof.secondResume.skippedMutations, mutationCount);
  assert.deepEqual(proof.secondResume.appliedChunkIndexes, []);
  assert.equal(proof.secondResume.appliedMutationsAfterResume, 0);
  assert.equal(proof.secondResume.finalAppliedMutations, mutationCount);
  assert.equal(proof.secondResume.duplicateMutationWork, 0);
  assert.equal(proof.secondResume.maxMutationWorkCount, 1);
  assert.equal(proof.secondResume.storageBoundaryFailures, 0);
  assert.equal(proof.secondResume.receiptSetHashAfterResume, proof.resume.receiptSetHashAfterResume);

  assert.equal(proof.finalReplay.receiptSkips, 4);
  assert.equal(proof.finalReplay.mutationWork, 0);
  assert.equal(proof.finalReplay.duplicateMutationWork, 0);
  assert.equal(proof.finalReplay.applyBoundaryOpenedForReplay, false);

  assert.deepEqual(proof.correctness.gateIds, expectedGateIds);
  assert.deepEqual(proof.correctness.recomputedGateVector.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashOnlyChunkTransferOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.match(proof.resume.outputHash, sha256Pattern);

  assert.equal(proof.unsafe.staleChunkReceipt.updated, false);
  assert.equal(proof.unsafe.staleChunkReceipt.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.staleChunkReceipt.blockedBy.includes('resume-skips-durable-chunks'));
  assert.equal(proof.unsafe.missingCommittedReceipt.updated, false);
  assert.equal(proof.unsafe.missingCommittedReceipt.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingCommittedReceipt.blockedBy.includes('resume-skips-durable-chunks'));
  assert.equal(proof.unsafe.duplicateMutationWork.updated, false);
  assert.equal(proof.unsafe.duplicateMutationWork.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
  assert.equal(proof.unsafe.completedResumeDuplicateWork.updated, false);
  assert.equal(proof.unsafe.completedResumeDuplicateWork.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.completedResumeDuplicateWork.blockedBy.includes('completed-resume-replay-skips-all-chunks'));
  assert.ok(proof.unsafe.completedResumeDuplicateWork.blockedBy.includes('no-duplicate-mutation-work'));
  assert.equal(proof.unsafe.driftedResumeStorage.updated, false);
  assert.equal(proof.unsafe.driftedResumeStorage.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.driftedResumeStorage.blockedBy.includes('storage-boundary-cas-before-resume-mutations'));
  assert.equal(proof.unsafe.rawValueLeak.updated, false);
  assert.equal(proof.unsafe.rawValueLeak.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.rawValueLeak.blockedBy.includes('hash-only-chunk-transfer-evidence'));
  assert.equal(proof.unsafe.outOfOrderChunk.updated, false);
  assert.equal(proof.unsafe.outOfOrderChunk.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.outOfOrderChunk.blockedBy.includes('ordered-transfer-chunks'));
  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.equal(proof.unsafe.overBudget.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.overBudget.blockedBy.includes('runtime-resource-budget'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.equal(proof.unsafe.prematurePassStatus.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashOnlyChunkTransferEvidence(proof);
});

function buildVariant4Proof() {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveApplyBatchSizingChunkTransferProof(evidence, { repeatedEvidence });
  const generatedDecisions = generatedChunkTransferRegressionCases().map((chunkCase) => ({
    caseId: chunkCase.id,
    ...resolveApplyBatchSizingChunkTransferProof(chunkCase.evidence, {
      repeatedEvidence: chunkCase.repeatedEvidence,
    }),
  }));
  const generatedCoverage = {
    source: 'local-support-generated-apply-batch-chunk-resume-regression-cases',
    ...generatedCoverageSummary(generatedDecisions),
  };
  const unsafe = projectGeneratedUnsafeDecisions(generatedDecisions);
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'chunkTransfer',
  );
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('chunk-transfer-resume-without-duplicate-mutation-work', safeDecision.updated
      && safeDecision.outputEmitted
      && evidence.resume.duplicateMutationWork === 0
      && evidence.secondResume.duplicateMutationWork === 0
      && evidence.finalReplay.duplicateMutationWork === 0, {
      duplicateMutationWork: evidence.resume.duplicateMutationWork,
      completedResumeDuplicateMutationWork: evidence.secondResume.duplicateMutationWork,
      finalReplayDuplicateMutationWork: evidence.finalReplay.duplicateMutationWork,
      outputEmitted: safeDecision.outputEmitted,
    }),
    proofGate('completed-resume-replay-is-skip-only', evidence.secondResume.skippedChunkIndexes.length === evidence.chunkTransfer.chunkCount
      && evidence.secondResume.appliedChunkIndexes.length === 0
      && evidence.secondResume.appliedMutationsAfterResume === 0
      && evidence.secondResume.receiptSetHashAfterResume === evidence.resume.receiptSetHashAfterResume, {
      skippedChunkIndexes: evidence.secondResume.skippedChunkIndexes,
      appliedChunkIndexes: evidence.secondResume.appliedChunkIndexes,
      appliedMutationsAfterResume: evidence.secondResume.appliedMutationsAfterResume,
      receiptSetStable: evidence.secondResume.receiptSetHashAfterResume === evidence.resume.receiptSetHashAfterResume,
    }),
    proofGate('correctness-gates-before-output', correctnessGatesRecordedBeforeOutput
      && safeDecision.correctnessGatesHold
      && safeDecision.hashOnlyChunkTransferOutput, {
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHold: safeDecision.correctnessGatesHold,
      hashOnlyChunkTransferOutput: safeDecision.hashOnlyChunkTransferOutput,
    }),
    proofGate('generated-unsafe-chunk-transfer-regression-cases-fail-closed',
      generatedCoverage.caseCount === 10
        && generatedCoverage.outputEmitted === 1
        && generatedCoverage.blockedCaseCount === 9
        && generatedCoverage.unsafeOutputs === 0
        && Object.values(unsafe).every((decision) => (
          decision.updated === false
          && decision.outputEmitted === false
          && decision.attemptedPassBlocked === true
        )), {
      caseIds: generatedCoverage.caseIds,
      blockerCounts: generatedCoverage.blockerCounts,
      decisionHashes: generatedCoverage.decisionHashes,
    }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicProof = {
    rppId: 'RPP-0773',
    proofId,
    variant: 4,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    generatedCoverage,
    builtOn: applyBatchSizingContract(),
    runtime: evidence.runtime,
    resources: evidence.resources,
    chunkTransfer: {
      ...evidence.chunkTransfer,
      outputHash: safeDecision.outputHash,
    },
    firstAttempt: evidence.firstAttempt,
    resume: {
      ...evidence.resume,
      outputHash: safeDecision.outputHash,
    },
    secondResume: evidence.secondResume,
    finalReplay: evidence.finalReplay,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyChunkTransferOutput: safeDecision.hashOnlyChunkTransferOutput,
      outputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-and-count-only-apply-batch-completed-chunk-resume',
      rawValueEvidenceLeaks: chunkTransferEvidenceHasNoRawValues(evidence) ? 0 : 1,
      firstEvidenceHash: digest(publicChunkTransferEvidenceProjection(evidence)),
      repeatedEvidenceHash: digest(publicChunkTransferEvidenceProjection(repeatedEvidence)),
      decisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function generatedChunkTransferRegressionCases() {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeEvidence = withPassedStatus(clone(evidence));
  const staleChunkReceipt = withPassedStatus(clone(evidence));
  staleChunkReceipt.resume.chunkReceiptsBeforeResume[0].chunkHash = sha256('stale-chunk-receipt-v4');
  const missingCommittedReceipt = withPassedStatus(clone(evidence));
  missingCommittedReceipt.resume.chunkReceiptsBeforeResume.splice(1, 1);
  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.resume.duplicateMutationWork = 1;
  duplicateMutationWork.resume.mutationWorkCounts[0].totalWork = 2;
  duplicateMutationWork.resume.maxMutationWorkCount = 2;
  const completedResumeDuplicateWork = withPassedStatus(clone(evidence));
  completedResumeDuplicateWork.secondResume.appliedChunkIndexes = [0];
  completedResumeDuplicateWork.secondResume.appliedMutationsAfterResume = applyBatchSize;
  completedResumeDuplicateWork.secondResume.skippedChunkIndexes = [1, 2, 3];
  completedResumeDuplicateWork.secondResume.skippedMutations = mutationCount - applyBatchSize;
  completedResumeDuplicateWork.secondResume.duplicateMutationWork = applyBatchSize;
  completedResumeDuplicateWork.secondResume.mutationWorkCounts[0].totalWork = 2;
  completedResumeDuplicateWork.secondResume.maxMutationWorkCount = 2;
  const driftedResumeStorage = withPassedStatus(clone(evidence));
  driftedResumeStorage.resume.storageBoundaryChecks[0].actualBeforeHash = sha256('drifted-resume-storage-v4');
  driftedResumeStorage.resume.storageBoundaryChecks[0].passed = false;
  driftedResumeStorage.resume.storageBoundaryFailures = 1;
  const rawValueLeak = withPassedStatus(clone(evidence));
  rawValueLeak.resume.rawResourceKey = 'fixture-resource-unsafe-leak';
  const outOfOrderChunk = withPassedStatus(clone(evidence));
  outOfOrderChunk.chunkTransfer.chunkWindows[1].firstSequence = 12;
  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = maxDurationMs + 1;
  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return [
    {
      id: 'receipt-prefix-resume',
      evidence: safeEvidence,
      repeatedEvidence,
      expected: { updated: true, blockedBy: [] },
    },
    {
      id: 'stale-chunk-receipt',
      evidence: staleChunkReceipt,
      repeatedEvidence,
      expected: { updated: false, blockedBy: ['resume-skips-durable-chunks'] },
    },
    {
      id: 'missing-committed-receipt',
      evidence: missingCommittedReceipt,
      repeatedEvidence,
      expected: { updated: false, blockedBy: ['resume-skips-durable-chunks'] },
    },
    {
      id: 'duplicate-mutation-work',
      evidence: duplicateMutationWork,
      repeatedEvidence,
      expected: { updated: false, blockedBy: ['no-duplicate-mutation-work'] },
    },
    {
      id: 'completed-resume-duplicate-work',
      evidence: completedResumeDuplicateWork,
      repeatedEvidence,
      expected: {
        updated: false,
        blockedBy: [
          'completed-resume-replay-skips-all-chunks',
          'no-duplicate-mutation-work',
        ],
      },
    },
    {
      id: 'drifted-resume-storage',
      evidence: driftedResumeStorage,
      repeatedEvidence,
      expected: { updated: false, blockedBy: ['storage-boundary-cas-before-resume-mutations'] },
    },
    {
      id: 'raw-value-leak',
      evidence: rawValueLeak,
      repeatedEvidence,
      expected: { updated: false, blockedBy: ['hash-only-chunk-transfer-evidence'] },
    },
    {
      id: 'out-of-order-chunk',
      evidence: outOfOrderChunk,
      repeatedEvidence,
      expected: { updated: false, blockedBy: ['ordered-transfer-chunks'] },
    },
    {
      id: 'over-budget',
      evidence: overBudget,
      repeatedEvidence,
      expected: { updated: false, blockedBy: ['runtime-resource-budget'] },
    },
    {
      id: 'premature-pass-status',
      evidence: prematurePassStatus,
      repeatedEvidence,
      expected: { updated: false, blockedBy: ['correctness-gates-not-recorded'] },
    },
  ];
}

function buildRecordedEvidencePair() {
  const evidence = buildChunkTransferEvidence(runChunkTransferScenario());
  const repeatedEvidence = buildChunkTransferEvidence(runChunkTransferScenario());

  recordCorrectnessGates(evidence, repeatedEvidence);
  recordCorrectnessGates(repeatedEvidence, evidence);
  return { evidence, repeatedEvidence };
}

function runChunkTransferScenario() {
  const mutations = buildFixtureMutations();
  const chunkTransfer = collectChunkTransferEvidence({ mutations, batchSize: applyBatchSize });
  const mutationByHash = new Map(mutations.map((mutation) => [mutation.mutationIdHash, mutation]));
  const storage = new Map(mutations.map((mutation) => [mutation.mutationIdHash, mutation.beforeHash]));
  const mutationWork = new Map(mutations.map((mutation) => [mutation.mutationIdHash, 0]));
  const firstAttemptReceipts = [];
  let appliedMutationCount = 0;

  for (const window of chunkTransfer.chunkWindows.slice(0, interruptedAfterCommittedChunks)) {
    const result = applyChunkWindow({ window, mutationByHash, storage, mutationWork });
    appliedMutationCount += result.appliedMutationCount;
    firstAttemptReceipts.push(result.receipt);
  }

  const resume = resumeChunkTransfer({
    chunkTransfer,
    mutationByHash,
    storage,
    mutationWork,
    receiptsBeforeResume: firstAttemptReceipts,
  });
  const secondResume = resumeChunkTransfer({
    chunkTransfer,
    mutationByHash,
    storage,
    mutationWork,
    receiptsBeforeResume: resume.receiptsAfterResume,
  });
  const finalReplay = replayCompletedTransfer({
    chunkTransfer,
    storage,
    receipts: secondResume.receiptsAfterResume,
  });

  return {
    chunkTransfer,
    firstAttempt: {
      outcome: 'interrupted-after-committed-chunk',
      interruptedBeforeChunkIndex: interruptedAfterCommittedChunks,
      committedChunkCount: interruptedAfterCommittedChunks,
      committedChunkIndexes: chunkTransfer.chunkWindows
        .slice(0, interruptedAfterCommittedChunks)
        .map((window) => window.chunkIndex),
      appliedMutationCount,
      duplicateMutationWork: duplicateMutationWorkCount(mutationWork),
      durableChunkReceiptCount: firstAttemptReceipts.length,
      durableReceiptSetHash: sha256(firstAttemptReceipts.map((receipt) => receipt.receiptHash)),
    },
    resume: resume.publicResume,
    secondResume: secondResume.publicResume,
    finalReplay,
    runtime: {
      generatedAt: fixedNow.toISOString(),
      durationMs: 0,
      budgets: {
        maxDurationMs,
        maxHeapUsedBytes,
      },
    },
    resources: {
      apply: {
        mutationCount,
        applyBatchSize,
        chunkCount: chunkTransfer.chunkCount,
        firstAttemptCommittedChunks: interruptedAfterCommittedChunks,
        resumedChunkCount: resume.publicResume.appliedChunkIndexes.length,
        completedResumeReceiptSkips: secondResume.publicResume.skippedChunkIndexes.length,
        finalReplayReceiptSkips: finalReplay.receiptSkips,
      },
      process: {
        heapUsedBytes: 16 * 1024 * 1024,
      },
    },
  };
}

function buildChunkTransferEvidence(scenario) {
  return {
    schemaVersion: 1,
    rppId: 'RPP-0773',
    proofId,
    variant: 4,
    status: 'pending',
    builtOn: applyBatchSizingContract(),
    correctnessGates: [],
    chunkTransfer: scenario.chunkTransfer,
    firstAttempt: scenario.firstAttempt,
    resume: scenario.resume,
    secondResume: scenario.secondResume,
    finalReplay: scenario.finalReplay,
    runtime: scenario.runtime,
    resources: scenario.resources,
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeApplyBatchSizingGates(evidence, repeatedEvidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function collectChunkTransferEvidence({ mutations, batchSize }) {
  const chunkWindows = [];
  for (let offset = 0; offset < mutations.length; offset += batchSize) {
    const entries = mutations.slice(offset, offset + batchSize);
    chunkWindows.push(chunkWindowSummary({
      entries,
      chunkIndex: chunkWindows.length,
      mutationOffset: offset,
      chunkCount: Math.ceil(mutations.length / batchSize),
    }));
  }

  const expectedMutationIdHashes = mutations.map((mutation) => mutation.mutationIdHash);
  const observedMutationIdHashes = chunkWindows.flatMap((window) => window.mutationIdHashes);
  const collectionCore = {
    planHash: sha256({
      proofId,
      mutationIdHashes: expectedMutationIdHashes,
      applyBatchSize: batchSize,
    }),
    mutationCount: mutations.length,
    applyBatchSize: batchSize,
    maxBatchSize: 500,
    chunkCount: chunkWindows.length,
    expectedChunkCount: Math.ceil(mutations.length / batchSize),
    chunkStarts: chunkWindows.map((window) => window.firstSequence),
    chunkEnds: chunkWindows.map((window) => window.lastSequence),
    chunkSizes: chunkWindows.map((window) => window.mutationCount),
    totalChunkMutations: chunkWindows.reduce((sum, window) => sum + window.mutationCount, 0),
    uniqueMutationIdHashes: new Set(observedMutationIdHashes).size,
    expectedCoverageHash: sha256(expectedMutationIdHashes),
    observedCoverageHash: sha256(observedMutationIdHashes),
    applyBoundary: {
      revalidation: 'fresh-live-hashes-before-each-batch',
      storageBoundary: 'per-mutation-storage-boundary-cas',
      resumePolicy: 'exact-chunk-receipt-skips-committed-prefix-and-completed-replay',
    },
    chunkWindows,
  };

  return {
    ...collectionCore,
    chunkCollectionHash: sha256(collectionCore),
  };
}

function chunkWindowSummary({ entries, chunkIndex, mutationOffset, chunkCount }) {
  const mutationIdHashes = entries.map((mutation) => mutation.mutationIdHash);
  const resourceKeyHashes = entries.map((mutation) => mutation.resourceKeyHash);
  const core = {
    chunkIndex,
    chunkIdHash: sha256(`apply-transfer-chunk-v4-${chunkIndex + 1}`),
    chunkCount,
    mutationOffset,
    mutationCount: entries.length,
    firstSequence: entries[0].sequence,
    lastSequence: entries.at(-1).sequence,
    lastChunk: chunkIndex === chunkCount - 1,
    mutationIdHashes,
    resourceKeyHashes,
    beforeHashSetHash: sha256(entries.map((mutation) => mutation.beforeHash)),
    afterHashSetHash: sha256(entries.map((mutation) => mutation.afterHash)),
    estimatedBytes: entries.reduce((sum, mutation) => sum + mutation.estimatedBytes, 0),
  };

  return {
    ...core,
    chunkHash: sha256(core),
  };
}

function applyChunkWindow({ window, mutationByHash, storage, mutationWork }) {
  const storageBoundaryChecks = [];
  for (const mutationIdHash of window.mutationIdHashes) {
    const mutation = mutationByHash.get(mutationIdHash);
    const actualBeforeHash = storage.get(mutationIdHash);
    const passed = actualBeforeHash === mutation.beforeHash;
    storageBoundaryChecks.push({
      chunkIndex: window.chunkIndex,
      mutationIdHash,
      expectedBeforeHash: mutation.beforeHash,
      actualBeforeHash,
      plannedAfterHash: mutation.afterHash,
      passed,
    });
    assert.equal(passed, true, `fixture storage drift before chunk ${window.chunkIndex}`);
    storage.set(mutationIdHash, mutation.afterHash);
    mutationWork.set(mutationIdHash, (mutationWork.get(mutationIdHash) || 0) + 1);
  }

  return {
    appliedMutationCount: window.mutationCount,
    receipt: receiptForChunkWindow(window),
    storageBoundaryChecks,
  };
}

function resumeChunkTransfer({
  chunkTransfer,
  mutationByHash,
  storage,
  mutationWork,
  receiptsBeforeResume,
}) {
  const receiptsAfterResume = [...receiptsBeforeResume];
  const skippedChunkIndexes = [];
  const appliedChunkIndexes = [];
  const storageBoundaryChecks = [];
  let skippedMutations = 0;
  let appliedMutationsAfterResume = 0;

  for (const window of chunkTransfer.chunkWindows) {
    const receipt = receiptsAfterResume.find((candidate) => candidate.chunkIndex === window.chunkIndex);
    if (receipt && receiptMatchesChunkWindow(receipt, window)) {
      assert.equal(window.mutationIdHashes.every((mutationIdHash) => {
        const mutation = mutationByHash.get(mutationIdHash);
        return storage.get(mutationIdHash) === mutation.afterHash;
      }), true, `committed chunk ${window.chunkIndex} storage must match the receipt`);
      skippedChunkIndexes.push(window.chunkIndex);
      skippedMutations += window.mutationCount;
      continue;
    }

    assert.equal(window.mutationIdHashes.every((mutationIdHash) => {
      const mutation = mutationByHash.get(mutationIdHash);
      return storage.get(mutationIdHash) === mutation.beforeHash;
    }), true, `unreceipted chunk ${window.chunkIndex} must still be old before resume applies it`);

    const result = applyChunkWindow({ window, mutationByHash, storage, mutationWork });
    appliedChunkIndexes.push(window.chunkIndex);
    appliedMutationsAfterResume += result.appliedMutationCount;
    storageBoundaryChecks.push(...result.storageBoundaryChecks);
    receiptsAfterResume.push(result.receipt);
  }

  const mutationWorkCounts = [...mutationWork.entries()].map(([mutationIdHash, totalWork]) => ({
    mutationIdHash,
    totalWork,
  }));
  const finalAppliedMutations = [...storage.entries()]
    .filter(([mutationIdHash, currentHash]) => currentHash === mutationByHash.get(mutationIdHash).afterHash)
    .length;

  return {
    receiptsAfterResume,
    publicResume: {
      resumeMode: 'receipt-prefix-skip-then-apply-missing-chunks',
      chunkReceiptsBeforeResume: receiptsBeforeResume,
      chunkReceiptsAfterResume: receiptsAfterResume,
      skippedChunkIndexes,
      skippedMutations,
      skippedMutationWork: 0,
      appliedChunkIndexes,
      appliedMutationsAfterResume,
      finalAppliedMutations,
      mutationWorkCounts,
      maxMutationWorkCount: Math.max(...mutationWorkCounts.map((entry) => entry.totalWork)),
      duplicateMutationWork: duplicateMutationWorkCount(mutationWork),
      storageBoundaryChecks,
      storageBoundaryFailures: storageBoundaryChecks.filter((check) => check.passed !== true).length,
      finalStorageHash: sha256([...storage.entries()].sort(([left], [right]) => left.localeCompare(right))),
      receiptSetHashAfterResume: sha256(receiptsAfterResume.map((receipt) => receipt.receiptHash)),
    },
  };
}

function replayCompletedTransfer({ chunkTransfer, storage, receipts }) {
  let receiptSkips = 0;
  for (const window of chunkTransfer.chunkWindows) {
    const receipt = receipts.find((candidate) => candidate.chunkIndex === window.chunkIndex);
    if (receipt && receiptMatchesChunkWindow(receipt, window)) {
      receiptSkips += 1;
    }
  }

  return {
    replayMode: 'completed-apply-transfer-replay',
    receiptSkips,
    mutationWork: 0,
    duplicateMutationWork: 0,
    applyBoundaryOpenedForReplay: false,
    receiptSetHash: sha256(receipts.map((receipt) => receipt.receiptHash)),
    storageHash: sha256([...storage.entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

function resolveApplyBatchSizingChunkTransferProof(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeApplyBatchSizingGates(evidence, repeatedEvidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedGateIds);
  const recordedGateStatusesHold = recordedGateIdsComplete
    && evidence.correctnessGates.every((gate) => gate.status === 'passed');
  const blockedBy = unique([
    ...failedGateIds,
    ...(!recordedGateIdsComplete ? ['correctness-gates-not-recorded'] : []),
    ...(!recordedGateStatusesHold ? ['correctness-gates-not-passed'] : []),
  ]);
  const correctnessGatesHold = blockedBy.length === 0;
  const output = correctnessGatesHold
    ? {
        proofId,
        gateVectorHash: sha256(recomputedGates),
        chunkCollectionHash: evidence.chunkTransfer.chunkCollectionHash,
        committedReceiptSetHash: evidence.firstAttempt.durableReceiptSetHash,
        resumedReceiptSetHash: evidence.resume.receiptSetHashAfterResume,
        completedResumeReceiptSetHash: evidence.secondResume.receiptSetHashAfterResume,
        finalReplayReceiptSetHash: evidence.finalReplay.receiptSetHash,
        duplicateMutationWork: evidence.resume.duplicateMutationWork
          + evidence.secondResume.duplicateMutationWork
          + evidence.finalReplay.duplicateMutationWork,
        finalReleaseStatus: evidence.release.finalReleaseStatus,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: evidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    hashOnlyChunkTransferOutput: output ? chunkTransferEvidenceHasNoRawValues(output) : false,
    blockedBy,
    recomputedGates,
    outputHash: output ? sha256(output) : null,
  };

  return {
    ...publicDecision,
    output,
    decisionHash: digest(publicDecision),
  };
}

function recomputeApplyBatchSizingGates(evidence, repeatedEvidence) {
  const collection = evidence.chunkTransfer || {};
  const windows = Array.isArray(collection.chunkWindows) ? collection.chunkWindows : [];
  const order = chunkWindowOrderMetrics(windows);
  const coverage = chunkCoverageMetrics(collection, windows);
  const hashMismatches = windows
    .filter((window) => window.chunkHash !== sha256(chunkWindowCore(window)))
    .map((window) => window.chunkIndex);
  const chunkCollectionHashMatches = collection.chunkCollectionHash === sha256(chunkCollectionCore(collection));
  const deterministicEvidence = Boolean(repeatedEvidence)
    && digest(publicChunkTransferEvidenceProjection(evidence)) === digest(publicChunkTransferEvidenceProjection(repeatedEvidence));
  const resumeSkip = resumeSkipMetrics(evidence, windows);
  const resumeApply = resumeApplyMetrics(evidence, windows);
  const completedResume = completedResumeMetrics(evidence, windows);
  const duplicateWork = duplicateWorkMetrics(evidence);
  const storageBoundary = storageBoundaryMetrics(evidence);
  const runtime = evidence.runtime || {};
  const processResources = evidence.resources?.process || {};
  const release = evidence.release || {};

  return [
    proofGate('deterministic-apply-batch-size', Number.isInteger(collection.applyBatchSize)
      && collection.applyBatchSize === applyBatchSize
      && collection.maxBatchSize === 500
      && windows.length === collection.expectedChunkCount
      && windows.every((window, index) => {
        const expectedSize = index === windows.length - 1
          ? collection.mutationCount - (collection.applyBatchSize * index)
          : collection.applyBatchSize;
        return window.mutationCount === expectedSize
          && window.mutationCount > 0
          && window.mutationCount <= collection.applyBatchSize;
      }), {
      applyBatchSize: collection.applyBatchSize,
      maxBatchSize: collection.maxBatchSize,
      expectedChunkCount: collection.expectedChunkCount,
      chunkSizes: windows.map((window) => window.mutationCount),
    }),
    proofGate('ordered-transfer-chunks', order.ordered, order),
    proofGate('complete-mutation-coverage', coverage.complete, coverage),
    proofGate('chunk-window-hashes-match', hashMismatches.length === 0 && chunkCollectionHashMatches, {
      mismatchedChunkIndexes: hashMismatches,
      chunkCollectionHashMatches,
    }),
    proofGate('deterministic-resume-evidence', deterministicEvidence, {
      firstEvidenceHash: digest(publicChunkTransferEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicChunkTransferEvidenceProjection(repeatedEvidence)) : '',
    }),
    proofGate('resume-skips-durable-chunks', resumeSkip.safe, resumeSkip),
    proofGate('resume-applies-only-missing-chunks', resumeApply.safe, resumeApply),
    proofGate('completed-resume-replay-skips-all-chunks', completedResume.safe, completedResume),
    proofGate('no-duplicate-mutation-work', duplicateWork.safe, duplicateWork),
    proofGate('storage-boundary-cas-before-resume-mutations', storageBoundary.safe, storageBoundary),
    proofGate('hash-only-chunk-transfer-evidence', chunkTransferEvidenceHasNoRawValues({
      chunkTransfer: collection,
      firstAttempt: evidence.firstAttempt,
      resume: evidence.resume,
      secondResume: evidence.secondResume,
      finalReplay: evidence.finalReplay,
    }), {
      rawValueEvidenceLeaks: chunkTransferEvidenceHasNoRawValues({
        chunkTransfer: collection,
        firstAttempt: evidence.firstAttempt,
        resume: evidence.resume,
        secondResume: evidence.secondResume,
        finalReplay: evidence.finalReplay,
      }) ? 0 : 1,
    }),
    proofGate('runtime-resource-budget', runtime.durationMs <= runtime.budgets?.maxDurationMs
      && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes, {
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO', {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function chunkWindowOrderMetrics(windows) {
  let expectedStart = 0;
  let indexMismatchCount = 0;
  let startMismatchCount = 0;
  let endMismatchCount = 0;
  let emptyWindowCount = 0;

  windows.forEach((window, index) => {
    if (window.chunkIndex !== index) {
      indexMismatchCount += 1;
    }
    if (window.firstSequence !== expectedStart) {
      startMismatchCount += 1;
    }
    if (window.lastSequence !== window.firstSequence + window.mutationCount - 1) {
      endMismatchCount += 1;
    }
    if (window.mutationCount <= 0) {
      emptyWindowCount += 1;
    }
    expectedStart = window.lastSequence + 1;
  });

  return {
    ordered: indexMismatchCount === 0
      && startMismatchCount === 0
      && endMismatchCount === 0
      && emptyWindowCount === 0,
    indexMismatchCount,
    startMismatchCount,
    endMismatchCount,
    emptyWindowCount,
    terminalSequence: windows.at(-1)?.lastSequence ?? null,
  };
}

function chunkCoverageMetrics(collection, windows) {
  const observedMutationIdHashes = windows.flatMap((window) => window.mutationIdHashes || []);
  const uniqueMutationIdHashes = new Set(observedMutationIdHashes).size;
  const recomputedObservedCoverageHash = sha256(observedMutationIdHashes);
  const expectedChunkCount = Math.ceil(collection.mutationCount / collection.applyBatchSize);
  const complete = windows.length === collection.chunkCount
    && windows.length === expectedChunkCount
    && collection.expectedChunkCount === expectedChunkCount
    && observedMutationIdHashes.length === collection.mutationCount
    && uniqueMutationIdHashes === collection.mutationCount
    && collection.uniqueMutationIdHashes === uniqueMutationIdHashes
    && collection.totalChunkMutations === observedMutationIdHashes.length
    && collection.observedCoverageHash === recomputedObservedCoverageHash
    && collection.observedCoverageHash === collection.expectedCoverageHash;

  return {
    complete,
    chunkCount: windows.length,
    recordedChunkCount: collection.chunkCount,
    expectedChunkCount,
    observedMutationIdHashes: observedMutationIdHashes.length,
    uniqueMutationIdHashes,
    recomputedObservedCoverageHash,
    recordedObservedCoverageHash: collection.observedCoverageHash,
    expectedCoverageHash: collection.expectedCoverageHash,
  };
}

function resumeSkipMetrics(evidence, windows) {
  const committedChunkIndexes = evidence.firstAttempt?.committedChunkIndexes || [];
  const receipts = evidence.resume?.chunkReceiptsBeforeResume || [];
  const exactReceiptIndexes = receipts
    .filter((receipt) => receiptMatchesChunkWindow(receipt, windows[receipt.chunkIndex]))
    .map((receipt) => receipt.chunkIndex);
  const expectedSkippedMutations = committedChunkIndexes
    .reduce((sum, index) => sum + windows[index].mutationCount, 0);
  const safe = sameArray(exactReceiptIndexes, committedChunkIndexes)
    && sameArray(evidence.resume?.skippedChunkIndexes || [], committedChunkIndexes)
    && evidence.resume?.skippedMutations === expectedSkippedMutations
    && evidence.resume?.skippedMutationWork === 0
    && evidence.firstAttempt?.durableChunkReceiptCount === committedChunkIndexes.length;

  return {
    safe,
    committedChunkIndexes,
    exactReceiptIndexes,
    skippedChunkIndexes: evidence.resume?.skippedChunkIndexes || [],
    expectedSkippedMutations,
    skippedMutations: evidence.resume?.skippedMutations,
    skippedMutationWork: evidence.resume?.skippedMutationWork,
    durableChunkReceiptCount: evidence.firstAttempt?.durableChunkReceiptCount,
  };
}

function resumeApplyMetrics(evidence, windows) {
  const committed = new Set(evidence.firstAttempt?.committedChunkIndexes || []);
  const expectedAppliedChunkIndexes = windows
    .filter((window) => !committed.has(window.chunkIndex))
    .map((window) => window.chunkIndex);
  const expectedAppliedMutations = expectedAppliedChunkIndexes
    .reduce((sum, index) => sum + windows[index].mutationCount, 0);
  const finalReplay = evidence.finalReplay || {};
  const safe = sameArray(evidence.resume?.appliedChunkIndexes || [], expectedAppliedChunkIndexes)
    && evidence.resume?.appliedMutationsAfterResume === expectedAppliedMutations
    && evidence.resume?.finalAppliedMutations === evidence.chunkTransfer?.mutationCount
    && finalReplay.receiptSkips === evidence.chunkTransfer?.chunkCount
    && finalReplay.mutationWork === 0
    && finalReplay.applyBoundaryOpenedForReplay === false;

  return {
    safe,
    expectedAppliedChunkIndexes,
    appliedChunkIndexes: evidence.resume?.appliedChunkIndexes || [],
    expectedAppliedMutations,
    appliedMutationsAfterResume: evidence.resume?.appliedMutationsAfterResume,
    finalAppliedMutations: evidence.resume?.finalAppliedMutations,
    finalReplayReceiptSkips: finalReplay.receiptSkips,
    finalReplayMutationWork: finalReplay.mutationWork,
  };
}

function completedResumeMetrics(evidence, windows) {
  const secondResume = evidence.secondResume || {};
  const receiptsBeforeResume = secondResume.chunkReceiptsBeforeResume || [];
  const receiptsAfterResume = secondResume.chunkReceiptsAfterResume || [];
  const expectedSkippedChunkIndexes = windows.map((window) => window.chunkIndex);
  const exactReceiptIndexes = receiptsBeforeResume
    .filter((receipt) => receiptMatchesChunkWindow(receipt, windows[receipt.chunkIndex]))
    .map((receipt) => receipt.chunkIndex);
  const expectedSkippedMutations = windows.reduce((sum, window) => sum + window.mutationCount, 0);
  const beforeReceiptSetHash = sha256(receiptsBeforeResume.map((receipt) => receipt.receiptHash));
  const afterReceiptSetHash = sha256(receiptsAfterResume.map((receipt) => receipt.receiptHash));
  const safe = sameArray(exactReceiptIndexes, expectedSkippedChunkIndexes)
    && sameArray(secondResume.skippedChunkIndexes || [], expectedSkippedChunkIndexes)
    && secondResume.skippedMutations === expectedSkippedMutations
    && secondResume.skippedMutationWork === 0
    && sameArray(secondResume.appliedChunkIndexes || [], [])
    && secondResume.appliedMutationsAfterResume === 0
    && secondResume.finalAppliedMutations === evidence.chunkTransfer?.mutationCount
    && secondResume.duplicateMutationWork === 0
    && secondResume.maxMutationWorkCount === 1
    && secondResume.storageBoundaryFailures === 0
    && beforeReceiptSetHash === afterReceiptSetHash
    && secondResume.receiptSetHashAfterResume === evidence.resume?.receiptSetHashAfterResume;

  return {
    safe,
    exactReceiptIndexes,
    expectedSkippedChunkIndexes,
    skippedChunkIndexes: secondResume.skippedChunkIndexes || [],
    expectedSkippedMutations,
    skippedMutations: secondResume.skippedMutations,
    skippedMutationWork: secondResume.skippedMutationWork,
    appliedChunkIndexes: secondResume.appliedChunkIndexes || [],
    appliedMutationsAfterResume: secondResume.appliedMutationsAfterResume,
    duplicateMutationWork: secondResume.duplicateMutationWork,
    storageBoundaryFailures: secondResume.storageBoundaryFailures,
    receiptSetStable: beforeReceiptSetHash === afterReceiptSetHash,
  };
}

function duplicateWorkMetrics(evidence) {
  const resumeCounts = evidence.resume?.mutationWorkCounts || [];
  const completedResumeCounts = evidence.secondResume?.mutationWorkCounts || [];
  const resumeTotalWork = resumeCounts.reduce((sum, entry) => sum + entry.totalWork, 0);
  const completedResumeTotalWork = completedResumeCounts.reduce((sum, entry) => sum + entry.totalWork, 0);
  const resumeDuplicateEntries = resumeCounts.filter((entry) => entry.totalWork > 1).length;
  const completedResumeDuplicateEntries = completedResumeCounts.filter((entry) => entry.totalWork > 1).length;
  const safe = resumeCounts.length === evidence.chunkTransfer?.mutationCount
    && completedResumeCounts.length === evidence.chunkTransfer?.mutationCount
    && resumeTotalWork === evidence.chunkTransfer?.mutationCount
    && completedResumeTotalWork === evidence.chunkTransfer?.mutationCount
    && resumeDuplicateEntries === 0
    && completedResumeDuplicateEntries === 0
    && evidence.resume?.duplicateMutationWork === 0
    && evidence.secondResume?.duplicateMutationWork === 0
    && evidence.resume?.maxMutationWorkCount === 1
    && evidence.secondResume?.maxMutationWorkCount === 1
    && evidence.finalReplay?.duplicateMutationWork === 0;

  return {
    safe,
    resumeMutationWorkEntries: resumeCounts.length,
    completedResumeMutationWorkEntries: completedResumeCounts.length,
    resumeTotalWork,
    completedResumeTotalWork,
    resumeDuplicateEntries,
    completedResumeDuplicateEntries,
    duplicateMutationWork: evidence.resume?.duplicateMutationWork,
    completedResumeDuplicateMutationWork: evidence.secondResume?.duplicateMutationWork,
    maxMutationWorkCount: evidence.resume?.maxMutationWorkCount,
    completedResumeMaxMutationWorkCount: evidence.secondResume?.maxMutationWorkCount,
    finalReplayDuplicateMutationWork: evidence.finalReplay?.duplicateMutationWork,
  };
}

function storageBoundaryMetrics(evidence) {
  const checks = evidence.resume?.storageBoundaryChecks || [];
  const failures = checks.filter((check) => (
    check.passed !== true || check.actualBeforeHash !== check.expectedBeforeHash
  ));
  const safe = checks.length === evidence.resume?.appliedMutationsAfterResume
    && failures.length === 0
    && evidence.resume?.storageBoundaryFailures === 0
    && (evidence.secondResume?.storageBoundaryChecks || []).length === 0
    && evidence.secondResume?.storageBoundaryFailures === 0;

  return {
    safe,
    storageBoundaryCheckCount: checks.length,
    expectedStorageBoundaryCheckCount: evidence.resume?.appliedMutationsAfterResume,
    storageBoundaryFailures: evidence.resume?.storageBoundaryFailures,
    completedResumeStorageBoundaryFailures: evidence.secondResume?.storageBoundaryFailures,
    failedCheckCount: failures.length,
    failedCheckHashes: failures.map((check) => digest(check)),
  };
}

function chunkCollectionCore(collection) {
  return {
    planHash: collection.planHash,
    mutationCount: collection.mutationCount,
    applyBatchSize: collection.applyBatchSize,
    maxBatchSize: collection.maxBatchSize,
    chunkCount: collection.chunkCount,
    expectedChunkCount: collection.expectedChunkCount,
    chunkStarts: collection.chunkStarts,
    chunkEnds: collection.chunkEnds,
    chunkSizes: collection.chunkSizes,
    totalChunkMutations: collection.totalChunkMutations,
    uniqueMutationIdHashes: collection.uniqueMutationIdHashes,
    expectedCoverageHash: collection.expectedCoverageHash,
    observedCoverageHash: collection.observedCoverageHash,
    applyBoundary: collection.applyBoundary,
    chunkWindows: collection.chunkWindows,
  };
}

function chunkWindowCore(window) {
  return {
    chunkIndex: window.chunkIndex,
    chunkIdHash: window.chunkIdHash,
    chunkCount: window.chunkCount,
    mutationOffset: window.mutationOffset,
    mutationCount: window.mutationCount,
    firstSequence: window.firstSequence,
    lastSequence: window.lastSequence,
    lastChunk: window.lastChunk,
    mutationIdHashes: window.mutationIdHashes,
    resourceKeyHashes: window.resourceKeyHashes,
    beforeHashSetHash: window.beforeHashSetHash,
    afterHashSetHash: window.afterHashSetHash,
    estimatedBytes: window.estimatedBytes,
  };
}

function receiptForChunkWindow(window) {
  const core = {
    receiptSchemaVersion: 1,
    receiptScopeHash: sha256({
      proofId,
      phase: 'apply-transfer-chunk-receipt',
      chunkIndex: window.chunkIndex,
    }),
    chunkIndex: window.chunkIndex,
    chunkHash: window.chunkHash,
    mutationOffset: window.mutationOffset,
    mutationCount: window.mutationCount,
    afterHashSetHash: window.afterHashSetHash,
  };

  return {
    ...core,
    receiptHash: sha256(core),
  };
}

function receiptCore(receipt) {
  return {
    receiptSchemaVersion: receipt.receiptSchemaVersion,
    receiptScopeHash: receipt.receiptScopeHash,
    chunkIndex: receipt.chunkIndex,
    chunkHash: receipt.chunkHash,
    mutationOffset: receipt.mutationOffset,
    mutationCount: receipt.mutationCount,
    afterHashSetHash: receipt.afterHashSetHash,
  };
}

function receiptMatchesChunkWindow(receipt, window) {
  if (!receipt || !window) {
    return false;
  }
  return receipt.chunkIndex === window.chunkIndex
    && receipt.chunkHash === window.chunkHash
    && receipt.mutationOffset === window.mutationOffset
    && receipt.mutationCount === window.mutationCount
    && receipt.afterHashSetHash === window.afterHashSetHash
    && receipt.receiptHash === sha256(receiptCore(receipt));
}

function buildFixtureMutations() {
  return Array.from({ length: mutationCount }, (_, sequence) => ({
    sequence,
    mutationIdHash: digest({ proofId, type: 'mutation-id', sequence }),
    resourceKeyHash: digest({ proofId, type: 'resource-key', sequence }),
    beforeHash: sha256({ proofId, type: 'before-storage', sequence }),
    afterHash: sha256({ proofId, type: 'after-storage', sequence }),
    estimatedBytes: 736 + (sequence % 5) * 37,
  }));
}

function applyBatchSizingContract() {
  const contract = {
    rppId: 'RPP-0713',
    previousVariantRppId: 'RPP-0753',
    proof: 'test/rpp-0713-apply-batch-sizing.test.js',
    previousVariantProof: 'test/rpp-0753-apply-batch-sizing-v3.test.js',
    applyBatchSizing: {
      mode: 'apply',
      defaultBatchSize: 500,
      configuredBatchSize: applyBatchSize,
      maxBatchSize: 500,
      configuredBy: 'request',
      revalidation: 'fresh-live-hashes-before-each-batch',
      storageBoundary: 'per-mutation-storage-boundary-cas',
    },
  };

  return {
    ...contract,
    evidenceHash: digest(contract),
  };
}

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'live-production-service-not-supplied',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'release-verifier-carry-through-not-claimed',
    ],
  };
}

function publicChunkTransferEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    chunkTransfer: evidence.chunkTransfer,
    firstAttempt: evidence.firstAttempt,
    resume: evidence.resume,
    secondResume: evidence.secondResume,
    finalReplay: evidence.finalReplay,
    release: evidence.release,
  };
}

function generatedCoverageSummary(decisions) {
  const blockedDecisions = decisions.filter((decision) => decision.updated === false);
  const blockerCounts = {};
  for (const decision of blockedDecisions) {
    for (const blocker of decision.blockedBy) {
      blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    }
  }

  return {
    caseCount: decisions.length,
    outputEmitted: decisions.filter((decision) => decision.outputEmitted).length,
    blockedCaseCount: blockedDecisions.length,
    unsafeOutputs: decisions
      .filter((decision) => decision.caseId !== 'receipt-prefix-resume' && decision.outputEmitted)
      .length,
    blockerCounts,
    caseIds: decisions.map((decision) => decision.caseId),
    decisionHashes: decisions.map((decision) => decision.decisionHash),
  };
}

function projectGeneratedUnsafeDecisions(decisions) {
  return Object.fromEntries(
    decisions
      .filter((decision) => decision.caseId !== 'receipt-prefix-resume')
      .map((decision) => [
        unsafeDecisionKey(decision.caseId),
        {
          updated: decision.updated,
          outputEmitted: decision.outputEmitted,
          attemptedPassBlocked: decision.attemptedPassBlocked,
          correctnessGatesHold: decision.correctnessGatesHold,
          blockedBy: decision.blockedBy,
          decisionHash: decision.decisionHash,
        },
      ]),
  );
}

function unsafeDecisionKey(caseId) {
  return caseId.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function duplicateMutationWorkCount(mutationWork) {
  return [...mutationWork.values()].reduce((sum, workCount) => (
    workCount > 1 ? sum + workCount - 1 : sum
  ), 0);
}

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  return evidence;
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function assertHashOnlyChunkTransferEvidence(value) {
  assert.equal(chunkTransferEvidenceHasNoRawValues(value), true);
}

function chunkTransferEvidenceHasNoRawValues(value) {
  return !rawChunkTransferEvidencePattern().test(JSON.stringify(value));
}

function rawChunkTransferEvidencePattern() {
  return /"resourceKey"\s*:|fixture-resource|rpp-0773-fixture|private option value|post_content|option_value|meta_value|bearer\s+[a-z0-9._-]+|https?:\/\//i;
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function objectKeyBefore(object, leftKey, rightKey) {
  const keys = Object.keys(object);
  return keys.indexOf(leftKey) !== -1
    && keys.indexOf(rightKey) !== -1
    && keys.indexOf(leftKey) < keys.indexOf(rightKey);
}

function sameArray(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
