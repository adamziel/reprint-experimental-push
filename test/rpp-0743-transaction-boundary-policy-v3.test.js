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

const proofId = 'rpp-0743-transaction-boundary-policy-v3';
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
  'built-on-transaction-policy-passed',
  'durable-local-receipts-complete',
  'receipt-only-transfer-resume',
  'chunk-replay-idempotency-retained',
  'no-duplicate-mutation-work',
  'apply-opens-after-transfer-finalize',
  'unit-storage-performance-budget',
  'hash-only-storage-performance-evidence',
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
const expectedReplayCursorFields = Object.freeze([
  'planId',
  'resourceKey',
  'chunkIndex',
  'offsetBytes',
  'sizeBytes',
  'chunkDigest',
  'receiptKey',
  'idempotencyKey',
]);

test('RPP-0743 variant 3 proves generated transaction boundary storage evidence resumes without duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildVariant3Proof();

  assert.equal(proof.rppId, 'RPP-0743');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 3);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0723');
  assert.equal(proof.builtOn.proofId, 'rpp-0723-transaction-boundary-policy-v2');
  assert.equal(proof.builtOn.variant, 2);
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
  assert.equal(proof.transfer.receiptMatches.length, proof.transfer.chunkCount);
  assert.ok(proof.transfer.receiptMatches.every((match) => match.matched === true));
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

  assert.equal(proof.apply.applyOpenedAfterTransferFinalize, true);
  assert.equal(proof.apply.mutationWorkAllowedDuringTransferResume, false);
  assert.equal(proof.apply.mutationWorkReplayedBeforeTransferFinalize, 0);
  assert.equal(proof.apply.freshMutationWorkDuringTransferResume, 0);
  assert.equal(proof.apply.duplicateMutationWork, 0);
  assert.equal(proof.apply.noDuplicateMutationWork, true);
  assert.equal(proof.apply.appliedMutations, proof.resources.apply.mutationResources);
  assert.equal(proof.apply.liveRemoteMutationPreconditions, proof.resources.apply.mutationResources);

  assert.equal(proof.replay.status, 'passed');
  assert.equal(proof.replay.idempotentReplaySafe, true);
  assert.equal(proof.replay.replayAttemptsPerChunk, 2);
  assert.equal(proof.replay.attemptedReplayCount, proof.transfer.chunkCount * 2);
  assert.equal(proof.replay.idempotentSkips, proof.replay.attemptedReplayCount);
  assert.equal(proof.replay.bytesRewrittenDuringReplay, 0);
  assert.equal(proof.replay.duplicateChunkBytes, 0);
  assert.equal(proof.replay.duplicateReceiptRecordsWritten, 0);
  assert.equal(proof.replay.duplicateMutationWork, 0);
  assert.equal(proof.replay.applyBoundaryOpenedDuringReplay, false);
  assert.ok(Object.values(proof.replay.failClosed).every((value) => value === true));

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
  assert.equal(proof.correctness.hashOnlyTransactionOutput, true);
  assert.equal(proof.correctness.transactionOutputEmittedAfterGates, true);
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
  assert.ok(proof.unsafe.missingReceipt.blockedBy.includes('receipt-only-transfer-resume'));
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
  assertHashOnlyTransactionEvidence(proof);
});

test('RPP-0743 variant 3 fails closed for stale transaction boundary evidence', () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveTransactionBoundaryStoragePerformanceProof(evidence);
  const unsafeDecisions = unsafeTransactionBoundaryDecisions(evidence);

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
  assert.ok(unsafeDecisions.missingReceipt.blockedBy.includes('receipt-only-transfer-resume'));
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
    assertHashOnlyTransactionEvidence(decision);
  }
});

function buildVariant3Proof() {
  const { report, evidence } = buildRecordedEvidence();
  const safeDecision = resolveTransactionBoundaryStoragePerformanceProof(evidence);
  const unsafe = projectUnsafeDecisions(unsafeTransactionBoundaryDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'transfer',
  );
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('transaction-boundary-policy-report-passed',
      report.evidence.transactionBoundaryPolicy.status === 'passed', {
        policyStatus: report.evidence.transactionBoundaryPolicy.status,
        policyEvidenceHash: report.evidence.transactionBoundaryPolicy.evidenceHash,
      }),
    proofGate('transaction-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-transaction-boundary-evidence-fails-closed',
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
    rppId: 'RPP-0743',
    proofId,
    variant: 3,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: evidence.benchmark,
    transfer: evidence.transfer,
    resume: evidence.resume,
    apply: evidence.apply,
    replay: evidence.replay,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyTransactionOutput: safeDecision.hashOnlyTransactionOutput,
      transactionOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-and-count-only-transaction-boundary-storage-performance',
      rawValueEvidenceLeaks: transactionEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicTransactionEvidenceProjection(evidence)),
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
  const evidence = buildTransactionBoundaryStoragePerformanceEvidence({ report });
  recordCorrectnessGates(evidence);
  return { report, evidence };
}

function runUnitBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0743-boundary-v3-'));
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

function buildTransactionBoundaryStoragePerformanceEvidence({ report }) {
  const policy = report.evidence.transactionBoundaryPolicy;
  const replay = report.evidence.guardedTransfer.replayIdempotency;
  const productionBlockers = productionThroughputBlockers(report);

  return {
    schemaVersion: 1,
    rppId: 'RPP-0743',
    proofId,
    variant: 3,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0723',
      proofId: 'rpp-0723-transaction-boundary-policy-v2',
      variant: 2,
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
      replayScope: replay.replayScope,
      chunkCount: replay.chunkCount,
      replayAttemptsPerChunk: replay.replayAttemptsPerChunk,
      attemptedReplayCount: replay.attemptedReplayCount,
      exactReceiptMatches: replay.exactReceiptMatches,
      idempotentSkips: replay.idempotentSkips,
      idempotentReplaySafe: replay.idempotentReplaySafe,
      bytesRewrittenDuringReplay: replay.bytes.bytesRewrittenDuringReplay,
      duplicateChunkBytes: replay.bytes.duplicateChunkBytes,
      duplicateReceiptRecordsWritten: replay.receipts.duplicateReceiptRecordsWritten,
      uniqueReceiptKeys: replay.receipts.uniqueReceiptKeys,
      mutationWorkReplayedBeforeFinalize: replay.mutationWork.mutationWorkReplayedBeforeFinalize,
      freshMutationWorkDuringReplay: replay.mutationWork.freshMutationWorkDuringReplay,
      duplicateMutationWork: replay.mutationWork.duplicateMutationWork,
      noDuplicateMutationWork: replay.mutationWork.noDuplicateMutationWork,
      applyBoundaryOpenedDuringReplay: replay.mutationWork.applyBoundaryOpenedDuringReplay,
      failClosed: replay.failClosed,
      replayCursorFields: replay.replayCursorFields,
      sampleReplayDecisionHashes: replay.sampleReplayDecisions
        .map((decision) => sha256(decision)),
      evidenceHash: replay.evidenceHash,
    },
    release: supportOnlyReleasePosture(report, productionBlockers),
  };
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeTransactionBoundaryProofGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveTransactionBoundaryStoragePerformanceProof(evidence) {
  const recomputedGates = recomputeTransactionBoundaryProofGates(evidence);
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
        transferBoundaryHash: sha256({
          transfer: evidence.transfer,
          apply: evidence.apply,
        }),
        resumeHash: sha256({
          chunksSkippedByReceipt: evidence.resume.chunksSkippedByReceipt,
          chunksToUpload: evidence.resume.chunksToUpload,
          bytesToUpload: evidence.resume.bytesToUpload,
          duplicateMutationWork: evidence.resume.duplicateMutationWork,
        }),
        replayHash: sha256({
          attemptedReplayCount: evidence.replay.attemptedReplayCount,
          idempotentSkips: evidence.replay.idempotentSkips,
          duplicateMutationWork: evidence.replay.duplicateMutationWork,
        }),
        duplicateMutationWork: evidence.resume.duplicateMutationWork
          + evidence.apply.duplicateMutationWork
          + evidence.replay.duplicateMutationWork,
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
    hashOnlyTransactionOutput: output ? transactionEvidenceHasNoRawValues(output) : false,
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

function recomputeTransactionBoundaryProofGates(evidence) {
  const sourcePolicy = evidence.builtOn?.sourcePolicy || {};
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const storage = resources.storage || {};
  const processResources = resources.process || {};
  const journals = resources.journals || {};
  const transfer = evidence.transfer || {};
  const resume = evidence.resume || {};
  const apply = evidence.apply || {};
  const replay = evidence.replay || {};
  const release = evidence.release || {};
  const receiptMatches = Array.isArray(transfer.receiptMatches)
    ? transfer.receiptMatches
    : [];
  const failClosedProbeCount = Object.keys(replay.failClosed || {}).length;
  const failClosedProbesPass = failClosedProbeCount >= 5
    && Object.values(replay.failClosed || {}).every((value) => value === true);
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
    && storage.finalStagingRecordPresent === true;
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
    && sameArray(resume.resumeCursorFields || [], expectedResumeCursorFields);
  const replaySafe = replay.status === 'passed'
    && replay.variant === 1
    && replay.chunkCount === transfer.chunkCount
    && replay.exactReceiptMatches === transfer.chunkCount
    && replay.attemptedReplayCount === transfer.chunkCount * replay.replayAttemptsPerChunk
    && replay.idempotentReplaySafe === true
    && replay.idempotentSkips === replay.attemptedReplayCount
    && replay.bytesRewrittenDuringReplay === 0
    && replay.duplicateChunkBytes === 0
    && replay.duplicateReceiptRecordsWritten === 0
    && replay.uniqueReceiptKeys === transfer.chunkCount
    && replay.applyBoundaryOpenedDuringReplay === false
    && sameArray(replay.replayCursorFields || [], expectedReplayCursorFields)
    && failClosedProbesPass;
  const noDuplicateMutationWork = resume.duplicateMutationWork === 0
    && apply.mutationWorkReplayedBeforeTransferFinalize === 0
    && apply.freshMutationWorkDuringTransferResume === 0
    && apply.duplicateMutationWork === 0
    && apply.noDuplicateMutationWork === true
    && replay.mutationWorkReplayedBeforeFinalize === 0
    && replay.freshMutationWorkDuringReplay === 0
    && replay.duplicateMutationWork === 0
    && replay.noDuplicateMutationWork === true;
  const applyOpensAfterTransferFinalize = apply.applyOpenedAfterTransferFinalize === true
    && transfer.transferFinalizeSequence < apply.firstApplyBoundarySequence
    && apply.mutationWorkAllowedDuringTransferResume === false;
  const runtimeWithinBudget = runtime.profile === 'unit'
    && runtime.budgetStatus === 'passed'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && journals.allJournalsIntegrityOk === true
    && journals.durableJournalsContainNoRawValues === true;
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];

  return [
    proofGate('built-on-transaction-policy-passed', evidence.builtOn?.rppId === 'RPP-0723'
      && evidence.builtOn?.variant === 2
      && sourcePolicy.policyId === 'rpp-0703-transaction-boundary-policy'
      && sourcePolicy.variant === 1
      && sourcePolicy.status === 'passed'
      && isSha256Hash(sourcePolicy.evidenceHash), {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      sourcePolicyStatus: sourcePolicy.status,
      sourcePolicyVariant: sourcePolicy.variant,
    }),
    proofGate('durable-local-receipts-complete', durableReceiptComplete, {
      exactReceiptMatches: transfer.exactReceiptMatches,
      chunkCount: transfer.chunkCount,
      receiptMatches: receiptMatches.length,
      duplicateReceiptKeys: transfer.duplicateReceiptKeys,
      receiptBackend: storage.receiptBackend,
      productionBacked: storage.productionBacked,
    }),
    proofGate('receipt-only-transfer-resume', receiptOnlyResumeSafe, {
      chunksSkippedByReceipt: resume.chunksSkippedByReceipt,
      chunksToUpload: resume.chunksToUpload,
      bytesToUpload: resume.bytesToUpload,
      duplicateChunkBytes: resume.duplicateChunkBytes,
      duplicateMutationWork: resume.duplicateMutationWork,
    }),
    proofGate('chunk-replay-idempotency-retained', replaySafe, {
      attemptedReplayCount: replay.attemptedReplayCount,
      idempotentSkips: replay.idempotentSkips,
      duplicateReceiptRecordsWritten: replay.duplicateReceiptRecordsWritten,
      bytesRewrittenDuringReplay: replay.bytesRewrittenDuringReplay,
      duplicateMutationWork: replay.duplicateMutationWork,
      failClosedProbeCount,
    }),
    proofGate('no-duplicate-mutation-work', noDuplicateMutationWork, {
      resumeDuplicateMutationWork: resume.duplicateMutationWork,
      applyDuplicateMutationWork: apply.duplicateMutationWork,
      replayDuplicateMutationWork: replay.duplicateMutationWork,
      mutationWorkReplayedBeforeTransferFinalize:
        apply.mutationWorkReplayedBeforeTransferFinalize,
      freshMutationWorkDuringTransferResume: apply.freshMutationWorkDuringTransferResume,
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
    proofGate('hash-only-storage-performance-evidence', transactionEvidenceHasNoRawValues({
      runtime,
      resources,
      transfer,
      resume,
      apply,
      replay,
      release,
    }), {
      rawValueEvidenceLeaks: transactionEvidenceHasNoRawValues({
        runtime,
        resources,
        transfer,
        resume,
        apply,
        replay,
        release,
      }) ? 0 : 1,
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

function unsafeTransactionBoundaryDecisions(evidence) {
  const missingReceipt = withPassedStatus(clone(evidence));
  missingReceipt.transfer.receiptMatches[0].matched = false;
  missingReceipt.transfer.exactReceiptMatches -= 1;
  missingReceipt.resume.chunksSkippedByReceipt -= 1;
  missingReceipt.resume.chunksToUpload += 1;

  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.resume.duplicateMutationWork = 1;
  duplicateMutationWork.apply.duplicateMutationWork = 1;
  duplicateMutationWork.apply.noDuplicateMutationWork = false;
  duplicateMutationWork.replay.duplicateMutationWork = 1;
  duplicateMutationWork.replay.noDuplicateMutationWork = false;

  const earlyApplyBoundary = withPassedStatus(clone(evidence));
  earlyApplyBoundary.apply.applyOpenedAfterTransferFinalize = false;
  earlyApplyBoundary.apply.firstApplyBoundarySequence =
    earlyApplyBoundary.transfer.transferFinalizeSequence;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingReceipt: resolveTransactionBoundaryStoragePerformanceProof(missingReceipt),
    duplicateMutationWork: resolveTransactionBoundaryStoragePerformanceProof(duplicateMutationWork),
    earlyApplyBoundary: resolveTransactionBoundaryStoragePerformanceProof(earlyApplyBoundary),
    overBudget: resolveTransactionBoundaryStoragePerformanceProof(overBudget),
    prematurePassStatus: resolveTransactionBoundaryStoragePerformanceProof(prematurePassStatus),
  };
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

function publicTransactionEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    runtime: evidence.runtime,
    resources: evidence.resources,
    transfer: evidence.transfer,
    resume: evidence.resume,
    apply: evidence.apply,
    replay: evidence.replay,
    release: evidence.release,
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

function assertHashOnlyTransactionEvidence(value) {
  assert.equal(transactionEvidenceHasNoRawValues(value), true);
}

function transactionEvidenceHasNoRawValues(value) {
  return !rawTransactionEvidencePattern().test(JSON.stringify(value));
}

function rawTransactionEvidencePattern() {
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
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
