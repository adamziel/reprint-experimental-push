import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGuardedExecutorBenchmark } from '../scripts/bench/guarded-executor-benchmark.js';
import { buildChunkTransferTimeoutBudgetProof } from '../src/timeout-budget-proof.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0778-timeout-budget-proof-v4';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const chunkAttemptBudgetMs = 1_000;
const benchmarkOptions = Object.freeze({
  profile: 'unit',
  fileBytes: 1024 * 1024,
  chunkSizeBytes: 256 * 1024,
  rowCount: 8,
  rowPayloadBytes: 64,
  replayAttemptsPerChunk: 1,
  maxDurationMs: 10_000,
  maxHeapUsedBytes: 256 * 1024 * 1024,
});
const expectedGateIds = Object.freeze([
  'built-on-timeout-budget-v3-passed',
  'deterministic-replay-resume-cases-covered',
  'timeout-budget-interrupts-transfer-before-apply',
  'pre-timeout-receipts-skip-replayed-chunks',
  'resume-uploads-only-unreceipted-chunks',
  'no-duplicate-mutation-work',
  'apply-opens-after-transfer-finalize',
  'unit-storage-performance-budget',
  'hash-count-only-timeout-evidence',
  'support-only-release-no-go',
]);
const expectedResumeCursorFields = Object.freeze([
  'planId',
  'resourceKey',
  'chunkIndex',
  'offsetBytes',
  'sizeBytes',
  'chunkDigest',
  'receiptKey',
  'idempotencyKey',
]);

test('RPP-0778 variant 4 proves chunk transfer replay resumes without duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildVariant4Proof();

  assert.equal(proof.rppId, 'RPP-0778');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0758');
  assert.equal(proof.builtOn.proofId, 'rpp-0758-timeout-budget-proof-v3');
  assert.equal(proof.builtOn.variant, 3);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.builtOn.rppId, 'RPP-0738');
  assert.equal(proof.builtOn.builtOn.proofId, 'rpp-0738-timeout-budget-proof-v2');
  assert.equal(proof.builtOn.builtOn.variant, 2);
  assert.equal(proof.builtOn.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceTimeoutProof.rppId, 'RPP-0718');
  assert.equal(proof.builtOn.sourceTimeoutProof.proofId, 'rpp-0718-timeout-budget-proof');
  assert.equal(proof.builtOn.sourceTimeoutProof.variant, 1);
  assert.equal(proof.builtOn.sourceTimeoutProof.status, 'passed');
  assert.match(proof.builtOn.sourceTimeoutProof.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.replayCoverage.source, 'local-support-replayed-chunk-transfer-resume-cases');
  assert.equal(proof.replayCoverage.timeoutVariant, 'timeout-budget-proof-v4');
  assert.equal(proof.replayCoverage.caseCount, 4);
  assert.equal(proof.replayCoverage.deterministicCaseVector, true);
  assert.deepEqual(proof.replayCoverage.timeoutReceiptCounts, [1, 2, 3, 4]);
  assert.deepEqual(proof.replayCoverage.resumeReplayChunkCounts, [4, 5, 6, 7]);
  assert.deepEqual(proof.replayCoverage.unreceiptedChunkCounts, [3, 3, 3, 3]);
  assert.deepEqual(proof.replayCoverage.caseStatuses, ['passed', 'passed', 'passed', 'passed']);
  assert.deepEqual(proof.replayCoverage.caseHashes.map(isSha256Hash), [true, true, true, true]);
  assert.deepEqual(proof.replayCoverage.caseHashes, proof.replayCoverage.repeatedCaseHashes);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'unit');
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.storage.receiptBackend, 'lab-file-journal-receipts');
  assert.equal(proof.resources.storage.localStorageProof, 'support-only-lab-file-journal');
  assert.equal(proof.resources.storage.productionBacked, false);
  assert.equal(proof.resources.storage.finalStagingRecordPresent, true);

  assert.equal(proof.transfer.fileBytes, benchmarkOptions.fileBytes);
  assert.equal(proof.transfer.chunkSizeBytes, benchmarkOptions.chunkSizeBytes);
  assert.equal(proof.transfer.chunkCount, 4);
  assert.equal(proof.transfer.timeoutBudgetScope, 'chunk-transfer-attempt');
  assert.equal(proof.transfer.timeoutProofStatus, 'passed');
  assert.equal(proof.transfer.timeoutDuplicateMutationWork, 0);
  assert.match(proof.transfer.planIdHash, /^[a-f0-9]{64}$/);
  assert.match(proof.transfer.resourceKeyHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.replayResume.caseCount, 4);
  assert.equal(proof.replayResume.allCasesPassed, true);
  assert.equal(proof.replayResume.totalChunksReplayedOnResume, 22);
  assert.equal(proof.replayResume.totalChunksSkippedByReceipt, 10);
  assert.equal(proof.replayResume.totalChunksUploadedAfterResume, 12);
  assert.equal(proof.replayResume.totalDuplicateChunkBytes, 0);
  assert.equal(proof.replayResume.totalDuplicateMutationWork, 0);
  assert.equal(proof.replayResume.maxMutationWorkBeforeTimeout, 0);
  assert.equal(proof.replayResume.maxMutationWorkBeforeTransferFinalize, 0);
  assert.equal(proof.replayResume.maxFreshMutationWorkDuringTransferResume, 0);
  assert.equal(proof.replayResume.cases.length, 4);

  for (const replayCase of proof.replayResume.cases) {
    assert.equal(replayCase.status, 'passed');
    assert.equal(replayCase.budgetScope, 'chunk-transfer-attempt');
    assert.equal(replayCase.timeoutExpiredDuring, 'chunk-transfer');
    assert.equal(replayCase.timeoutBeforeApply, true);
    assert.equal(replayCase.nextChunkWouldExceedBudget, true);
    assert.equal(replayCase.timeoutExpiredBeforeCompletion, true);
    assert.ok(replayCase.elapsedMsForDurableReceipts < replayCase.elapsedMsAtTimeout);
    assert.equal(replayCase.resumeReplayedWholeManifest, true);
    assert.equal(replayCase.chunksReplayedOnResume, replayCase.chunkCount);
    assert.equal(replayCase.receiptOnlyResumeSafe, true);
    assert.equal(replayCase.receiptsBeforeTimeout, replayCase.timeoutAfterChunks);
    assert.equal(replayCase.chunksSkippedByReceipt, replayCase.receiptsBeforeTimeout);
    assert.equal(
      replayCase.chunksUploadedAfterResume,
      replayCase.chunkCount - replayCase.receiptsBeforeTimeout,
    );
    assert.equal(replayCase.resumeUploadedUnreceiptedChunkCount, replayCase.chunksUploadedAfterResume);
    assert.equal(replayCase.resumeUploadedDuplicateChunkCount, 0);
    assert.equal(replayCase.replayedReceiptBackedSkipCount, replayCase.chunksSkippedByReceipt);
    assert.equal(replayCase.exactReceiptMatches, replayCase.chunkCount);
    assert.equal(replayCase.duplicateReceiptKeys, 0);
    assert.equal(replayCase.canonicalVisibleAtTimeout, false);
    assert.equal(replayCase.missingReceiptBlocksSkip, true);
    assert.equal(replayCase.mismatchedReceiptBlocksSkip, true);
    assert.equal(replayCase.duplicateChunkBytes, 0);
    assert.equal(replayCase.resumeDuplicateMutationWork, 0);
    assert.equal(replayCase.applyDuplicateMutationWork, 0);
    assert.equal(replayCase.duplicateMutationWork, 0);
    assert.equal(replayCase.mutationWorkBeforeTimeout, 0);
    assert.equal(replayCase.mutationWorkReplayedBeforeTransferFinalize, 0);
    assert.equal(replayCase.freshMutationWorkDuringTransferResume, 0);
    assert.equal(replayCase.noDuplicateMutationWork, true);
    assert.equal(replayCase.applyOpenedAfterTransferFinalize, true);
    assert.equal(replayCase.mutationWorkAllowedDuringTransferResume, false);
    assert.ok(replayCase.transferFinalizeSequence < replayCase.firstApplyBoundarySequence);
    assert.deepEqual(replayCase.resumeCursorFields, expectedResumeCursorFields);
    assert.equal(replayCase.replayDecisionHashes.length, replayCase.chunkCount);
    assert.ok(replayCase.replayDecisionHashes.every((hash) => /^sha256:[a-f0-9]{64}$/.test(hash)));
    assert.match(replayCase.caseHash, /^[a-f0-9]{64}$/);
    assert.match(replayCase.planIdHash, /^[a-f0-9]{64}$/);
    assert.match(replayCase.resourceKeyHash, /^[a-f0-9]{64}$/);
    assert.match(replayCase.proofHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(replayCase.receiptMatches.length, replayCase.chunkCount);
    assert.ok(replayCase.receiptMatches.every((match) => match.matched === true));
    assert.ok(replayCase.receiptMatches.some((match) => match.receiptedBeforeTimeout));
    assert.ok(replayCase.receiptMatches.some((match) => match.resumedAfterTimeout));
  }

  assert.deepEqual(proof.correctness.gateIds, expectedGateIds);
  assert.deepEqual(
    proof.correctness.recomputedGateVector.map((gate) => gate.status),
    Array(expectedGateIds.length).fill('pass'),
  );
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashCountOnlyOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.match(proof.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.missingReceipt.updated, false);
  assert.equal(proof.unsafe.missingReceipt.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingReceipt.blockedBy.includes('pre-timeout-receipts-skip-replayed-chunks'));
  assert.equal(proof.unsafe.duplicateChunkReplay.updated, false);
  assert.equal(proof.unsafe.duplicateChunkReplay.attemptedPassBlocked, true);
  assert.ok(
    proof.unsafe.duplicateChunkReplay.blockedBy
      .includes('resume-uploads-only-unreceipted-chunks'),
  );
  assert.equal(proof.unsafe.duplicateMutationWork.updated, false);
  assert.equal(proof.unsafe.duplicateMutationWork.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
  assert.equal(proof.unsafe.timeoutCompletesBeforeBudget.updated, false);
  assert.equal(proof.unsafe.timeoutCompletesBeforeBudget.attemptedPassBlocked, true);
  assert.ok(
    proof.unsafe.timeoutCompletesBeforeBudget.blockedBy
      .includes('timeout-budget-interrupts-transfer-before-apply'),
  );
  assert.equal(proof.unsafe.earlyApplyBoundary.updated, false);
  assert.equal(proof.unsafe.earlyApplyBoundary.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.earlyApplyBoundary.blockedBy.includes('apply-opens-after-transfer-finalize'));
  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.equal(proof.unsafe.overBudget.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.overBudget.blockedBy.includes('unit-storage-performance-budget'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.equal(proof.unsafe.prematurePassStatus.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertHashOnlyTimeoutEvidence(proof);
});

test('RPP-0778 variant 4 fails closed for duplicate replay work and stale gates', () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveTimeoutBudgetV4Proof(evidence);
  const unsafeDecisions = unsafeTimeoutBudgetDecisions(evidence);

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(
    safeDecision.recomputedGates.map((gate) => gate.status),
    Array(expectedGateIds.length).fill('pass'),
  );

  assert.equal(unsafeDecisions.missingReceipt.updated, false);
  assert.ok(
    unsafeDecisions.missingReceipt.blockedBy
      .includes('pre-timeout-receipts-skip-replayed-chunks'),
  );
  assert.equal(unsafeDecisions.duplicateChunkReplay.updated, false);
  assert.ok(
    unsafeDecisions.duplicateChunkReplay.blockedBy
      .includes('resume-uploads-only-unreceipted-chunks'),
  );
  assert.equal(unsafeDecisions.duplicateMutationWork.updated, false);
  assert.ok(
    unsafeDecisions.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'),
  );
  assert.equal(unsafeDecisions.timeoutCompletesBeforeBudget.updated, false);
  assert.ok(
    unsafeDecisions.timeoutCompletesBeforeBudget.blockedBy
      .includes('timeout-budget-interrupts-transfer-before-apply'),
  );
  assert.equal(unsafeDecisions.earlyApplyBoundary.updated, false);
  assert.ok(unsafeDecisions.earlyApplyBoundary.blockedBy.includes('apply-opens-after-transfer-finalize'));
  assert.equal(unsafeDecisions.overBudget.updated, false);
  assert.ok(unsafeDecisions.overBudget.blockedBy.includes('unit-storage-performance-budget'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(
    unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'),
  );

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyTimeoutEvidence(decision);
  }
});

function buildVariant4Proof() {
  const { report, evidence } = buildRecordedEvidence();
  const safeDecision = resolveTimeoutBudgetV4Proof(evidence);
  const unsafe = projectUnsafeDecisions(unsafeTimeoutBudgetDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'replayResume',
  );
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('guarded-executor-timeout-proof-passed',
      report.evidence.timeoutBudgetProof.status === 'passed', {
        timeoutProofStatus: report.evidence.timeoutBudgetProof.status,
        timeoutProofEvidenceHash: report.evidence.timeoutBudgetProof.evidenceHash,
      }),
    proofGate('timeout-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-timeout-budget-evidence-fails-closed',
      Object.values(unsafe).every((decision) => (
        decision.updated === false
          && decision.outputEmitted === false
          && decision.attemptedPassBlocked === true
      )), {
        blockedDecisionHashes: Object.values(unsafe).map((decision) => decision.decisionHash),
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
    rppId: 'RPP-0778',
    proofId,
    variant: 4,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
    replayCoverage: evidence.replayCoverage,
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: evidence.benchmark,
    transfer: evidence.transfer,
    replayResume: evidence.replayResume,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashCountOnlyOutput: safeDecision.hashCountOnlyOutput,
      outputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-count-only-timeout-budget-resume-regression',
      rawValueEvidenceLeaks: timeoutEvidenceHasNoRawValues(publicTimeoutEvidenceProjection(evidence))
        ? 0
        : 1,
      publicEvidenceHash: digest(publicTimeoutEvidenceProjection(evidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidence() {
  const report = runUnitBenchmark();
  const generatedCases = generatedReplayResumeCases();
  const repeatedCases = generatedReplayResumeCases();
  const evidence = buildTimeoutBudgetV4Evidence({
    report,
    generatedCases,
    repeatedCases,
  });
  recordCorrectnessGates(evidence);
  return { report, evidence };
}

function runUnitBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0778-timeout-v4-'));
  try {
    return runGuardedExecutorBenchmark({
      ...benchmarkOptions,
      now: fixedNow,
      tempDir,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildTimeoutBudgetV4Evidence({ report, generatedCases, repeatedCases }) {
  const timeoutProof = report.evidence.timeoutBudgetProof;
  const caseHashes = generatedCases.map((replayCase) => replayCase.caseHash);
  const repeatedCaseHashes = repeatedCases.map((replayCase) => replayCase.caseHash);
  const deterministicCaseVector = sameArray(caseHashes, repeatedCaseHashes);
  const totalDuplicateMutationWork = generatedCases.reduce(
    (sum, replayCase) => sum + replayCase.duplicateMutationWork,
    0,
  );

  return {
    schemaVersion: 1,
    rppId: 'RPP-0778',
    proofId,
    variant: 4,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0758',
      proofId: 'rpp-0758-timeout-budget-proof-v3',
      variant: 3,
      status: timeoutProof.status === 'passed' ? 'passed' : 'blocked',
      builtOn: {
        rppId: 'RPP-0738',
        proofId: 'rpp-0738-timeout-budget-proof-v2',
        variant: 2,
        status: timeoutProof.status === 'passed' ? 'passed' : 'blocked',
      },
      sourceTimeoutProof: {
        rppId: 'RPP-0718',
        proofId: timeoutProof.proofId,
        variant: timeoutProof.variant,
        status: timeoutProof.status,
        evidenceHash: timeoutProof.evidenceHash,
      },
    },
    replayCoverage: {
      source: 'local-support-replayed-chunk-transfer-resume-cases',
      timeoutVariant: 'timeout-budget-proof-v4',
      caseCount: generatedCases.length,
      deterministicCaseVector,
      timeoutReceiptCounts: generatedCases.map((replayCase) => replayCase.receiptsBeforeTimeout),
      resumeReplayChunkCounts: generatedCases.map((replayCase) => replayCase.chunksReplayedOnResume),
      unreceiptedChunkCounts: generatedCases.map((replayCase) =>
        replayCase.chunksUploadedAfterResume),
      caseStatuses: generatedCases.map((replayCase) => replayCase.status),
      caseHashes,
      repeatedCaseHashes,
    },
    benchmark: publicBenchmarkProjection(report),
    correctnessGates: [],
    runtime: {
      generatedAt: report.runtime.generatedAt,
      profile: report.runtime.profile,
      durationMs: report.runtime.durationMs,
      budgetStatus: report.runtime.budgetStatus,
      budgets: report.runtime.budgets,
      conservativeBudgetReporting: report.runtime.conservativeBudgetReporting,
    },
    resources: {
      storage: {
        stagingBackend: report.resources.transfer.staging,
        receiptBackend: 'lab-file-journal-receipts',
        localStorageProof: 'support-only-lab-file-journal',
        productionBacked: false,
        chunkReceipts: report.resources.transfer.chunkReceipts,
        finalStagingRecordPresent: report.evidence.chunkReceipts.finalStagingRecord,
        chunkManifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
        finalizedHashHash: digest(report.resources.transfer.finalizedHash),
      },
      process: report.resources.process,
      apply: {
        mutationResources: report.resources.apply.mutationResources,
        rowResources: report.resources.apply.rowResources,
        atomicGroupIdHash: digest(report.resources.apply.atomicGroupId),
        atomicGroupMutationCount: report.resources.apply.atomicGroupMutationCount,
      },
      runtimeBudget: report.resources.runtimeBudget,
    },
    transfer: {
      planIdHash: digest(report.resources.transfer.planId),
      resourceKeyHash: digest(report.resources.transfer.resourceKey),
      fileBytes: report.shape.fileBytes,
      chunkSizeBytes: report.shape.chunkSizeBytes,
      chunkCount: report.shape.chunkCount,
      timeoutBudgetScope: timeoutProof.budget.scope,
      timeoutProofStatus: timeoutProof.status,
      timeoutProofHash: digest(timeoutProofCore(timeoutProof)),
      timeoutReceiptsBeforeTimeout: timeoutProof.partialTransfer.receiptsBeforeTimeout,
      timeoutChunksUploadedAfterResume: timeoutProof.resume.chunksUploadedAfterResume,
      timeoutDuplicateChunkBytes: timeoutProof.resume.duplicateChunkBytes,
      timeoutDuplicateMutationWork:
        timeoutProof.resume.duplicateMutationWork + timeoutProof.apply.duplicateMutationWork,
    },
    replayResume: {
      caseCount: generatedCases.length,
      allCasesPassed: generatedCases.every((replayCase) => replayCase.status === 'passed'),
      totalChunksReplayedOnResume: generatedCases.reduce(
        (sum, replayCase) => sum + replayCase.chunksReplayedOnResume,
        0,
      ),
      totalChunksSkippedByReceipt: generatedCases.reduce(
        (sum, replayCase) => sum + replayCase.chunksSkippedByReceipt,
        0,
      ),
      totalChunksUploadedAfterResume: generatedCases.reduce(
        (sum, replayCase) => sum + replayCase.chunksUploadedAfterResume,
        0,
      ),
      totalDuplicateChunkBytes: generatedCases.reduce(
        (sum, replayCase) => sum + replayCase.duplicateChunkBytes,
        0,
      ),
      totalDuplicateMutationWork,
      maxMutationWorkBeforeTimeout: Math.max(
        ...generatedCases.map((replayCase) => replayCase.mutationWorkBeforeTimeout),
      ),
      maxMutationWorkBeforeTransferFinalize: Math.max(
        ...generatedCases.map((replayCase) =>
          replayCase.mutationWorkReplayedBeforeTransferFinalize),
      ),
      maxFreshMutationWorkDuringTransferResume: Math.max(
        ...generatedCases.map((replayCase) =>
          replayCase.freshMutationWorkDuringTransferResume),
      ),
      cases: generatedCases,
    },
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeTimeoutBudgetV4Gates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveTimeoutBudgetV4Proof(evidence) {
  const recomputedGates = recomputeTimeoutBudgetV4Gates(evidence);
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
        replayCoverageHash: sha256({
          caseCount: evidence.replayCoverage.caseCount,
          caseHashes: evidence.replayCoverage.caseHashes,
          resumeReplayChunkCounts: evidence.replayCoverage.resumeReplayChunkCounts,
          timeoutReceiptCounts: evidence.replayCoverage.timeoutReceiptCounts,
        }),
        replayResumeHash: sha256({
          totalChunksReplayedOnResume: evidence.replayResume.totalChunksReplayedOnResume,
          totalChunksSkippedByReceipt: evidence.replayResume.totalChunksSkippedByReceipt,
          totalChunksUploadedAfterResume: evidence.replayResume.totalChunksUploadedAfterResume,
          totalDuplicateChunkBytes: evidence.replayResume.totalDuplicateChunkBytes,
          totalDuplicateMutationWork: evidence.replayResume.totalDuplicateMutationWork,
        }),
        duplicateMutationWork: evidence.replayResume.totalDuplicateMutationWork,
        releaseStatus: evidence.release.finalReleaseStatus,
        integrationRecommendation: evidence.release.integrationRecommendation,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: evidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    hashCountOnlyOutput: output ? timeoutEvidenceHasNoRawValues(output) : false,
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

function recomputeTimeoutBudgetV4Gates(evidence) {
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const storage = resources.storage || {};
  const processResources = resources.process || {};
  const replayCoverage = evidence.replayCoverage || {};
  const replayResume = evidence.replayResume || {};
  const cases = Array.isArray(replayResume.cases) ? replayResume.cases : [];
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const deterministicReplayCasesCovered = replayCoverage.source
      === 'local-support-replayed-chunk-transfer-resume-cases'
    && replayCoverage.timeoutVariant === 'timeout-budget-proof-v4'
    && replayCoverage.caseCount >= 4
    && replayCoverage.caseCount === cases.length
    && replayCoverage.deterministicCaseVector === true
    && sameArray(replayCoverage.caseHashes || [], replayCoverage.repeatedCaseHashes || [])
    && sameArray(replayCoverage.timeoutReceiptCounts || [], [1, 2, 3, 4])
    && sameArray(replayCoverage.resumeReplayChunkCounts || [], [4, 5, 6, 7])
    && sameArray(replayCoverage.unreceiptedChunkCounts || [], [3, 3, 3, 3])
    && replayCoverage.caseStatuses?.every((status) => status === 'passed');
  const timeoutInterruptsTransfer = cases.length === replayCoverage.caseCount
    && cases.every((replayCase) => (
      replayCase.status === 'passed'
      && replayCase.budgetScope === 'chunk-transfer-attempt'
      && replayCase.timeoutExpiredDuring === 'chunk-transfer'
      && replayCase.timeoutBeforeApply === true
      && replayCase.nextChunkWouldExceedBudget === true
      && replayCase.timeoutExpiredBeforeCompletion === true
      && replayCase.elapsedMsForDurableReceipts < replayCase.elapsedMsAtTimeout
      && replayCase.receiptsBeforeTimeout > 0
      && replayCase.receiptsBeforeTimeout < replayCase.chunkCount
      && replayCase.chunksUnacknowledgedAtTimeout > 0
    ));
  const preTimeoutReceiptsSkipReplayedChunks = cases.length === replayCoverage.caseCount
    && cases.every((replayCase) => (
      replayCase.status === 'passed'
      && replayCase.resumeReplayedWholeManifest === true
      && replayCase.chunksReplayedOnResume === replayCase.chunkCount
      && replayCase.replayedReceiptBackedSkipCount === replayCase.receiptsBeforeTimeout
      && replayCase.chunksSkippedByReceipt === replayCase.receiptsBeforeTimeout
      && replayCase.exactReceiptMatches === replayCase.chunkCount
      && replayCase.receiptMatches.length === replayCase.chunkCount
      && replayCase.receiptMatches.every((match) => match.matched === true)
      && replayCase.receiptsBeforeTimeout + replayCase.chunksUnacknowledgedAtTimeout
        === replayCase.chunkCount
      && replayCase.unacknowledgedChunksMarkedComplete === 0
      && replayCase.duplicateReceiptKeys === 0
      && replayCase.canonicalVisibleAtTimeout === false
      && replayCase.receiptOnlyResumeSafe === true
      && replayCase.missingReceiptBlocksSkip === true
      && replayCase.mismatchedReceiptBlocksSkip === true
    ));
  const resumeUploadsOnlyUnreceiptedChunks = cases.every((replayCase) => (
    replayCase.receiptOnlyResumeSafe === true
    && replayCase.chunksUploadedAfterResume === replayCase.chunksUnacknowledgedAtTimeout
    && replayCase.resumeUploadedUnreceiptedChunkCount === replayCase.chunksUploadedAfterResume
    && replayCase.resumeUploadedDuplicateChunkCount === 0
    && replayCase.bytesSkippedByReceipt + replayCase.bytesUploadedAfterResume
      === replayCase.fileBytes
    && replayCase.duplicateChunkBytes === 0
    && sameArray(replayCase.resumeCursorFields || [], expectedResumeCursorFields)
    && Array.isArray(replayCase.replayDecisionHashes)
    && replayCase.replayDecisionHashes.length === replayCase.chunkCount
    && replayCase.replayDecisionHashes.every((hash) => /^sha256:[a-f0-9]{64}$/.test(hash))
  ));
  const noDuplicateMutationWork = replayResume.totalDuplicateMutationWork === 0
    && replayResume.maxMutationWorkBeforeTimeout === 0
    && replayResume.maxMutationWorkBeforeTransferFinalize === 0
    && replayResume.maxFreshMutationWorkDuringTransferResume === 0
    && cases.every((replayCase) => (
      replayCase.mutationWorkBeforeTimeout === 0
      && replayCase.mutationWorkReplayedBeforeTransferFinalize === 0
      && replayCase.freshMutationWorkDuringTransferResume === 0
      && replayCase.resumeDuplicateMutationWork === 0
      && replayCase.applyDuplicateMutationWork === 0
      && replayCase.duplicateMutationWork === 0
      && replayCase.noDuplicateMutationWork === true
    ));
  const applyOpensAfterTransferFinalize = cases.every((replayCase) => (
    replayCase.applyOpenedAfterTransferFinalize === true
    && replayCase.transferFinalizeSequence < replayCase.firstApplyBoundarySequence
    && replayCase.mutationWorkAllowedDuringTransferResume === false
  ));
  const runtimeWithinBudget = runtime.profile === 'unit'
    && runtime.budgetStatus === 'passed'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && storage.receiptBackend === 'lab-file-journal-receipts'
    && storage.localStorageProof === 'support-only-lab-file-journal'
    && storage.productionBacked === false
    && storage.finalStagingRecordPresent === true;

  return [
    proofGate('built-on-timeout-budget-v3-passed', evidence.builtOn?.rppId === 'RPP-0758'
      && evidence.builtOn?.proofId === 'rpp-0758-timeout-budget-proof-v3'
      && evidence.builtOn?.variant === 3
      && evidence.builtOn?.status === 'passed'
      && evidence.builtOn?.builtOn?.rppId === 'RPP-0738'
      && evidence.builtOn?.builtOn?.proofId === 'rpp-0738-timeout-budget-proof-v2'
      && evidence.builtOn?.builtOn?.variant === 2
      && evidence.builtOn?.builtOn?.status === 'passed'
      && evidence.builtOn?.sourceTimeoutProof?.rppId === 'RPP-0718'
      && evidence.builtOn?.sourceTimeoutProof?.proofId === 'rpp-0718-timeout-budget-proof'
      && evidence.builtOn?.sourceTimeoutProof?.variant === 1
      && evidence.builtOn?.sourceTimeoutProof?.status === 'passed'
      && isSha256Hash(evidence.builtOn?.sourceTimeoutProof?.evidenceHash), {
      builtOnStatus: evidence.builtOn?.status,
      previousVariantStatus: evidence.builtOn?.builtOn?.status,
      sourceTimeoutProofStatus: evidence.builtOn?.sourceTimeoutProof?.status,
      sourceTimeoutEvidenceHash: evidence.builtOn?.sourceTimeoutProof?.evidenceHash,
    }),
    proofGate('deterministic-replay-resume-cases-covered', deterministicReplayCasesCovered, {
      caseCount: replayCoverage.caseCount,
      timeoutReceiptCounts: replayCoverage.timeoutReceiptCounts,
      resumeReplayChunkCounts: replayCoverage.resumeReplayChunkCounts,
      unreceiptedChunkCounts: replayCoverage.unreceiptedChunkCounts,
      deterministicCaseVector: replayCoverage.deterministicCaseVector,
    }),
    proofGate('timeout-budget-interrupts-transfer-before-apply', timeoutInterruptsTransfer, {
      timeoutBudgetMs: cases.map((replayCase) => replayCase.timeoutBudgetMs),
      elapsedMsAtTimeout: cases.map((replayCase) => replayCase.elapsedMsAtTimeout),
      timeoutReceiptCounts: cases.map((replayCase) => replayCase.receiptsBeforeTimeout),
      timeoutBeforeApply: cases.map((replayCase) => replayCase.timeoutBeforeApply),
    }),
    proofGate('pre-timeout-receipts-skip-replayed-chunks', preTimeoutReceiptsSkipReplayedChunks, {
      chunksReplayedOnResume: cases.map((replayCase) => replayCase.chunksReplayedOnResume),
      chunksSkippedByReceipt: cases.map((replayCase) => replayCase.chunksSkippedByReceipt),
      replayedReceiptBackedSkipCount: cases.map((replayCase) =>
        replayCase.replayedReceiptBackedSkipCount),
      exactReceiptMatches: cases.map((replayCase) => replayCase.exactReceiptMatches),
    }),
    proofGate('resume-uploads-only-unreceipted-chunks', resumeUploadsOnlyUnreceiptedChunks, {
      totalChunksUploadedAfterResume: replayResume.totalChunksUploadedAfterResume,
      uploadedUnreceiptedChunks: cases.map((replayCase) =>
        replayCase.resumeUploadedUnreceiptedChunkCount),
      uploadedDuplicateChunks: cases.map((replayCase) =>
        replayCase.resumeUploadedDuplicateChunkCount),
      totalDuplicateChunkBytes: replayResume.totalDuplicateChunkBytes,
    }),
    proofGate('no-duplicate-mutation-work', noDuplicateMutationWork, {
      totalDuplicateMutationWork: replayResume.totalDuplicateMutationWork,
      maxMutationWorkBeforeTimeout: replayResume.maxMutationWorkBeforeTimeout,
      maxMutationWorkBeforeTransferFinalize: replayResume.maxMutationWorkBeforeTransferFinalize,
      maxFreshMutationWorkDuringTransferResume:
        replayResume.maxFreshMutationWorkDuringTransferResume,
      duplicateMutationWorkByCase: cases.map((replayCase) => replayCase.duplicateMutationWork),
    }),
    proofGate('apply-opens-after-transfer-finalize', applyOpensAfterTransferFinalize, {
      transferFinalizeSequences: cases.map((replayCase) => replayCase.transferFinalizeSequence),
      firstApplyBoundarySequences: cases.map((replayCase) => replayCase.firstApplyBoundarySequence),
    }),
    proofGate('unit-storage-performance-budget', runtimeWithinBudget, {
      profile: runtime.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
      productionBacked: storage.productionBacked,
    }),
    proofGate('hash-count-only-timeout-evidence',
      timeoutEvidenceHasNoRawValues(publicTimeoutEvidenceProjection(evidence)), {
        rawValueEvidenceLeaks:
          timeoutEvidenceHasNoRawValues(publicTimeoutEvidenceProjection(evidence)) ? 0 : 1,
      }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.productionThroughput === 'not-claimed'
      && release.speedClaimsAllowed === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO'
      && releaseBlockers.includes('production-storage-receipts-not-measured')
      && releaseBlockers.includes('production-row-batch-executor-not-measured')
      && releaseBlockers.includes('production-atomic-group-commit-not-measured'), {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      productionThroughput: release.productionThroughput,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function unsafeTimeoutBudgetDecisions(evidence) {
  const missingReceipt = withPassedStatus(clone(evidence));
  missingReceipt.replayResume.cases[0].receiptMatches[0].matched = false;
  missingReceipt.replayResume.cases[0].exactReceiptMatches -= 1;
  missingReceipt.replayResume.cases[0].receiptOnlyResumeSafe = false;
  missingReceipt.replayResume.cases[0].replayedReceiptBackedSkipCount -= 1;

  const duplicateChunkReplay = withPassedStatus(clone(evidence));
  duplicateChunkReplay.replayResume.cases[1].resumeUploadedDuplicateChunkCount = 1;
  duplicateChunkReplay.replayResume.cases[1].duplicateChunkBytes =
    duplicateChunkReplay.replayResume.cases[1].chunkSizeBytes;
  duplicateChunkReplay.replayResume.totalDuplicateChunkBytes =
    duplicateChunkReplay.replayResume.cases[1].chunkSizeBytes;

  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.replayResume.cases[2].resumeDuplicateMutationWork = 1;
  duplicateMutationWork.replayResume.cases[2].freshMutationWorkDuringTransferResume = 1;
  duplicateMutationWork.replayResume.cases[2].applyDuplicateMutationWork = 1;
  duplicateMutationWork.replayResume.cases[2].duplicateMutationWork = 2;
  duplicateMutationWork.replayResume.cases[2].noDuplicateMutationWork = false;
  duplicateMutationWork.replayResume.totalDuplicateMutationWork = 2;
  duplicateMutationWork.replayResume.maxFreshMutationWorkDuringTransferResume = 1;

  const timeoutCompletesBeforeBudget = withPassedStatus(clone(evidence));
  timeoutCompletesBeforeBudget.replayResume.cases[2].nextChunkWouldExceedBudget = false;
  timeoutCompletesBeforeBudget.replayResume.cases[2].timeoutExpiredBeforeCompletion = false;

  const earlyApplyBoundary = withPassedStatus(clone(evidence));
  earlyApplyBoundary.replayResume.cases[2].firstApplyBoundarySequence =
    earlyApplyBoundary.replayResume.cases[2].transferFinalizeSequence - 1;
  earlyApplyBoundary.replayResume.cases[2].applyOpenedAfterTransferFinalize = false;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingReceipt: resolveTimeoutBudgetV4Proof(missingReceipt),
    duplicateChunkReplay: resolveTimeoutBudgetV4Proof(duplicateChunkReplay),
    duplicateMutationWork: resolveTimeoutBudgetV4Proof(duplicateMutationWork),
    timeoutCompletesBeforeBudget: resolveTimeoutBudgetV4Proof(timeoutCompletesBeforeBudget),
    earlyApplyBoundary: resolveTimeoutBudgetV4Proof(earlyApplyBoundary),
    overBudget: resolveTimeoutBudgetV4Proof(overBudget),
    prematurePassStatus: resolveTimeoutBudgetV4Proof(prematurePassStatus),
  };
}

function generatedReplayResumeCases() {
  return generatedReplayResumeSpecs().map((spec) => buildGeneratedReplayResumeCase(spec));
}

function generatedReplayResumeSpecs() {
  return [4, 5, 6, 7].map((chunkCount, index) => ({
    caseId: `replay-resume-${index + 1}`,
    fileBytes: chunkCount * benchmarkOptions.chunkSizeBytes,
    chunkSizeBytes: benchmarkOptions.chunkSizeBytes,
    chunkCount,
    timeoutAfterChunks: index + 1,
  }));
}

function buildGeneratedReplayResumeCase(spec) {
  const planId = `plan-${proofId}-${spec.caseId}`;
  const resourceKey = `resource:${proofId}:${spec.caseId}`;
  const localResourceHash = sha256({
    proofId,
    caseId: spec.caseId,
    fileBytes: spec.fileBytes,
  });
  const manifestEntries = buildManifestEntries({
    ...spec,
    planId,
    resourceKey,
    localResourceHash,
  });
  const chunkReceiptRecords = manifestEntries.map((entry, index) => ({
    type: 'chunk-receipt',
    sequence: index + 1,
    planId,
    resourceKey,
    state: 'staged',
    chunkCount: spec.chunkCount,
    chunkIndex: entry.chunkIndex,
    offsetBytes: entry.offsetBytes,
    sizeBytes: entry.sizeBytes,
    localResourceHash,
    chunkDigest: entry.chunkDigest,
    receiptKey: entry.receiptKey,
    idempotencyKey: entry.idempotencyKey,
    canonicalVisible: false,
  }));
  const resumeRecords = manifestEntries.map((entry, index) => ({
    type: index < spec.timeoutAfterChunks
      ? 'receipt-backed-replay-skip'
      : 'chunk-uploaded-after-timeout',
    sequence: spec.chunkCount + index + 10,
    planId,
    resourceKey,
    chunkIndex: entry.chunkIndex,
    actionHash: sha256({
      caseId: spec.caseId,
      chunkIndex: entry.chunkIndex,
      action: index < spec.timeoutAfterChunks ? 'skip' : 'upload',
    }),
  }));
  const journalRecords = [
    ...chunkReceiptRecords,
    {
      type: 'file-staging-finalized',
      sequence: spec.chunkCount + 1,
      planId,
      resourceKey,
      assembledHash: localResourceHash,
    },
    {
      type: 'apply-staged',
      sequence: spec.chunkCount + 2,
    },
    {
      type: 'mutation-applied',
      sequence: spec.chunkCount + 3,
    },
  ];
  const timeoutBudgetProof = buildChunkTransferTimeoutBudgetProof({
    planId,
    resourceKey,
    manifestEntries,
    chunkReceiptRecords,
    journalRecords,
    resumeRecords,
    chunkAttemptBudgetMs,
    timeoutBudgetMs: (spec.timeoutAfterChunks * chunkAttemptBudgetMs)
      + Math.floor(chunkAttemptBudgetMs / 2),
  });
  const publicCase = {
    caseId: spec.caseId,
    status: timeoutBudgetProof.status,
    planIdHash: digest(planId),
    resourceKeyHash: digest(resourceKey),
    fileBytes: spec.fileBytes,
    chunkSizeBytes: spec.chunkSizeBytes,
    chunkCount: spec.chunkCount,
    timeoutAfterChunks: spec.timeoutAfterChunks,
    budgetScope: timeoutBudgetProof.budget.scope,
    timeoutBudgetMs: timeoutBudgetProof.budget.timeoutBudgetMs,
    chunkAttemptBudgetMs: timeoutBudgetProof.budget.chunkAttemptBudgetMs,
    elapsedMsAtTimeout: timeoutBudgetProof.budget.elapsedMsAtTimeout,
    elapsedMsForDurableReceipts: timeoutBudgetProof.budget.elapsedMsForDurableReceipts,
    timeoutExpiredDuring: timeoutBudgetProof.budget.timeoutExpiredDuring,
    timeoutBeforeApply: timeoutBudgetProof.budget.timeoutBeforeApply,
    nextChunkWouldExceedBudget: timeoutBudgetProof.budget.nextChunkWouldExceedBudget,
    timeoutExpiredBeforeCompletion: timeoutBudgetProof.budget.timeoutExpiredBeforeCompletion,
    receiptsBeforeTimeout: timeoutBudgetProof.partialTransfer.receiptsBeforeTimeout,
    chunksUnacknowledgedAtTimeout:
      timeoutBudgetProof.partialTransfer.chunksUnacknowledgedAtTimeout,
    exactReceiptMatches: timeoutBudgetProof.partialTransfer.exactReceiptMatches,
    unacknowledgedChunksMarkedComplete:
      timeoutBudgetProof.partialTransfer.unacknowledgedChunksMarkedComplete,
    duplicateReceiptKeys: timeoutBudgetProof.partialTransfer.duplicateReceiptKeys,
    canonicalVisibleAtTimeout: timeoutBudgetProof.partialTransfer.canonicalVisibleAtTimeout,
    timeoutAfterSequence: timeoutBudgetProof.partialTransfer.timeoutAfterSequence,
    mutationWorkBeforeTimeout: timeoutBudgetProof.partialTransfer.mutationWorkBeforeTimeout,
    resumeReplayedWholeManifest: resumeRecords.length === spec.chunkCount,
    chunksReplayedOnResume: resumeRecords.length,
    replayedReceiptBackedSkipCount: timeoutBudgetProof.resume.chunksSkippedByReceipt,
    resumeUploadedUnreceiptedChunkCount: timeoutBudgetProof.resume.chunksUploadedAfterResume,
    resumeUploadedDuplicateChunkCount: 0,
    receiptOnlyResumeSafe: timeoutBudgetProof.resume.receiptOnlyResumeSafe,
    chunksSkippedByReceipt: timeoutBudgetProof.resume.chunksSkippedByReceipt,
    chunksUploadedAfterResume: timeoutBudgetProof.resume.chunksUploadedAfterResume,
    bytesSkippedByReceipt: timeoutBudgetProof.resume.bytesSkippedByReceipt,
    bytesUploadedAfterResume: timeoutBudgetProof.resume.bytesUploadedAfterResume,
    duplicateChunkBytes: timeoutBudgetProof.resume.duplicateChunkBytes,
    resumeDuplicateMutationWork: timeoutBudgetProof.resume.duplicateMutationWork,
    missingReceiptBlocksSkip: timeoutBudgetProof.resume.missingReceiptBlocksSkip,
    mismatchedReceiptBlocksSkip: timeoutBudgetProof.resume.mismatchedReceiptBlocksSkip,
    resumeCursorFields: timeoutBudgetProof.resume.resumeCursorFields,
    transferFinalizeSequence: timeoutBudgetProof.apply.transferFinalizeSequence,
    firstApplyBoundarySequence: timeoutBudgetProof.apply.firstApplyBoundarySequence,
    applyOpenedAfterTransferFinalize: timeoutBudgetProof.apply.applyOpenedAfterTransferFinalize,
    mutationWorkAllowedDuringTransferResume:
      timeoutBudgetProof.apply.mutationWorkAllowedDuringTransferResume,
    mutationWorkReplayedBeforeTransferFinalize:
      timeoutBudgetProof.apply.mutationWorkReplayedBeforeTransferFinalize,
    freshMutationWorkDuringTransferResume:
      timeoutBudgetProof.apply.freshMutationWorkDuringTransferResume,
    applyDuplicateMutationWork: timeoutBudgetProof.apply.duplicateMutationWork,
    duplicateMutationWork: timeoutBudgetProof.resume.duplicateMutationWork
      + timeoutBudgetProof.apply.duplicateMutationWork,
    noDuplicateMutationWork: timeoutBudgetProof.apply.noDuplicateMutationWork,
    replayDecisionHashes: resumeRecords.map((record) => record.actionHash),
    receiptMatches: timeoutBudgetProof.receiptMatches.map((match) => ({
      chunkIndex: match.chunkIndex,
      offsetBytes: match.offsetBytes,
      sizeBytes: match.sizeBytes,
      receiptKeyHash: match.receiptKeyHash,
      matched: match.matched,
      receiptedBeforeTimeout: match.receiptedBeforeTimeout,
      resumedAfterTimeout: match.resumedAfterTimeout,
    })),
    proofHash: sha256(timeoutProofCore(timeoutBudgetProof)),
  };

  return {
    ...publicCase,
    caseHash: digest(publicCase),
  };
}

function buildManifestEntries({
  caseId,
  planId,
  resourceKey,
  localResourceHash,
  fileBytes,
  chunkSizeBytes,
  chunkCount,
}) {
  return Array.from({ length: chunkCount }, (_, chunkIndex) => {
    const offsetBytes = chunkIndex * chunkSizeBytes;
    const sizeBytes = Math.min(chunkSizeBytes, fileBytes - offsetBytes);
    const chunkDigest = sha256({
      proofId,
      caseId,
      chunkIndex,
      offsetBytes,
      sizeBytes,
    });
    return {
      chunkIndex,
      offsetBytes,
      sizeBytes,
      localResourceHash,
      chunkDigest,
      receiptKey: [
        planId,
        resourceKey,
        localResourceHash,
        'chunk',
        chunkIndex,
        offsetBytes,
        sizeBytes,
        chunkDigest,
      ].join(':'),
      idempotencyKey: [
        planId,
        resourceKey,
        localResourceHash,
        'chunk',
        chunkIndex,
      ].join(':'),
    };
  });
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

function publicBenchmarkProjection(report) {
  return {
    benchmark: report.runtime.benchmarkId,
    profile: report.profile,
    runtime: {
      generatedAt: report.runtime.generatedAt,
      budgets: report.runtime.budgets,
      budgetStatus: report.runtime.budgetStatus,
    },
    shape: {
      fileBytes: report.shape.fileBytes,
      chunkSizeBytes: report.shape.chunkSizeBytes,
      chunkCount: report.shape.chunkCount,
      rowCount: report.shape.rowCount,
      mutations: report.shape.mutations,
    },
    transfer: {
      planIdHash: digest(report.resources.transfer.planId),
      resourceKeyHash: digest(report.resources.transfer.resourceKey),
      chunkReceipts: report.resources.transfer.chunkReceipts,
      chunkManifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
      finalizedHashHash: digest(report.resources.transfer.finalizedHash),
    },
    timeoutProofHash: digest(report.evidence.timeoutBudgetProof),
    localRolloutSafetyGates: report.rolloutSafetyGates.gates
      .filter((gate) => gate.status === 'passed')
      .map((gate) => ({
        id: gate.id,
        status: gate.status,
      })),
    claims: {
      labGuardedExecutorEvidence: report.claims.labGuardedExecutorEvidence,
      productionThroughputAllowed: report.claims.productionThroughput.allowed,
      productionThroughputStatus: report.claims.productionThroughput.status,
    },
  };
}

function publicTimeoutEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    replayCoverage: evidence.replayCoverage,
    runtime: evidence.runtime,
    resources: evidence.resources,
    transfer: evidence.transfer,
    replayResume: evidence.replayResume,
    release: evidence.release,
  };
}

function timeoutProofCore(proof) {
  return {
    proofId: proof.proofId,
    variant: proof.variant,
    status: proof.status,
    budget: proof.budget,
    partialTransfer: proof.partialTransfer,
    resume: proof.resume,
    apply: proof.apply,
    receiptMatches: proof.receiptMatches,
    redaction: proof.redaction,
    evidenceHash: proof.evidenceHash,
  };
}

function projectUnsafeDecisions(unsafe) {
  return Object.fromEntries(
    Object.entries(unsafe).map(([name, decision]) => [
      name,
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

function assertHashOnlyTimeoutEvidence(value) {
  assert.equal(timeoutEvidenceHasNoRawValues(value), true);
}

function timeoutEvidenceHasNoRawValues(value) {
  return !rawTimeoutEvidencePattern().test(JSON.stringify(value));
}

function rawTimeoutEvidencePattern() {
  return /wp-content|catalog-export|row-payload|commerce|payments|post_content|option_value|meta_value|customer secret|private option value|https?:\/\/|Bearer\s+|Basic\s+/i;
}

function isSha256Hash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
