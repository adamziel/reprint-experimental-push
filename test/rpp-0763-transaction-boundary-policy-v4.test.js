import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  productionThroughputBlockers,
  runGuardedExecutorBenchmark,
} from '../scripts/bench/guarded-executor-benchmark.js';
import { digest } from '../src/stable-json.js';
import { buildChunkTransferTransactionBoundaryPolicy } from '../src/transaction-boundary-policy.js';

const proofId = 'rpp-0763-transaction-boundary-policy-v4';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const benchmarkOptions = Object.freeze({
  profile: 'unit',
  fileBytes: 1024 * 1024,
  chunkSizeBytes: 256 * 1024,
  rowCount: 8,
  rowPayloadBytes: 64,
  replayAttemptsPerChunk: 2,
  maxDurationMs: 10_000,
  maxHeapUsedBytes: 256 * 1024 * 1024,
});
const expectedGateIds = Object.freeze([
  'built-on-transaction-boundary-v3',
  'deterministic-resume-regression-cases',
  'durable-local-receipts-complete',
  'receipt-only-chunk-transfer-resume',
  'no-duplicate-mutation-work',
  'apply-opens-after-transfer-finalize',
  'unit-storage-performance-budget',
  'hash-count-only-regression-evidence',
  'support-only-release-no-go',
]);
const expectedResumeCursorFields = Object.freeze([
  'planId',
  'resourceKey',
  'localResourceHash',
  'chunkIndex',
  'offsetBytes',
  'sizeBytes',
  'chunkDigest',
  'receiptKey',
  'idempotencyKey',
]);

test('RPP-0763 variant 4 proves chunk transfer resume performs zero duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildVariant4Proof();

  assert.equal(proof.rppId, 'RPP-0763');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0743');
  assert.equal(proof.builtOn.proofId, 'rpp-0743-transaction-boundary-policy-v3');
  assert.equal(proof.builtOn.variant, 3);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourcePolicy.policyId, 'rpp-0703-transaction-boundary-policy');
  assert.equal(proof.builtOn.sourcePolicy.variant, 1);
  assert.equal(proof.builtOn.sourcePolicy.status, 'passed');
  assert.match(proof.builtOn.sourcePolicy.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'unit');
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.storage.receiptBackend, 'lab-file-journal-receipts');
  assert.equal(proof.resources.storage.productionBacked, false);
  assert.equal(proof.resources.storage.chunkReceipts, proof.transfer.chunkCount);
  assert.equal(proof.resources.storage.finalStagingRecordPresent, true);

  assert.deepEqual(proof.transfer.boundaryOrder, [
    'chunk-transfer-transaction',
    'file-staging-finalize-boundary',
    'apply-mutation-transaction',
  ]);
  assert.equal(proof.transfer.fileBytes, benchmarkOptions.fileBytes);
  assert.equal(proof.transfer.chunkSizeBytes, benchmarkOptions.chunkSizeBytes);
  assert.equal(proof.transfer.chunkCount, 4);
  assert.equal(proof.transfer.complete, true);
  assert.equal(proof.transfer.manifestFinalized, true);
  assert.equal(proof.transfer.fileStagingFinalized, true);
  assert.equal(proof.transfer.exactReceiptMatches, proof.transfer.chunkCount);
  assert.equal(proof.transfer.duplicateReceiptKeys, 0);
  assert.equal(proof.transfer.canonicalVisibleDuringTransfer, false);
  assert.match(proof.transfer.planIdHash, /^[a-f0-9]{64}$/);
  assert.match(proof.transfer.resourceKeyHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.resume.status, 'passed');
  assert.equal(proof.resume.receiptOnlyResumeSafe, true);
  assert.equal(proof.resume.chunksSkippedByReceipt, proof.transfer.chunkCount);
  assert.equal(proof.resume.chunksToUpload, 0);
  assert.equal(proof.resume.bytesSkippedByReceipt, proof.transfer.fileBytes);
  assert.equal(proof.resume.bytesToUpload, 0);
  assert.equal(proof.resume.duplicateChunkBytes, 0);
  assert.equal(proof.resume.duplicateMutationWork, 0);
  assert.equal(proof.resume.missingReceiptBlocksSkip, true);
  assert.equal(proof.resume.mismatchedReceiptBlocksSkip, true);
  assert.deepEqual(proof.resume.resumeCursorFields, expectedResumeCursorFields);

  assert.equal(proof.resumeRegression.source, 'local-generated-transaction-boundary-resume-cases');
  assert.equal(proof.resumeRegression.caseCount, 4);
  assert.equal(proof.resumeRegression.deterministicCaseVector, true);
  assert.deepEqual(proof.resumeRegression.chunkCounts, [2, 3, 4, 5]);
  assert.deepEqual(proof.resumeRegression.caseStatuses, ['passed', 'passed', 'passed', 'passed']);
  assert.equal(proof.resumeRegression.totalChunksSkippedByReceipt, 14);
  assert.equal(proof.resumeRegression.totalChunksToUpload, 0);
  assert.equal(proof.resumeRegression.totalBytesToUpload, 0);
  assert.equal(proof.resumeRegression.totalDuplicateChunkBytes, 0);
  assert.equal(proof.resumeRegression.totalDuplicateMutationWork, 0);
  assert.equal(proof.resumeRegression.maxFreshMutationWorkDuringTransferResume, 0);
  assert.equal(proof.resumeRegression.maxMutationWorkBeforeTransferFinalize, 0);
  assert.equal(proof.resumeRegression.duplicateResumeProbeCount, 4);
  assert.equal(proof.resumeRegression.duplicateResumeProbesBlocked, 4);
  assert.equal(proof.resumeRegression.missingReceiptProbesBlocked, 4);

  for (const resumeCase of proof.resumeRegression.cases) {
    assert.equal(resumeCase.status, 'passed');
    assert.equal(resumeCase.transferComplete, true);
    assert.equal(resumeCase.exactReceiptMatches, resumeCase.chunkCount);
    assert.equal(resumeCase.receiptMatches.length, resumeCase.chunkCount);
    assert.ok(resumeCase.receiptMatches.every((match) => match.matched === true));
    assert.equal(resumeCase.duplicateReceiptKeys, 0);
    assert.equal(resumeCase.canonicalVisibleDuringTransfer, false);
    assert.equal(resumeCase.chunksSkippedByReceipt, resumeCase.chunkCount);
    assert.equal(resumeCase.chunksToUpload, 0);
    assert.equal(resumeCase.bytesSkippedByReceipt, resumeCase.fileBytes);
    assert.equal(resumeCase.bytesToUpload, 0);
    assert.equal(resumeCase.duplicateChunkBytes, 0);
    assert.equal(resumeCase.resumeDuplicateMutationWork, 0);
    assert.equal(resumeCase.applyDuplicateMutationWork, 0);
    assert.equal(resumeCase.duplicateMutationWork, 0);
    assert.equal(resumeCase.mutationWorkReplayedBeforeTransferFinalize, 0);
    assert.equal(resumeCase.freshMutationWorkDuringTransferResume, 0);
    assert.equal(resumeCase.noDuplicateMutationWork, true);
    assert.equal(resumeCase.applyOpenedAfterTransferFinalize, true);
    assert.equal(resumeCase.mutationWorkAllowedDuringTransferResume, false);
    assert.ok(resumeCase.transferFinalizeSequence < resumeCase.firstApplyBoundarySequence);
    assert.deepEqual(resumeCase.resumeCursorFields, expectedResumeCursorFields);
    assert.equal(resumeCase.duplicateResumeProbe.blocked, true);
    assert.equal(resumeCase.duplicateResumeProbe.status, 'blocked');
    assert.equal(resumeCase.duplicateResumeProbe.resumeDuplicateMutationWork > 0, true);
    assert.equal(resumeCase.duplicateResumeProbe.noDuplicateMutationWork, false);
    assert.equal(resumeCase.missingReceiptProbe.blocked, true);
    assert.equal(resumeCase.missingReceiptProbe.status, 'blocked');
    assert.match(resumeCase.planIdHash, /^[a-f0-9]{64}$/);
    assert.match(resumeCase.resourceKeyHash, /^[a-f0-9]{64}$/);
    assert.match(resumeCase.caseHash, /^[a-f0-9]{64}$/);
    assert.match(resumeCase.policyHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.equal(proof.apply.applyOpenedAfterTransferFinalize, true);
  assert.equal(proof.apply.mutationWorkAllowedDuringTransferResume, false);
  assert.equal(proof.apply.mutationWorkReplayedBeforeTransferFinalize, 0);
  assert.equal(proof.apply.freshMutationWorkDuringTransferResume, 0);
  assert.equal(proof.apply.duplicateMutationWork, 0);
  assert.equal(proof.apply.noDuplicateMutationWork, true);

  assert.equal(proof.replay.idempotentReplaySafe, true);
  assert.equal(proof.replay.duplicateMutationWork, 0);
  assert.equal(proof.replay.applyBoundaryOpenedDuringReplay, false);

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
  ]);
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
  assert.ok(proof.unsafe.missingReceipt.blockedBy.includes('durable-local-receipts-complete'));
  assert.equal(proof.unsafe.resumeUpload.updated, false);
  assert.equal(proof.unsafe.resumeUpload.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.resumeUpload.blockedBy.includes('receipt-only-chunk-transfer-resume'));
  assert.equal(proof.unsafe.duplicateMutationWork.updated, false);
  assert.equal(proof.unsafe.duplicateMutationWork.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
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
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertHashOnlyVariant4Evidence(proof);
});

test('RPP-0763 variant 4 fails closed when resume evidence would duplicate mutation work', () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveTransactionBoundaryResumeRegressionProof(evidence);
  const unsafeDecisions = unsafeResumeRegressionDecisions(evidence);

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(safeDecision.recomputedGates.map((gate) => gate.status), [
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

  assert.equal(unsafeDecisions.missingReceipt.updated, false);
  assert.ok(unsafeDecisions.missingReceipt.blockedBy.includes('durable-local-receipts-complete'));
  assert.equal(unsafeDecisions.resumeUpload.updated, false);
  assert.ok(unsafeDecisions.resumeUpload.blockedBy.includes('receipt-only-chunk-transfer-resume'));
  assert.equal(unsafeDecisions.duplicateMutationWork.updated, false);
  assert.ok(unsafeDecisions.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
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
    assertHashOnlyVariant4Evidence(decision);
  }
});

function buildVariant4Proof() {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveTransactionBoundaryResumeRegressionProof(evidence);
  const unsafe = projectUnsafeDecisions(unsafeResumeRegressionDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'transfer',
  );
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('transaction-boundary-v3-carried-forward',
      evidence.builtOn.status === 'passed' && evidence.builtOn.variant === 3, {
      builtOnStatus: evidence.builtOn.status,
      builtOnVariant: evidence.builtOn.variant,
      sourcePolicyEvidenceHash: evidence.builtOn.sourcePolicy.evidenceHash,
    }),
    proofGate('resume-regression-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-resume-regression-evidence-fails-closed',
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
    rppId: 'RPP-0763',
    proofId,
    variant: 4,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: evidence.benchmark,
    transfer: evidence.transfer,
    resume: evidence.resume,
    resumeRegression: evidence.resumeRegression,
    apply: evidence.apply,
    replay: evidence.replay,
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
      mode: 'hash-count-only-transaction-boundary-resume-regression',
      rawValueEvidenceLeaks: variant4EvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicVariant4EvidenceProjection(evidence)),
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
  const generatedCases = generatedResumeRegressionCases();
  const repeatedCases = generatedResumeRegressionCases();
  const evidence = buildTransactionBoundaryResumeRegressionEvidence({
    report,
    generatedCases,
    repeatedCases,
  });
  recordCorrectnessGates(evidence);
  return { report, evidence };
}

function runUnitBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0763-boundary-v4-'));
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

function buildTransactionBoundaryResumeRegressionEvidence({
  report,
  generatedCases,
  repeatedCases,
}) {
  const policy = report.evidence.transactionBoundaryPolicy;
  const replay = report.evidence.guardedTransfer.replayIdempotency;
  const productionBlockers = productionThroughputBlockers(report);
  const caseHashes = generatedCases.map((resumeCase) => resumeCase.caseHash);
  const repeatedCaseHashes = repeatedCases.map((resumeCase) => resumeCase.caseHash);
  const deterministicCaseVector = sameArray(caseHashes, repeatedCaseHashes);

  return {
    schemaVersion: 1,
    rppId: 'RPP-0763',
    proofId,
    variant: 4,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0743',
      proofId: 'rpp-0743-transaction-boundary-policy-v3',
      variant: 3,
      status: policy.status === 'passed' ? 'passed' : 'blocked',
      sourcePolicy: {
        policyId: policy.policyId,
        variant: policy.variant,
        status: policy.status,
        evidenceHash: policy.evidenceHash,
      },
    },
    benchmark: publicBenchmarkProjection(report, productionBlockers),
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
      journals: {
        successRecords: report.resources.journals.successRecords,
        allJournalsIntegrityOk: report.evidence.journal.allJournalsIntegrityOk,
        durableJournalsContainNoRawValues:
          report.evidence.redaction.durableJournalsContainNoRawValues,
      },
      runtimeBudget: report.resources.runtimeBudget,
    },
    transfer: {
      boundaryOrder: policy.boundaryOrder,
      planIdHash: digest(report.resources.transfer.planId),
      resourceKeyHash: digest(report.resources.transfer.resourceKey),
      fileBytes: report.shape.fileBytes,
      chunkSizeBytes: report.shape.chunkSizeBytes,
      chunkCount: report.shape.chunkCount,
      complete: policy.transfer.complete,
      manifestFinalized: policy.transfer.manifestFinalized,
      fileStagingFinalized: policy.transfer.fileStagingFinalized,
      manifestFinalizeSequence: policy.transfer.manifestFinalizeSequence,
      transferFinalizeSequence: policy.transfer.transferFinalizeSequence,
      exactReceiptMatches: policy.transfer.exactReceiptMatches,
      duplicateReceiptKeys: policy.transfer.duplicateReceiptKeys,
      canonicalVisibleDuringTransfer: policy.transfer.canonicalVisibleDuringTransfer,
      receiptMatches: policy.receiptMatches,
    },
    resume: {
      status: policy.resume.status,
      receiptOnlyResumeSafe: policy.resume.receiptOnlyResumeSafe,
      chunksSkippedByReceipt: policy.resume.chunksSkippedByReceipt,
      chunksToUpload: policy.resume.chunksToUpload,
      bytesSkippedByReceipt: policy.resume.bytesSkippedByReceipt,
      bytesToUpload: policy.resume.bytesToUpload,
      duplicateChunkBytes: policy.resume.duplicateChunkBytes,
      duplicateMutationWork: policy.resume.duplicateMutationWork,
      missingReceiptBlocksSkip: policy.resume.missingReceiptBlocksSkip,
      mismatchedReceiptBlocksSkip: policy.resume.mismatchedReceiptBlocksSkip,
      resumeCursorFields: policy.resume.resumeCursorFields,
    },
    resumeRegression: {
      source: 'local-generated-transaction-boundary-resume-cases',
      resumeVariant: 'transaction-boundary-policy-v4',
      caseCount: generatedCases.length,
      deterministicCaseVector,
      chunkCounts: generatedCases.map((resumeCase) => resumeCase.chunkCount),
      caseStatuses: generatedCases.map((resumeCase) => resumeCase.status),
      caseHashes,
      repeatedCaseHashes,
      totalChunksSkippedByReceipt: generatedCases.reduce(
        (sum, resumeCase) => sum + resumeCase.chunksSkippedByReceipt,
        0,
      ),
      totalChunksToUpload: generatedCases.reduce(
        (sum, resumeCase) => sum + resumeCase.chunksToUpload,
        0,
      ),
      totalBytesToUpload: generatedCases.reduce(
        (sum, resumeCase) => sum + resumeCase.bytesToUpload,
        0,
      ),
      totalDuplicateChunkBytes: generatedCases.reduce(
        (sum, resumeCase) => sum + resumeCase.duplicateChunkBytes,
        0,
      ),
      totalDuplicateMutationWork: generatedCases.reduce(
        (sum, resumeCase) => sum + resumeCase.duplicateMutationWork,
        0,
      ),
      maxFreshMutationWorkDuringTransferResume: Math.max(
        ...generatedCases.map((resumeCase) => resumeCase.freshMutationWorkDuringTransferResume),
      ),
      maxMutationWorkBeforeTransferFinalize: Math.max(
        ...generatedCases.map((resumeCase) =>
          resumeCase.mutationWorkReplayedBeforeTransferFinalize),
      ),
      duplicateResumeProbeCount: generatedCases.length,
      duplicateResumeProbesBlocked: generatedCases.filter((resumeCase) =>
        resumeCase.duplicateResumeProbe.blocked).length,
      missingReceiptProbesBlocked: generatedCases.filter((resumeCase) =>
        resumeCase.missingReceiptProbe.blocked).length,
      cases: generatedCases,
    },
    apply: {
      transaction: policy.apply.transaction,
      opensAfter: policy.apply.opensAfter,
      firstApplyBoundarySequence: policy.apply.firstApplyBoundarySequence,
      applyOpenedAfterTransferFinalize: policy.apply.applyOpenedAfterTransferFinalize,
      mutationWorkAllowedDuringTransferResume: policy.apply.mutationWorkAllowedDuringTransferResume,
      mutationWorkReplayedBeforeTransferFinalize:
        policy.apply.mutationWorkReplayedBeforeTransferFinalize,
      freshMutationWorkDuringTransferResume: policy.apply.freshMutationWorkDuringTransferResume,
      duplicateMutationWork: policy.apply.duplicateMutationWork,
      noDuplicateMutationWork: policy.apply.noDuplicateMutationWork,
      appliedMutations: report.results.appliedMutations,
      liveRemoteMutationPreconditions:
        report.evidence.preconditions.liveRemoteMutationPreconditions,
    },
    replay: {
      proofId: replay.proofId,
      variant: replay.variant,
      status: replay.status,
      chunkCount: replay.chunkCount,
      replayAttemptsPerChunk: replay.replayAttemptsPerChunk,
      attemptedReplayCount: replay.attemptedReplayCount,
      idempotentSkips: replay.idempotentSkips,
      idempotentReplaySafe: replay.idempotentReplaySafe,
      duplicateChunkBytes: replay.bytes.duplicateChunkBytes,
      duplicateReceiptRecordsWritten: replay.receipts.duplicateReceiptRecordsWritten,
      duplicateMutationWork: replay.mutationWork.duplicateMutationWork,
      noDuplicateMutationWork: replay.mutationWork.noDuplicateMutationWork,
      applyBoundaryOpenedDuringReplay: replay.mutationWork.applyBoundaryOpenedDuringReplay,
      evidenceHash: replay.evidenceHash,
    },
    release: supportOnlyReleasePosture(report, productionBlockers),
  };
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeResumeRegressionProofGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveTransactionBoundaryResumeRegressionProof(evidence) {
  const recomputedGates = recomputeResumeRegressionProofGates(evidence);
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
        resumeRegressionHash: sha256({
          caseCount: evidence.resumeRegression.caseCount,
          caseHashes: evidence.resumeRegression.caseHashes,
          totalChunksSkippedByReceipt: evidence.resumeRegression.totalChunksSkippedByReceipt,
          totalChunksToUpload: evidence.resumeRegression.totalChunksToUpload,
          totalDuplicateMutationWork: evidence.resumeRegression.totalDuplicateMutationWork,
          duplicateResumeProbesBlocked: evidence.resumeRegression.duplicateResumeProbesBlocked,
        }),
        transferBoundaryHash: sha256({
          transfer: evidence.transfer,
          resume: evidence.resume,
          apply: evidence.apply,
        }),
        duplicateMutationWork: evidence.resume.duplicateMutationWork
          + evidence.apply.duplicateMutationWork
          + evidence.replay.duplicateMutationWork
          + evidence.resumeRegression.totalDuplicateMutationWork,
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
    hashCountOnlyOutput: output ? variant4EvidenceHasNoRawValues(output) : false,
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

function recomputeResumeRegressionProofGates(evidence) {
  const sourcePolicy = evidence.builtOn?.sourcePolicy || {};
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const storage = resources.storage || {};
  const processResources = resources.process || {};
  const journals = resources.journals || {};
  const transfer = evidence.transfer || {};
  const resume = evidence.resume || {};
  const resumeRegression = evidence.resumeRegression || {};
  const cases = Array.isArray(resumeRegression.cases) ? resumeRegression.cases : [];
  const apply = evidence.apply || {};
  const replay = evidence.replay || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const receiptMatches = Array.isArray(transfer.receiptMatches)
    ? transfer.receiptMatches
    : [];
  const generatedCasesCovered =
    resumeRegression.source === 'local-generated-transaction-boundary-resume-cases'
    && resumeRegression.resumeVariant === 'transaction-boundary-policy-v4'
    && resumeRegression.caseCount === 4
    && resumeRegression.caseCount === cases.length
    && resumeRegression.deterministicCaseVector === true
    && sameArray(resumeRegression.caseHashes || [], resumeRegression.repeatedCaseHashes || [])
    && sameArray(resumeRegression.chunkCounts || [], [2, 3, 4, 5])
    && resumeRegression.caseStatuses?.every((status) => status === 'passed');
  const durableReceiptComplete = transfer.complete === true
    && transfer.manifestFinalized === true
    && transfer.fileStagingFinalized === true
    && transfer.exactReceiptMatches === transfer.chunkCount
    && receiptMatches.length === transfer.chunkCount
    && receiptMatches.every((match) => match.matched === true)
    && transfer.duplicateReceiptKeys === 0
    && transfer.canonicalVisibleDuringTransfer === false
    && storage.receiptBackend === 'lab-file-journal-receipts'
    && storage.localStorageProof === 'support-only-lab-file-journal'
    && storage.productionBacked === false
    && storage.chunkReceipts === transfer.chunkCount
    && storage.finalStagingRecordPresent === true
    && cases.every((resumeCase) => (
      resumeCase.transferComplete === true
      && resumeCase.exactReceiptMatches === resumeCase.chunkCount
      && resumeCase.receiptMatches.length === resumeCase.chunkCount
      && resumeCase.receiptMatches.every((match) => match.matched === true)
      && resumeCase.duplicateReceiptKeys === 0
      && resumeCase.canonicalVisibleDuringTransfer === false
      && resumeCase.missingReceiptProbe.blocked === true
    ));
  const receiptOnlyResumeSafe = resume.status === 'passed'
    && resume.receiptOnlyResumeSafe === true
    && resume.chunksSkippedByReceipt === transfer.chunkCount
    && resume.chunksToUpload === 0
    && resume.bytesSkippedByReceipt === transfer.fileBytes
    && resume.bytesToUpload === 0
    && resume.duplicateChunkBytes === 0
    && resume.duplicateMutationWork === 0
    && resume.missingReceiptBlocksSkip === true
    && resume.mismatchedReceiptBlocksSkip === true
    && sameArray(resume.resumeCursorFields || [], expectedResumeCursorFields)
    && resumeRegression.totalChunksToUpload === 0
    && resumeRegression.totalBytesToUpload === 0
    && resumeRegression.totalDuplicateChunkBytes === 0
    && cases.every((resumeCase) => (
      resumeCase.chunksSkippedByReceipt === resumeCase.chunkCount
      && resumeCase.chunksToUpload === 0
      && resumeCase.bytesSkippedByReceipt === resumeCase.fileBytes
      && resumeCase.bytesToUpload === 0
      && resumeCase.duplicateChunkBytes === 0
      && resumeCase.missingReceiptBlocksSkip === true
      && resumeCase.mismatchedReceiptBlocksSkip === true
      && sameArray(resumeCase.resumeCursorFields || [], expectedResumeCursorFields)
    ));
  const noDuplicateMutationWork = resumeRegression.totalDuplicateMutationWork === 0
    && resumeRegression.maxFreshMutationWorkDuringTransferResume === 0
    && resumeRegression.maxMutationWorkBeforeTransferFinalize === 0
    && resumeRegression.duplicateResumeProbeCount === cases.length
    && resumeRegression.duplicateResumeProbesBlocked === cases.length
    && resume.duplicateMutationWork === 0
    && apply.mutationWorkReplayedBeforeTransferFinalize === 0
    && apply.freshMutationWorkDuringTransferResume === 0
    && apply.duplicateMutationWork === 0
    && apply.noDuplicateMutationWork === true
    && replay.duplicateMutationWork === 0
    && replay.noDuplicateMutationWork === true
    && cases.every((resumeCase) => (
      resumeCase.resumeDuplicateMutationWork === 0
      && resumeCase.applyDuplicateMutationWork === 0
      && resumeCase.duplicateMutationWork === 0
      && resumeCase.mutationWorkReplayedBeforeTransferFinalize === 0
      && resumeCase.freshMutationWorkDuringTransferResume === 0
      && resumeCase.noDuplicateMutationWork === true
      && resumeCase.duplicateResumeProbe.blocked === true
      && resumeCase.duplicateResumeProbe.resumeDuplicateMutationWork > 0
      && resumeCase.duplicateResumeProbe.noDuplicateMutationWork === false
    ));
  const applyOpensAfterTransferFinalize = apply.applyOpenedAfterTransferFinalize === true
    && transfer.transferFinalizeSequence < apply.firstApplyBoundarySequence
    && apply.mutationWorkAllowedDuringTransferResume === false
    && replay.applyBoundaryOpenedDuringReplay === false
    && cases.every((resumeCase) => (
      resumeCase.applyOpenedAfterTransferFinalize === true
      && resumeCase.transferFinalizeSequence < resumeCase.firstApplyBoundarySequence
      && resumeCase.mutationWorkAllowedDuringTransferResume === false
    ));
  const runtimeWithinBudget = runtime.profile === 'unit'
    && runtime.budgetStatus === 'passed'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && journals.allJournalsIntegrityOk === true
    && journals.durableJournalsContainNoRawValues === true;

  return [
    proofGate('built-on-transaction-boundary-v3', evidence.builtOn?.rppId === 'RPP-0743'
      && evidence.builtOn?.proofId === 'rpp-0743-transaction-boundary-policy-v3'
      && evidence.builtOn?.variant === 3
      && evidence.builtOn?.status === 'passed'
      && sourcePolicy.policyId === 'rpp-0703-transaction-boundary-policy'
      && sourcePolicy.variant === 1
      && sourcePolicy.status === 'passed'
      && isSha256Hash(sourcePolicy.evidenceHash), {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      sourcePolicyStatus: sourcePolicy.status,
      sourcePolicyVariant: sourcePolicy.variant,
    }),
    proofGate('deterministic-resume-regression-cases', generatedCasesCovered, {
      caseCount: resumeRegression.caseCount,
      chunkCounts: resumeRegression.chunkCounts,
      deterministicCaseVector: resumeRegression.deterministicCaseVector,
    }),
    proofGate('durable-local-receipts-complete', durableReceiptComplete, {
      exactReceiptMatches: transfer.exactReceiptMatches,
      chunkCount: transfer.chunkCount,
      generatedCaseCount: cases.length,
      missingReceiptProbesBlocked: resumeRegression.missingReceiptProbesBlocked,
    }),
    proofGate('receipt-only-chunk-transfer-resume', receiptOnlyResumeSafe, {
      chunksSkippedByReceipt: resume.chunksSkippedByReceipt,
      chunksToUpload: resume.chunksToUpload,
      totalChunksToUpload: resumeRegression.totalChunksToUpload,
      totalBytesToUpload: resumeRegression.totalBytesToUpload,
      totalDuplicateChunkBytes: resumeRegression.totalDuplicateChunkBytes,
    }),
    proofGate('no-duplicate-mutation-work', noDuplicateMutationWork, {
      resumeDuplicateMutationWork: resume.duplicateMutationWork,
      applyDuplicateMutationWork: apply.duplicateMutationWork,
      replayDuplicateMutationWork: replay.duplicateMutationWork,
      totalDuplicateMutationWork: resumeRegression.totalDuplicateMutationWork,
      duplicateResumeProbesBlocked: resumeRegression.duplicateResumeProbesBlocked,
    }),
    proofGate('apply-opens-after-transfer-finalize', applyOpensAfterTransferFinalize, {
      transferFinalizeSequence: transfer.transferFinalizeSequence,
      firstApplyBoundarySequence: apply.firstApplyBoundarySequence,
      mutationWorkAllowedDuringTransferResume: apply.mutationWorkAllowedDuringTransferResume,
    }),
    proofGate('unit-storage-performance-budget', runtimeWithinBudget, {
      profile: runtime.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
      allJournalsIntegrityOk: journals.allJournalsIntegrityOk,
    }),
    proofGate('hash-count-only-regression-evidence',
      variant4EvidenceHasNoRawValues(publicVariant4EvidenceProjection(evidence)), {
        rawValueEvidenceLeaks:
          variant4EvidenceHasNoRawValues(publicVariant4EvidenceProjection(evidence)) ? 0 : 1,
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

function unsafeResumeRegressionDecisions(evidence) {
  const missingReceipt = withPassedStatus(clone(evidence));
  missingReceipt.resumeRegression.cases[0].receiptMatches[0].matched = false;
  missingReceipt.resumeRegression.cases[0].exactReceiptMatches -= 1;
  missingReceipt.resumeRegression.cases[0].transferComplete = false;
  missingReceipt.resumeRegression.missingReceiptProbesBlocked -= 1;

  const resumeUpload = withPassedStatus(clone(evidence));
  resumeUpload.resumeRegression.cases[1].chunksToUpload = 1;
  resumeUpload.resumeRegression.cases[1].bytesToUpload =
    resumeUpload.resumeRegression.cases[1].chunkSizeBytes;
  resumeUpload.resumeRegression.totalChunksToUpload = 1;
  resumeUpload.resumeRegression.totalBytesToUpload =
    resumeUpload.resumeRegression.cases[1].chunkSizeBytes;

  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.resumeRegression.cases[2].resumeDuplicateMutationWork = 1;
  duplicateMutationWork.resumeRegression.cases[2].applyDuplicateMutationWork = 1;
  duplicateMutationWork.resumeRegression.cases[2].duplicateMutationWork = 2;
  duplicateMutationWork.resumeRegression.cases[2].noDuplicateMutationWork = false;
  duplicateMutationWork.resumeRegression.totalDuplicateMutationWork = 2;
  duplicateMutationWork.resumeRegression.maxFreshMutationWorkDuringTransferResume = 1;
  duplicateMutationWork.resumeRegression.duplicateResumeProbesBlocked -= 1;

  const earlyApplyBoundary = withPassedStatus(clone(evidence));
  earlyApplyBoundary.resumeRegression.cases[3].firstApplyBoundarySequence =
    earlyApplyBoundary.resumeRegression.cases[3].transferFinalizeSequence;
  earlyApplyBoundary.resumeRegression.cases[3].applyOpenedAfterTransferFinalize = false;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingReceipt: resolveTransactionBoundaryResumeRegressionProof(missingReceipt),
    resumeUpload: resolveTransactionBoundaryResumeRegressionProof(resumeUpload),
    duplicateMutationWork: resolveTransactionBoundaryResumeRegressionProof(duplicateMutationWork),
    earlyApplyBoundary: resolveTransactionBoundaryResumeRegressionProof(earlyApplyBoundary),
    overBudget: resolveTransactionBoundaryResumeRegressionProof(overBudget),
    prematurePassStatus: resolveTransactionBoundaryResumeRegressionProof(prematurePassStatus),
  };
}

function generatedResumeRegressionCases() {
  return [2, 3, 4, 5].map((chunkCount) => buildResumeRegressionCase({
    caseId: `resume-${chunkCount}-chunks`,
    fileBytes: chunkCount * benchmarkOptions.chunkSizeBytes,
    chunkSizeBytes: benchmarkOptions.chunkSizeBytes,
    chunkCount,
  }));
}

function buildResumeRegressionCase(spec) {
  const planId = `plan-${proofId}-${spec.caseId}`;
  const resourceKey = `resource-${proofId}-${spec.caseId}`;
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
  const manifestDigest = sha256({
    proofId,
    caseId: spec.caseId,
    chunkCount: spec.chunkCount,
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
      type: 'chunk-manifest-finalized',
      sequence: spec.chunkCount + 1,
      planId,
      resourceKey,
      manifestDigest,
    },
    {
      type: 'file-staging-finalized',
      sequence: spec.chunkCount + 2,
      planId,
      resourceKey,
      assembledHash: localResourceHash,
    },
    {
      type: 'apply-staged',
      sequence: spec.chunkCount + 3,
    },
    {
      type: 'mutation-observed',
      sequence: spec.chunkCount + 4,
    },
    {
      type: 'mutation-applied',
      sequence: spec.chunkCount + 5,
    },
  ];
  const policy = buildChunkTransferTransactionBoundaryPolicy({
    planId,
    resourceKey,
    manifestDigest,
    assembledHash: localResourceHash,
    manifestEntries,
    chunkReceiptRecords,
    journalRecords,
    resumeRecords: [],
  });
  const duplicateResumePolicy = buildChunkTransferTransactionBoundaryPolicy({
    planId,
    resourceKey,
    manifestDigest,
    assembledHash: localResourceHash,
    manifestEntries,
    chunkReceiptRecords,
    journalRecords,
    resumeRecords: [
      { type: 'mutation-observed', sequence: 1 },
      { type: 'mutation-applied', sequence: 2 },
    ],
  });
  const missingReceiptPolicy = buildChunkTransferTransactionBoundaryPolicy({
    planId,
    resourceKey,
    manifestDigest,
    assembledHash: localResourceHash,
    manifestEntries,
    chunkReceiptRecords: chunkReceiptRecords.slice(1),
    journalRecords,
    resumeRecords: [],
  });
  const publicCase = {
    caseId: spec.caseId,
    status: policy.status,
    planIdHash: digest(planId),
    resourceKeyHash: digest(resourceKey),
    localResourceHashHash: digest(localResourceHash),
    fileBytes: spec.fileBytes,
    chunkSizeBytes: spec.chunkSizeBytes,
    chunkCount: spec.chunkCount,
    boundaryOrder: policy.boundaryOrder,
    transferComplete: policy.transfer.complete,
    manifestFinalized: policy.transfer.manifestFinalized,
    fileStagingFinalized: policy.transfer.fileStagingFinalized,
    manifestFinalizeSequence: policy.transfer.manifestFinalizeSequence,
    transferFinalizeSequence: policy.transfer.transferFinalizeSequence,
    exactReceiptMatches: policy.transfer.exactReceiptMatches,
    duplicateReceiptKeys: policy.transfer.duplicateReceiptKeys,
    canonicalVisibleDuringTransfer: policy.transfer.canonicalVisibleDuringTransfer,
    receiptOnlyResumeSafe: policy.resume.receiptOnlyResumeSafe,
    chunksSkippedByReceipt: policy.resume.chunksSkippedByReceipt,
    chunksToUpload: policy.resume.chunksToUpload,
    bytesSkippedByReceipt: policy.resume.bytesSkippedByReceipt,
    bytesToUpload: policy.resume.bytesToUpload,
    duplicateChunkBytes: policy.resume.duplicateChunkBytes,
    resumeDuplicateMutationWork: policy.resume.duplicateMutationWork,
    missingReceiptBlocksSkip: policy.resume.missingReceiptBlocksSkip,
    mismatchedReceiptBlocksSkip: policy.resume.mismatchedReceiptBlocksSkip,
    resumeCursorFields: policy.resume.resumeCursorFields,
    firstApplyBoundarySequence: policy.apply.firstApplyBoundarySequence,
    applyOpenedAfterTransferFinalize: policy.apply.applyOpenedAfterTransferFinalize,
    mutationWorkAllowedDuringTransferResume: policy.apply.mutationWorkAllowedDuringTransferResume,
    mutationWorkReplayedBeforeTransferFinalize:
      policy.apply.mutationWorkReplayedBeforeTransferFinalize,
    freshMutationWorkDuringTransferResume: policy.apply.freshMutationWorkDuringTransferResume,
    applyDuplicateMutationWork: policy.apply.duplicateMutationWork,
    duplicateMutationWork: policy.resume.duplicateMutationWork + policy.apply.duplicateMutationWork,
    noDuplicateMutationWork: policy.apply.noDuplicateMutationWork,
    duplicateResumeProbe: {
      status: duplicateResumePolicy.status,
      blocked: duplicateResumePolicy.status === 'blocked'
        && duplicateResumePolicy.resume.receiptOnlyResumeSafe === false
        && duplicateResumePolicy.resume.duplicateMutationWork > 0
        && duplicateResumePolicy.apply.noDuplicateMutationWork === false,
      resumeDuplicateMutationWork: duplicateResumePolicy.resume.duplicateMutationWork,
      applyDuplicateMutationWork: duplicateResumePolicy.apply.duplicateMutationWork,
      noDuplicateMutationWork: duplicateResumePolicy.apply.noDuplicateMutationWork,
    },
    missingReceiptProbe: {
      status: missingReceiptPolicy.status,
      blocked: missingReceiptPolicy.status === 'blocked'
        && missingReceiptPolicy.resume.receiptOnlyResumeSafe === false
        && missingReceiptPolicy.transfer.exactReceiptMatches < spec.chunkCount,
      exactReceiptMatches: missingReceiptPolicy.transfer.exactReceiptMatches,
      chunksToUpload: missingReceiptPolicy.resume.chunksToUpload,
    },
    receiptMatches: policy.receiptMatches,
    policyHash: sha256(policy),
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

function publicBenchmarkProjection(report, productionBlockers) {
  return {
    benchmark: report.runtime.benchmarkId,
    profile: report.runtime.profile,
    runtime: {
      generatedAt: report.runtime.generatedAt,
      budgetStatus: report.runtime.budgetStatus,
      budgets: report.runtime.budgets,
    },
    shape: {
      fileBytes: report.shape.fileBytes,
      chunkSizeBytes: report.shape.chunkSizeBytes,
      chunkCount: report.shape.chunkCount,
      rowCount: report.shape.rowCount,
      mutations: report.shape.mutations,
    },
    rolloutSafetySummary: report.rolloutSafetyGates.summary,
    productionBlockers,
    claims: {
      labGuardedExecutorEvidence: report.claims.labGuardedExecutorEvidence,
      productionThroughputAllowed: report.claims.productionThroughput.allowed,
      productionThroughputStatus: report.claims.productionThroughput.status,
    },
  };
}

function supportOnlyReleasePosture(report, productionBlockers) {
  return {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: report.throughput.productionThroughput,
    speedClaimsAllowed: report.rolloutSafetyGates.summary.speedClaimsAllowed,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: unique([
      ...productionBlockers,
      'live-production-service-not-supplied',
      'release-verifier-carry-through-not-claimed',
    ]),
  };
}

function publicVariant4EvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    runtime: evidence.runtime,
    resources: evidence.resources,
    transfer: evidence.transfer,
    resume: evidence.resume,
    resumeRegression: evidence.resumeRegression,
    apply: evidence.apply,
    replay: evidence.replay,
    release: evidence.release,
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

function assertHashOnlyVariant4Evidence(value) {
  assert.equal(variant4EvidenceHasNoRawValues(value), true);
}

function variant4EvidenceHasNoRawValues(value) {
  return !rawVariant4EvidencePattern().test(JSON.stringify(value));
}

function rawVariant4EvidencePattern() {
  return /wp-content|catalog-export|row-payload|commerce|payments|post_content|option_value|meta_value|customer secret|private option value|https?:\/\/|Bearer\s+|Basic\s+/i;
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function isSha256Hash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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
