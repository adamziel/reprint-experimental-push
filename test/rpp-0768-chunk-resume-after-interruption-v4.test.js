import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGuardedExecutorBenchmark } from '../scripts/bench/guarded-executor-benchmark.js';
import { buildChunkTransferTimeoutBudgetProof } from '../src/timeout-budget-proof.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0768-chunk-resume-after-interruption-v4';
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
  'built-on-timeout-budget-v2-passed',
  'generated-interruption-cases-covered',
  'durable-local-receipts-before-interruption',
  'receipt-only-resume-after-interruption',
  'resume-journal-records-contain-no-mutation-work',
  'no-duplicate-mutation-work',
  'apply-opens-after-transfer-finalize',
  'unit-storage-performance-budget',
  'hash-count-only-storage-performance-evidence',
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
const mutationRecordTypes = Object.freeze([
  'mutation-observed',
  'mutation-applied',
]);

test('RPP-0768 variant 4 chunk resume after interruption skips receipts without duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildVariant4Proof();

  assert.equal(proof.rppId, 'RPP-0768');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0738');
  assert.equal(proof.builtOn.proofId, 'rpp-0738-timeout-budget-proof-v2');
  assert.equal(proof.builtOn.variant, 2);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceTimeoutProof.rppId, 'RPP-0718');
  assert.equal(proof.builtOn.sourceTimeoutProof.proofId, 'rpp-0718-timeout-budget-proof');
  assert.equal(proof.builtOn.sourceTimeoutProof.variant, 1);
  assert.equal(proof.builtOn.sourceTimeoutProof.status, 'passed');
  assert.match(proof.builtOn.sourceTimeoutProof.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.generatedCoverage.source, 'local-support-generated-interruption-cases');
  assert.equal(proof.generatedCoverage.resumeVariant, 'chunk-resume-after-interruption-v4');
  assert.equal(proof.generatedCoverage.caseCount, 5);
  assert.equal(proof.generatedCoverage.deterministicCaseVector, true);
  assert.deepEqual(proof.generatedCoverage.interruptionPoints, [1, 1, 2, 3, 4]);
  assert.deepEqual(proof.generatedCoverage.uniqueInterruptionPoints, [1, 2, 3, 4]);
  assert.deepEqual(proof.generatedCoverage.caseStatuses, [
    'passed',
    'passed',
    'passed',
    'passed',
    'passed',
  ]);
  assert.deepEqual(proof.generatedCoverage.caseHashes.map((hash) => /^[a-f0-9]{64}$/.test(hash)), [
    true,
    true,
    true,
    true,
    true,
  ]);

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
  assert.equal(proof.transfer.timeoutReceiptsBeforeInterruption, 2);
  assert.equal(proof.transfer.timeoutChunksUploadedAfterResume, 2);
  assert.equal(proof.transfer.timeoutDuplicateMutationWork, 0);
  assert.match(proof.transfer.planIdHash, /^[a-f0-9]{64}$/);
  assert.match(proof.transfer.resourceKeyHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.interruption.caseCount, 5);
  assert.equal(proof.interruption.allCasesPassed, true);
  assert.equal(proof.interruption.totalChunksSkippedByReceipt, 11);
  assert.equal(proof.interruption.totalChunksUploadedAfterResume, 9);
  assert.equal(proof.interruption.totalDuplicateChunkBytes, 0);
  assert.equal(proof.interruption.totalDuplicateMutationWork, 0);
  assert.equal(proof.interruption.totalResumeBookkeepingRecordCount, 10);
  assert.equal(proof.interruption.totalResumeMutationRecordCount, 0);
  assert.equal(proof.interruption.maxMutationWorkBeforeInterruption, 0);
  assert.equal(proof.interruption.maxMutationWorkBeforeTransferFinalize, 0);
  assert.equal(proof.interruption.cases.length, 5);

  for (const interruptionCase of proof.interruption.cases) {
    assert.equal(interruptionCase.status, 'passed');
    assert.equal(interruptionCase.receiptOnlyResumeSafe, true);
    assert.equal(interruptionCase.receiptsBeforeInterruption, interruptionCase.interruptionAfterChunks);
    assert.equal(
      interruptionCase.chunksUploadedAfterResume,
      interruptionCase.chunkCount - interruptionCase.interruptionAfterChunks,
    );
    assert.equal(interruptionCase.exactReceiptMatches, interruptionCase.chunkCount);
    assert.equal(interruptionCase.duplicateReceiptKeys, 0);
    assert.equal(interruptionCase.canonicalVisibleAtInterruption, false);
    assert.equal(interruptionCase.missingReceiptBlocksSkip, true);
    assert.equal(interruptionCase.mismatchedReceiptBlocksSkip, true);
    assert.equal(interruptionCase.duplicateChunkBytes, 0);
    assert.equal(interruptionCase.resumeDuplicateMutationWork, 0);
    assert.equal(interruptionCase.applyDuplicateMutationWork, 0);
    assert.equal(interruptionCase.duplicateMutationWork, 0);
    assert.equal(interruptionCase.resumeBookkeepingRecordCount, 2);
    assert.equal(interruptionCase.resumeMutationRecordCount, 0);
    assert.equal(interruptionCase.mutationWorkBeforeInterruption, 0);
    assert.equal(interruptionCase.mutationWorkReplayedBeforeTransferFinalize, 0);
    assert.equal(interruptionCase.freshMutationWorkDuringTransferResume, 0);
    assert.equal(interruptionCase.applyOpenedAfterTransferFinalize, true);
    assert.equal(interruptionCase.mutationWorkAllowedDuringTransferResume, false);
    assert.ok(interruptionCase.transferFinalizeSequence < interruptionCase.firstApplyBoundarySequence);
    assert.deepEqual(interruptionCase.resumeCursorFields, expectedResumeCursorFields);
    assert.match(interruptionCase.caseHash, /^[a-f0-9]{64}$/);
    assert.match(interruptionCase.planIdHash, /^[a-f0-9]{64}$/);
    assert.match(interruptionCase.resourceKeyHash, /^[a-f0-9]{64}$/);
    assert.match(interruptionCase.proofHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(interruptionCase.receiptMatches.length, interruptionCase.chunkCount);
    assert.ok(interruptionCase.receiptMatches.every((match) => match.matched === true));
    assert.ok(interruptionCase.receiptMatches.some((match) => match.receiptedBeforeInterruption));
    assert.ok(interruptionCase.receiptMatches.some((match) => match.resumedAfterInterruption));
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
  assert.ok(proof.unsafe.missingReceipt.blockedBy.includes('durable-local-receipts-before-interruption'));
  assert.ok(proof.unsafe.missingReceipt.blockedBy.includes('receipt-only-resume-after-interruption'));
  assert.equal(proof.unsafe.duplicateMutationWork.updated, false);
  assert.equal(proof.unsafe.duplicateMutationWork.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
  assert.equal(proof.unsafe.resumeMutationWork.updated, false);
  assert.equal(proof.unsafe.resumeMutationWork.attemptedPassBlocked, true);
  assert.ok(
    proof.unsafe.resumeMutationWork.blockedBy
      .includes('resume-journal-records-contain-no-mutation-work'),
  );
  assert.ok(proof.unsafe.resumeMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
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
  assertHashOnlyInterruptionEvidence(proof);
});

test('RPP-0768 variant 4 fails closed for missing receipts, resume mutation work, and stale gates', () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveChunkResumeInterruptionProof(evidence);
  const unsafeDecisions = unsafeInterruptionDecisions(evidence);

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(
    safeDecision.recomputedGates.map((gate) => gate.status),
    Array(expectedGateIds.length).fill('pass'),
  );

  assert.equal(unsafeDecisions.missingReceipt.updated, false);
  assert.ok(unsafeDecisions.missingReceipt.blockedBy.includes('durable-local-receipts-before-interruption'));
  assert.ok(unsafeDecisions.missingReceipt.blockedBy.includes('receipt-only-resume-after-interruption'));
  assert.equal(unsafeDecisions.duplicateMutationWork.updated, false);
  assert.ok(unsafeDecisions.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.resumeMutationWork.updated, false);
  assert.ok(
    unsafeDecisions.resumeMutationWork.blockedBy
      .includes('resume-journal-records-contain-no-mutation-work'),
  );
  assert.ok(unsafeDecisions.resumeMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.earlyApplyBoundary.updated, false);
  assert.ok(unsafeDecisions.earlyApplyBoundary.blockedBy.includes('apply-opens-after-transfer-finalize'));
  assert.equal(unsafeDecisions.overBudget.updated, false);
  assert.ok(unsafeDecisions.overBudget.blockedBy.includes('unit-storage-performance-budget'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyInterruptionEvidence(decision);
  }
});

function buildVariant4Proof() {
  const { report, evidence } = buildRecordedEvidence();
  const safeDecision = resolveChunkResumeInterruptionProof(evidence);
  const unsafe = projectUnsafeDecisions(unsafeInterruptionDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'interruption',
  );
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('guarded-executor-timeout-proof-passed',
      report.evidence.timeoutBudgetProof.status === 'passed', {
        timeoutProofStatus: report.evidence.timeoutBudgetProof.status,
        timeoutProofEvidenceHash: report.evidence.timeoutBudgetProof.evidenceHash,
      }),
    proofGate('interruption-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-interruption-evidence-fails-closed',
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
    rppId: 'RPP-0768',
    proofId,
    variant: 4,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
    generatedCoverage: evidence.generatedCoverage,
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: evidence.benchmark,
    transfer: evidence.transfer,
    interruption: evidence.interruption,
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
      mode: 'hash-count-only-chunk-resume-interruption-v4-storage-performance',
      rawValueEvidenceLeaks: interruptionEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicInterruptionEvidenceProjection(evidence)),
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
  const generatedCases = generatedInterruptionCases();
  const repeatedCases = generatedInterruptionCases();
  const evidence = buildChunkResumeInterruptionEvidence({
    report,
    generatedCases,
    repeatedCases,
  });
  recordCorrectnessGates(evidence);
  return { report, evidence };
}

function runUnitBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0768-interruption-v4-'));
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

function buildChunkResumeInterruptionEvidence({ report, generatedCases, repeatedCases }) {
  const timeoutProof = report.evidence.timeoutBudgetProof;
  const caseHashes = generatedCases.map((interruptionCase) => interruptionCase.caseHash);
  const repeatedCaseHashes = repeatedCases.map((interruptionCase) => interruptionCase.caseHash);
  const deterministicCaseVector = sameArray(caseHashes, repeatedCaseHashes);

  return {
    schemaVersion: 1,
    rppId: 'RPP-0768',
    proofId,
    variant: 4,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0738',
      proofId: 'rpp-0738-timeout-budget-proof-v2',
      variant: 2,
      status: timeoutProof.status === 'passed' ? 'passed' : 'blocked',
      sourceTimeoutProof: {
        rppId: 'RPP-0718',
        proofId: timeoutProof.proofId,
        variant: timeoutProof.variant,
        status: timeoutProof.status,
        evidenceHash: timeoutProof.evidenceHash,
      },
    },
    generatedCoverage: {
      source: 'local-support-generated-interruption-cases',
      resumeVariant: 'chunk-resume-after-interruption-v4',
      caseCount: generatedCases.length,
      deterministicCaseVector,
      interruptionPoints: generatedCases.map((interruptionCase) =>
        interruptionCase.interruptionAfterChunks),
      uniqueInterruptionPoints: unique(generatedCases.map((interruptionCase) =>
        interruptionCase.interruptionAfterChunks)),
      chunkCounts: generatedCases.map((interruptionCase) => interruptionCase.chunkCount),
      caseStatuses: generatedCases.map((interruptionCase) => interruptionCase.status),
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
      timeoutReceiptsBeforeInterruption: timeoutProof.partialTransfer.receiptsBeforeTimeout,
      timeoutChunksUploadedAfterResume: timeoutProof.resume.chunksUploadedAfterResume,
      timeoutDuplicateChunkBytes: timeoutProof.resume.duplicateChunkBytes,
      timeoutDuplicateMutationWork:
        timeoutProof.resume.duplicateMutationWork + timeoutProof.apply.duplicateMutationWork,
    },
    interruption: summarizeInterruptionCases(generatedCases),
    release: supportOnlyReleasePosture(),
  };
}

function summarizeInterruptionCases(cases) {
  return {
    caseCount: cases.length,
    allCasesPassed: cases.every((interruptionCase) => interruptionCase.status === 'passed'),
    totalChunksSkippedByReceipt: cases.reduce(
      (sum, interruptionCase) => sum + interruptionCase.chunksSkippedByReceipt,
      0,
    ),
    totalChunksUploadedAfterResume: cases.reduce(
      (sum, interruptionCase) => sum + interruptionCase.chunksUploadedAfterResume,
      0,
    ),
    totalDuplicateChunkBytes: cases.reduce(
      (sum, interruptionCase) => sum + interruptionCase.duplicateChunkBytes,
      0,
    ),
    totalDuplicateMutationWork: cases.reduce(
      (sum, interruptionCase) => sum + interruptionCase.duplicateMutationWork,
      0,
    ),
    totalResumeBookkeepingRecordCount: cases.reduce(
      (sum, interruptionCase) => sum + interruptionCase.resumeBookkeepingRecordCount,
      0,
    ),
    totalResumeMutationRecordCount: cases.reduce(
      (sum, interruptionCase) => sum + interruptionCase.resumeMutationRecordCount,
      0,
    ),
    maxMutationWorkBeforeInterruption: Math.max(
      ...cases.map((interruptionCase) => interruptionCase.mutationWorkBeforeInterruption),
    ),
    maxMutationWorkBeforeTransferFinalize: Math.max(
      ...cases.map((interruptionCase) =>
        interruptionCase.mutationWorkReplayedBeforeTransferFinalize),
    ),
    cases,
  };
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeInterruptionProofGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveChunkResumeInterruptionProof(evidence) {
  const recomputedGates = recomputeInterruptionProofGates(evidence);
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
        generatedCoverageHash: sha256({
          caseCount: evidence.generatedCoverage.caseCount,
          caseHashes: evidence.generatedCoverage.caseHashes,
          interruptionPoints: evidence.generatedCoverage.interruptionPoints,
        }),
        resumeHash: sha256({
          totalChunksSkippedByReceipt: evidence.interruption.totalChunksSkippedByReceipt,
          totalChunksUploadedAfterResume: evidence.interruption.totalChunksUploadedAfterResume,
          totalDuplicateChunkBytes: evidence.interruption.totalDuplicateChunkBytes,
          totalDuplicateMutationWork: evidence.interruption.totalDuplicateMutationWork,
          totalResumeMutationRecordCount: evidence.interruption.totalResumeMutationRecordCount,
        }),
        duplicateMutationWork: evidence.interruption.totalDuplicateMutationWork,
        resumeMutationRecordCount: evidence.interruption.totalResumeMutationRecordCount,
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
    hashCountOnlyOutput: output ? interruptionEvidenceHasNoRawValues(output) : false,
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

function recomputeInterruptionProofGates(evidence) {
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const storage = resources.storage || {};
  const processResources = resources.process || {};
  const generatedCoverage = evidence.generatedCoverage || {};
  const interruption = evidence.interruption || {};
  const cases = Array.isArray(interruption.cases) ? interruption.cases : [];
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const generatedCaseStatuses = Array.isArray(generatedCoverage.caseStatuses)
    ? generatedCoverage.caseStatuses
    : [];
  const generatedCasesCovered = generatedCoverage.source === 'local-support-generated-interruption-cases'
    && generatedCoverage.resumeVariant === 'chunk-resume-after-interruption-v4'
    && generatedCoverage.caseCount >= 5
    && generatedCoverage.caseCount === cases.length
    && generatedCoverage.deterministicCaseVector === true
    && sameArray(generatedCoverage.caseHashes || [], generatedCoverage.repeatedCaseHashes || [])
    && sameArray(generatedCoverage.uniqueInterruptionPoints || [], [1, 2, 3, 4])
    && new Set(generatedCoverage.chunkCounts || []).size >= 5
    && generatedCaseStatuses.length === generatedCoverage.caseCount
    && generatedCaseStatuses.every((status) => status === 'passed');
  const durableReceiptCoverage = cases.length === generatedCoverage.caseCount
    && cases.every((interruptionCase) => (
      interruptionCase.status === 'passed'
      && interruptionCase.chunkCount > 1
      && interruptionCase.exactReceiptMatches === interruptionCase.chunkCount
      && interruptionCase.receiptMatches.length === interruptionCase.chunkCount
      && interruptionCase.receiptMatches.every((match) => match.matched === true)
      && interruptionCase.receiptsBeforeInterruption > 0
      && interruptionCase.receiptsBeforeInterruption < interruptionCase.chunkCount
      && interruptionCase.chunksUnacknowledgedAtInterruption > 0
      && interruptionCase.receiptsBeforeInterruption
        + interruptionCase.chunksUnacknowledgedAtInterruption === interruptionCase.chunkCount
      && interruptionCase.unacknowledgedChunksMarkedComplete === 0
      && interruptionCase.duplicateReceiptKeys === 0
      && interruptionCase.canonicalVisibleAtInterruption === false
    ));
  const resumeSafe = cases.every((interruptionCase) => (
    interruptionCase.receiptOnlyResumeSafe === true
    && interruptionCase.chunksSkippedByReceipt === interruptionCase.receiptsBeforeInterruption
    && interruptionCase.chunksUploadedAfterResume
      === interruptionCase.chunksUnacknowledgedAtInterruption
    && interruptionCase.bytesSkippedByReceipt
      + interruptionCase.bytesUploadedAfterResume === interruptionCase.fileBytes
    && interruptionCase.duplicateChunkBytes === 0
    && interruptionCase.resumeDuplicateMutationWork === 0
    && interruptionCase.missingReceiptBlocksSkip === true
    && interruptionCase.mismatchedReceiptBlocksSkip === true
    && sameArray(interruptionCase.resumeCursorFields || [], expectedResumeCursorFields)
  ));
  const resumeJournalHasNoMutationWork = interruption.totalResumeMutationRecordCount === 0
    && cases.every((interruptionCase) => (
      interruptionCase.resumeBookkeepingRecordCount >= 2
      && interruptionCase.resumeMutationRecordCount === 0
      && interruptionCase.freshMutationWorkDuringTransferResume === 0
    ));
  const noDuplicateMutationWork = interruption.totalDuplicateMutationWork === 0
    && interruption.maxMutationWorkBeforeInterruption === 0
    && interruption.maxMutationWorkBeforeTransferFinalize === 0
    && cases.every((interruptionCase) => (
      interruptionCase.mutationWorkBeforeInterruption === 0
      && interruptionCase.mutationWorkReplayedBeforeTransferFinalize === 0
      && interruptionCase.freshMutationWorkDuringTransferResume === 0
      && interruptionCase.resumeDuplicateMutationWork === 0
      && interruptionCase.applyDuplicateMutationWork === 0
      && interruptionCase.duplicateMutationWork === 0
      && interruptionCase.noDuplicateMutationWork === true
    ));
  const applyOpensAfterTransferFinalize = cases.every((interruptionCase) => (
    interruptionCase.applyOpenedAfterTransferFinalize === true
    && interruptionCase.transferFinalizeSequence < interruptionCase.firstApplyBoundarySequence
    && interruptionCase.mutationWorkAllowedDuringTransferResume === false
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
    proofGate('built-on-timeout-budget-v2-passed', evidence.builtOn?.rppId === 'RPP-0738'
      && evidence.builtOn?.proofId === 'rpp-0738-timeout-budget-proof-v2'
      && evidence.builtOn?.variant === 2
      && evidence.builtOn?.status === 'passed'
      && evidence.builtOn?.sourceTimeoutProof?.rppId === 'RPP-0718'
      && evidence.builtOn?.sourceTimeoutProof?.proofId === 'rpp-0718-timeout-budget-proof'
      && evidence.builtOn?.sourceTimeoutProof?.variant === 1
      && evidence.builtOn?.sourceTimeoutProof?.status === 'passed'
      && isSha256Hash(evidence.builtOn?.sourceTimeoutProof?.evidenceHash), {
      builtOnStatus: evidence.builtOn?.status,
      sourceTimeoutProofStatus: evidence.builtOn?.sourceTimeoutProof?.status,
      sourceTimeoutEvidenceHash: evidence.builtOn?.sourceTimeoutProof?.evidenceHash,
    }),
    proofGate('generated-interruption-cases-covered', generatedCasesCovered, {
      caseCount: generatedCoverage.caseCount,
      interruptionPoints: generatedCoverage.interruptionPoints,
      uniqueInterruptionPoints: generatedCoverage.uniqueInterruptionPoints,
      chunkCounts: generatedCoverage.chunkCounts,
      deterministicCaseVector: generatedCoverage.deterministicCaseVector,
    }),
    proofGate('durable-local-receipts-before-interruption', durableReceiptCoverage, {
      caseCount: cases.length,
      exactReceiptMatches: cases.map((interruptionCase) => interruptionCase.exactReceiptMatches),
      receiptsBeforeInterruption: cases.map((interruptionCase) =>
        interruptionCase.receiptsBeforeInterruption),
      chunksUnacknowledgedAtInterruption: cases.map((interruptionCase) =>
        interruptionCase.chunksUnacknowledgedAtInterruption),
      duplicateReceiptKeys: cases.map((interruptionCase) => interruptionCase.duplicateReceiptKeys),
    }),
    proofGate('receipt-only-resume-after-interruption', resumeSafe, {
      totalChunksSkippedByReceipt: interruption.totalChunksSkippedByReceipt,
      totalChunksUploadedAfterResume: interruption.totalChunksUploadedAfterResume,
      totalDuplicateChunkBytes: interruption.totalDuplicateChunkBytes,
      duplicateMutationWork: cases.map((interruptionCase) =>
        interruptionCase.resumeDuplicateMutationWork),
    }),
    proofGate('resume-journal-records-contain-no-mutation-work', resumeJournalHasNoMutationWork, {
      totalResumeBookkeepingRecordCount: interruption.totalResumeBookkeepingRecordCount,
      totalResumeMutationRecordCount: interruption.totalResumeMutationRecordCount,
      resumeMutationRecordCounts: cases.map((interruptionCase) =>
        interruptionCase.resumeMutationRecordCount),
    }),
    proofGate('no-duplicate-mutation-work', noDuplicateMutationWork, {
      totalDuplicateMutationWork: interruption.totalDuplicateMutationWork,
      maxMutationWorkBeforeInterruption: interruption.maxMutationWorkBeforeInterruption,
      maxMutationWorkBeforeTransferFinalize: interruption.maxMutationWorkBeforeTransferFinalize,
      duplicateMutationWorkByCase: cases.map((interruptionCase) =>
        interruptionCase.duplicateMutationWork),
    }),
    proofGate('apply-opens-after-transfer-finalize', applyOpensAfterTransferFinalize, {
      transferFinalizeSequences: cases.map((interruptionCase) =>
        interruptionCase.transferFinalizeSequence),
      firstApplyBoundarySequences: cases.map((interruptionCase) =>
        interruptionCase.firstApplyBoundarySequence),
    }),
    proofGate('unit-storage-performance-budget', runtimeWithinBudget, {
      profile: runtime.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
      productionBacked: storage.productionBacked,
    }),
    proofGate('hash-count-only-storage-performance-evidence',
      interruptionEvidenceHasNoRawValues(publicInterruptionEvidenceProjection(evidence)), {
        rawValueEvidenceLeaks:
          interruptionEvidenceHasNoRawValues(publicInterruptionEvidenceProjection(evidence)) ? 0 : 1,
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

function unsafeInterruptionDecisions(evidence) {
  const missingReceipt = withPassedStatus(clone(evidence));
  missingReceipt.interruption.cases[0].receiptMatches[0].matched = false;
  missingReceipt.interruption.cases[0].exactReceiptMatches -= 1;
  missingReceipt.interruption.cases[0].receiptOnlyResumeSafe = false;

  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.interruption.cases[1].resumeDuplicateMutationWork = 1;
  duplicateMutationWork.interruption.cases[1].applyDuplicateMutationWork = 1;
  duplicateMutationWork.interruption.cases[1].duplicateMutationWork = 2;
  duplicateMutationWork.interruption.cases[1].noDuplicateMutationWork = false;
  duplicateMutationWork.interruption.totalDuplicateMutationWork = 2;

  const resumeMutationWork = withPassedStatus(clone(evidence));
  replaceInterruptionCase(
    resumeMutationWork,
    2,
    buildGeneratedInterruptionCase(generatedInterruptionSpecs()[2], {
      resumeMutationWork: true,
    }),
  );

  const earlyApplyBoundary = withPassedStatus(clone(evidence));
  earlyApplyBoundary.interruption.cases[3].firstApplyBoundarySequence =
    earlyApplyBoundary.interruption.cases[3].transferFinalizeSequence - 1;
  earlyApplyBoundary.interruption.cases[3].applyOpenedAfterTransferFinalize = false;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingReceipt: resolveChunkResumeInterruptionProof(missingReceipt),
    duplicateMutationWork: resolveChunkResumeInterruptionProof(duplicateMutationWork),
    resumeMutationWork: resolveChunkResumeInterruptionProof(resumeMutationWork),
    earlyApplyBoundary: resolveChunkResumeInterruptionProof(earlyApplyBoundary),
    overBudget: resolveChunkResumeInterruptionProof(overBudget),
    prematurePassStatus: resolveChunkResumeInterruptionProof(prematurePassStatus),
  };
}

function replaceInterruptionCase(evidence, caseIndex, interruptionCase) {
  evidence.interruption.cases[caseIndex] = interruptionCase;
  evidence.interruption = summarizeInterruptionCases(evidence.interruption.cases);
  evidence.generatedCoverage.caseStatuses = evidence.interruption.cases.map((currentCase) =>
    currentCase.status);
  evidence.generatedCoverage.caseHashes = evidence.interruption.cases.map((currentCase) =>
    currentCase.caseHash);
  evidence.generatedCoverage.repeatedCaseHashes = [...evidence.generatedCoverage.caseHashes];
}

function generatedInterruptionCases() {
  return generatedInterruptionSpecs().map((spec) => buildGeneratedInterruptionCase(spec));
}

function generatedInterruptionSpecs() {
  return [
    { caseId: 'interruption-1', chunkCount: 2, interruptionAfterChunks: 1 },
    { caseId: 'interruption-2', chunkCount: 3, interruptionAfterChunks: 1 },
    { caseId: 'interruption-3', chunkCount: 4, interruptionAfterChunks: 2 },
    { caseId: 'interruption-4', chunkCount: 5, interruptionAfterChunks: 3 },
    { caseId: 'interruption-5', chunkCount: 6, interruptionAfterChunks: 4 },
  ].map((spec) => ({
    ...spec,
    fileBytes: spec.chunkCount * benchmarkOptions.chunkSizeBytes,
    chunkSizeBytes: benchmarkOptions.chunkSizeBytes,
  }));
}

function buildGeneratedInterruptionCase(spec, options = {}) {
  const planId = `plan-${proofId}-${spec.caseId}`;
  const resourceKey = `file:wp-content/uploads/2026/05/${proofId}-${spec.caseId}.bin`;
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
  const resumeRecords = buildResumeRecords(spec, options);
  const timeoutBudgetProof = buildChunkTransferTimeoutBudgetProof({
    planId,
    resourceKey,
    manifestEntries,
    chunkReceiptRecords,
    journalRecords,
    resumeRecords,
    chunkAttemptBudgetMs,
    timeoutBudgetMs: (spec.interruptionAfterChunks * chunkAttemptBudgetMs)
      + Math.floor(chunkAttemptBudgetMs / 2),
  });
  const resumeMutationRecordCount = resumeRecords
    .filter((record) => mutationRecordTypes.includes(record.type))
    .length;
  const publicCase = {
    caseId: spec.caseId,
    status: timeoutBudgetProof.status,
    planIdHash: digest(planId),
    resourceKeyHash: digest(resourceKey),
    fileBytes: spec.fileBytes,
    chunkSizeBytes: spec.chunkSizeBytes,
    chunkCount: spec.chunkCount,
    interruptionAfterChunks: spec.interruptionAfterChunks,
    receiptsBeforeInterruption: timeoutBudgetProof.partialTransfer.receiptsBeforeTimeout,
    chunksUnacknowledgedAtInterruption:
      timeoutBudgetProof.partialTransfer.chunksUnacknowledgedAtTimeout,
    exactReceiptMatches: timeoutBudgetProof.partialTransfer.exactReceiptMatches,
    unacknowledgedChunksMarkedComplete:
      timeoutBudgetProof.partialTransfer.unacknowledgedChunksMarkedComplete,
    duplicateReceiptKeys: timeoutBudgetProof.partialTransfer.duplicateReceiptKeys,
    canonicalVisibleAtInterruption: timeoutBudgetProof.partialTransfer.canonicalVisibleAtTimeout,
    timeoutAfterSequence: timeoutBudgetProof.partialTransfer.timeoutAfterSequence,
    mutationWorkBeforeInterruption: timeoutBudgetProof.partialTransfer.mutationWorkBeforeTimeout,
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
    resumeBookkeepingRecordCount: resumeRecords.length - resumeMutationRecordCount,
    resumeMutationRecordCount,
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
    receiptMatches: timeoutBudgetProof.receiptMatches.map((match) => ({
      chunkIndex: match.chunkIndex,
      offsetBytes: match.offsetBytes,
      sizeBytes: match.sizeBytes,
      receiptKeyHash: match.receiptKeyHash,
      matched: match.matched,
      receiptedBeforeInterruption: match.receiptedBeforeTimeout,
      resumedAfterInterruption: match.resumedAfterTimeout,
    })),
    proofHash: sha256(timeoutProofCore(timeoutBudgetProof)),
  };

  return {
    ...publicCase,
    caseHash: digest(publicCase),
  };
}

function buildResumeRecords(spec, options) {
  const records = [
    {
      type: 'chunk-transfer-resume-opened',
      sequence: spec.chunkCount + 10,
    },
    {
      type: 'chunk-receipt-scan-completed',
      sequence: spec.chunkCount + 11,
    },
  ];

  if (options.resumeMutationWork) {
    records.push({
      type: 'mutation-applied',
      sequence: spec.chunkCount + 12,
    });
  }

  return records;
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

function publicInterruptionEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    generatedCoverage: evidence.generatedCoverage,
    runtime: evidence.runtime,
    resources: evidence.resources,
    transfer: evidence.transfer,
    interruption: evidence.interruption,
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

function assertHashOnlyInterruptionEvidence(value) {
  assert.equal(interruptionEvidenceHasNoRawValues(value), true);
}

function interruptionEvidenceHasNoRawValues(value) {
  return !rawInterruptionEvidencePattern().test(JSON.stringify(value));
}

function rawInterruptionEvidencePattern() {
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
