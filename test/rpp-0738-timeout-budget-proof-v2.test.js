import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGuardedExecutorBenchmark } from '../scripts/bench/guarded-executor-benchmark.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0738-timeout-budget-proof-v2';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const benchmarkOptions = Object.freeze({
  profile: 'unit',
  fileBytes: 1024 * 1024,
  chunkSizeBytes: 256 * 1024,
  rowCount: 8,
  rowPayloadBytes: 64,
});
const expectedGateIds = Object.freeze([
  'built-on-timeout-proof-passed',
  'documented-timeout-budget-interrupts-transfer',
  'durable-local-receipts-before-timeout',
  'receipt-only-resume-after-timeout',
  'no-duplicate-mutation-work',
  'apply-opens-after-transfer-finalize',
  'unit-runtime-resource-budget',
  'hash-only-storage-performance-evidence',
  'support-only-release-no-go',
]);

test('RPP-0738 variant 2 proves timeout resume has no duplicate mutation work and support-only NO-GO', {
  concurrency: false,
}, () => {
  const proof = buildVariant2Proof();

  assert.equal(proof.rppId, 'RPP-0738');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0718');
  assert.equal(proof.builtOn.proofId, 'rpp-0718-timeout-budget-proof');
  assert.equal(proof.builtOn.variant, 1);
  assert.equal(proof.builtOn.status, 'passed');
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'unit');
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.storage.receiptBackend, 'lab-file-journal-receipts');
  assert.equal(proof.resources.storage.productionBacked, false);

  assert.equal(proof.transfer.fileBytes, benchmarkOptions.fileBytes);
  assert.equal(proof.transfer.chunkSizeBytes, benchmarkOptions.chunkSizeBytes);
  assert.equal(proof.transfer.chunkCount, 4);
  assert.equal(proof.transfer.manifestComplete, true);
  assert.equal(proof.transfer.chunkHashesVerified, true);
  assert.equal(proof.transfer.receiptKeysUnique, true);
  assert.equal(proof.transfer.finalStagingRecordPresent, true);
  assert.equal(proof.transfer.canonicalVisibleBeforePublish, false);
  assert.equal(proof.transfer.livePathChangesOnlyAfterFinalize, true);

  assert.equal(proof.timeoutProof.proofHash, proof.timeoutProof.recomputedProofHash);
  assert.equal(proof.timeoutProof.status, 'passed');
  assert.equal(proof.timeoutProof.budget.scope, 'chunk-transfer-attempt');
  assert.equal(proof.timeoutProof.budget.timeoutExpiredDuring, 'chunk-transfer');
  assert.equal(proof.timeoutProof.budget.timeoutBeforeApply, true);
  assert.equal(proof.timeoutProof.budget.nextChunkWouldExceedBudget, true);
  assert.equal(proof.timeoutProof.budget.timeoutExpiredBeforeCompletion, true);
  assert.equal(
    proof.timeoutProof.budget.elapsedMsForDurableReceipts
      < proof.timeoutProof.budget.elapsedMsAtTimeout,
    true,
  );
  assert.equal(proof.timeoutProof.partialTransfer.chunkCount, proof.transfer.chunkCount);
  assert.equal(proof.timeoutProof.partialTransfer.receiptsBeforeTimeout, 2);
  assert.equal(proof.timeoutProof.partialTransfer.chunksUnacknowledgedAtTimeout, 2);
  assert.equal(proof.timeoutProof.partialTransfer.unacknowledgedChunksMarkedComplete, 0);
  assert.equal(proof.timeoutProof.partialTransfer.canonicalVisibleAtTimeout, false);
  assert.equal(proof.timeoutProof.partialTransfer.mutationWorkBeforeTimeout, 0);

  assert.equal(proof.resume.receiptOnlyResumeSafe, true);
  assert.equal(proof.resume.chunksSkippedByReceipt, 2);
  assert.equal(proof.resume.chunksUploadedAfterResume, 2);
  assert.equal(proof.resume.bytesSkippedByReceipt, 524288);
  assert.equal(proof.resume.bytesUploadedAfterResume, 524288);
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
  assert.equal(proof.correctness.hashOnlyTimeoutOutput, true);
  assert.equal(proof.correctness.timeoutOutputEmittedAfterGates, true);
  assert.match(proof.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.missingReceipt.updated, false);
  assert.equal(proof.unsafe.missingReceipt.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingReceipt.blockedBy.includes('durable-local-receipts-before-timeout'));
  assert.equal(proof.unsafe.duplicateMutationWork.updated, false);
  assert.equal(proof.unsafe.duplicateMutationWork.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.equal(proof.unsafe.overBudget.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.overBudget.blockedBy.includes('unit-runtime-resource-budget'));
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

test('RPP-0738 variant 2 fails closed for missing receipt, duplicate mutation work, over-budget, and premature evidence', () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveTimeoutBudgetStoragePerformanceProof(evidence);
  const missingReceipt = withPassedStatus(clone(evidence));
  missingReceipt.timeoutProof.receiptMatches[0].matched = false;
  missingReceipt.timeoutProof.partialTransfer.exactReceiptMatches -= 1;
  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.timeoutProof.resume.duplicateMutationWork = 1;
  duplicateMutationWork.timeoutProof.apply.duplicateMutationWork = 1;
  duplicateMutationWork.timeoutProof.apply.noDuplicateMutationWork = false;
  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;
  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];
  const unsafeDecisions = {
    missingReceipt: resolveTimeoutBudgetStoragePerformanceProof(missingReceipt),
    duplicateMutationWork: resolveTimeoutBudgetStoragePerformanceProof(duplicateMutationWork),
    overBudget: resolveTimeoutBudgetStoragePerformanceProof(overBudget),
    prematurePassStatus: resolveTimeoutBudgetStoragePerformanceProof(prematurePassStatus),
  };

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
  assert.ok(unsafeDecisions.missingReceipt.blockedBy.includes('durable-local-receipts-before-timeout'));
  assert.equal(unsafeDecisions.duplicateMutationWork.updated, false);
  assert.ok(unsafeDecisions.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.overBudget.updated, false);
  assert.ok(unsafeDecisions.overBudget.blockedBy.includes('unit-runtime-resource-budget'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyTimeoutEvidence(decision);
  }
});

function buildVariant2Proof() {
  const { report, evidence } = buildRecordedEvidence();
  const safeDecision = resolveTimeoutBudgetStoragePerformanceProof(evidence);
  const unsafe = projectUnsafeDecisions(unsafeEvidenceDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'timeoutProof',
  );
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('guarded-executor-timeout-proof-passed', report.evidence.timeoutBudgetProof.status === 'passed', {
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
    proofGate('unsafe-timeout-budget-evidence-fails-closed', Object.values(unsafe).every((decision) => (
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
    rppId: 'RPP-0738',
    proofId,
    variant: 2,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
    runtime: evidence.runtime,
    resources: evidence.resources,
    transfer: evidence.transfer,
    benchmark: evidence.benchmark,
    timeoutProof: {
      ...evidence.timeoutProof,
      recomputedProofHash: sha256(timeoutProofCore(evidence.timeoutProof)),
    },
    resume: evidence.timeoutProof.resume,
    apply: evidence.timeoutProof.apply,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyTimeoutOutput: safeDecision.hashOnlyTimeoutOutput,
      timeoutOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-only-timeout-storage-performance',
      rawValueEvidenceLeaks: timeoutEvidenceHasNoRawValues(evidence) ? 0 : 1,
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
  const report = runGuardedExecutorBenchmark({
    ...benchmarkOptions,
    now: fixedNow,
    tempDir: fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0738-timeout-v2-')),
  });
  const evidence = buildTimeoutBudgetEvidence({ report });

  recordCorrectnessGates(evidence);
  return { report, evidence };
}

function buildTimeoutBudgetEvidence({ report }) {
  const timeoutProof = {
    ...projectTimeoutProof(report.evidence.timeoutBudgetProof),
  };
  timeoutProof.proofHash = sha256(timeoutProofCore(timeoutProof));

  return {
    schemaVersion: 1,
    rppId: 'RPP-0738',
    proofId,
    variant: 2,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0718',
      proofId: report.evidence.timeoutBudgetProof.proofId,
      variant: report.evidence.timeoutBudgetProof.variant,
      status: report.evidence.timeoutBudgetProof.status,
      evidenceHash: report.evidence.timeoutBudgetProof.evidenceHash,
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
        productionBacked: false,
        finalStagingRecordPresent: report.evidence.chunkReceipts.finalStagingRecord,
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
      chunkManifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
      finalizedHashHash: digest(report.resources.transfer.finalizedHash),
      manifestComplete: report.evidence.guardedTransfer.manifest.complete,
      byteRangeCoverage: report.evidence.guardedTransfer.manifest.byteRangeCoverage,
      chunkHashesVerified: report.evidence.guardedTransfer.hashVerification.status === 'passed'
        && report.evidence.guardedTransfer.hashVerification.allChunksMatchManifest
        && report.evidence.guardedTransfer.hashVerification.assembledHashMatchesFinalized,
      receiptKeysUnique: report.evidence.guardedTransfer.receipts.receiptKeysUnique,
      receiptRecords: report.evidence.chunkReceipts.recorded,
      finalStagingRecordPresent: report.evidence.chunkReceipts.finalStagingRecord,
      canonicalVisibleBeforePublish: report.evidence.chunkReceipts.canonicalVisibleBeforePublish,
      livePathChangesOnlyAfterFinalize:
        report.evidence.guardedTransfer.visibility.livePathChangesOnlyAfterFinalize,
    },
    timeoutProof,
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeTimeoutBudgetProofGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveTimeoutBudgetStoragePerformanceProof(evidence) {
  const recomputedGates = recomputeTimeoutBudgetProofGates(evidence);
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
        timeoutProofHash: evidence.timeoutProof.proofHash,
        transferBoundaryHash: sha256({
          transfer: evidence.transfer,
          storage: evidence.resources.storage,
        }),
        resumeHash: sha256({
          chunksSkippedByReceipt: evidence.timeoutProof.resume.chunksSkippedByReceipt,
          chunksUploadedAfterResume: evidence.timeoutProof.resume.chunksUploadedAfterResume,
          duplicateMutationWork: evidence.timeoutProof.resume.duplicateMutationWork,
        }),
        duplicateMutationWork: evidence.timeoutProof.resume.duplicateMutationWork
          + evidence.timeoutProof.apply.duplicateMutationWork,
        releaseStatus: evidence.release.finalReleaseStatus,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: evidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    hashOnlyTimeoutOutput: output ? timeoutEvidenceHasNoRawValues(output) : false,
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

function recomputeTimeoutBudgetProofGates(evidence) {
  const timeoutProof = evidence.timeoutProof || {};
  const budget = timeoutProof.budget || {};
  const partialTransfer = timeoutProof.partialTransfer || {};
  const resume = timeoutProof.resume || {};
  const apply = timeoutProof.apply || {};
  const transfer = evidence.transfer || {};
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const processResources = resources.process || {};
  const release = evidence.release || {};
  const receiptMatches = Array.isArray(timeoutProof.receiptMatches)
    ? timeoutProof.receiptMatches
    : [];
  const receiptCountsMatch = receiptMatches.length === transfer.chunkCount
    && receiptMatches.every((match) => match.matched === true)
    && partialTransfer.exactReceiptMatches === transfer.chunkCount
    && partialTransfer.receiptsBeforeTimeout > 0
    && partialTransfer.receiptsBeforeTimeout < transfer.chunkCount
    && partialTransfer.chunksUnacknowledgedAtTimeout > 0
    && partialTransfer.receiptsBeforeTimeout + partialTransfer.chunksUnacknowledgedAtTimeout
      === transfer.chunkCount
    && partialTransfer.unacknowledgedChunksMarkedComplete === 0
    && partialTransfer.duplicateReceiptKeys === 0
    && partialTransfer.canonicalVisibleAtTimeout === false;
  const resumeSafe = resume.receiptOnlyResumeSafe === true
    && resume.status === 'passed'
    && resume.chunksSkippedByReceipt === partialTransfer.receiptsBeforeTimeout
    && resume.chunksUploadedAfterResume === partialTransfer.chunksUnacknowledgedAtTimeout
    && resume.bytesSkippedByReceipt === partialTransfer.bytesDurablyReceiptedBeforeTimeout
    && resume.duplicateChunkBytes === 0
    && resume.duplicateMutationWork === 0
    && resume.missingReceiptBlocksSkip === true
    && resume.mismatchedReceiptBlocksSkip === true
    && sameArray(resume.resumeCursorFields || [], [
      'planId',
      'resourceKey',
      'chunkIndex',
      'offsetBytes',
      'sizeBytes',
      'chunkDigest',
      'receiptKey',
      'idempotencyKey',
    ]);
  const noDuplicateMutationWork = partialTransfer.mutationWorkBeforeTimeout === 0
    && resume.duplicateMutationWork === 0
    && apply.mutationWorkReplayedBeforeTransferFinalize === 0
    && apply.freshMutationWorkDuringTransferResume === 0
    && apply.duplicateMutationWork === 0
    && apply.noDuplicateMutationWork === true;

  return [
    proofGate('built-on-timeout-proof-passed', evidence.builtOn?.status === 'passed'
      && timeoutProof.status === 'passed'
      && timeoutProof.variant === 1
      && timeoutProof.proofHash === sha256(timeoutProofCore(timeoutProof)), {
      builtOnStatus: evidence.builtOn?.status,
      timeoutProofStatus: timeoutProof.status,
      proofHashMatches: timeoutProof.proofHash === sha256(timeoutProofCore(timeoutProof)),
    }),
    proofGate('documented-timeout-budget-interrupts-transfer', budget.scope === 'chunk-transfer-attempt'
      && budget.timeoutExpiredDuring === 'chunk-transfer'
      && budget.timeoutBeforeApply === true
      && budget.nextChunkWouldExceedBudget === true
      && budget.timeoutExpiredBeforeCompletion === true
      && budget.elapsedMsForDurableReceipts < budget.elapsedMsAtTimeout, {
      budget,
    }),
    proofGate('durable-local-receipts-before-timeout', receiptCountsMatch
      && transfer.manifestComplete === true
      && transfer.chunkHashesVerified === true
      && transfer.receiptKeysUnique === true
      && transfer.finalStagingRecordPresent === true
      && transfer.canonicalVisibleBeforePublish === false
      && transfer.livePathChangesOnlyAfterFinalize === true, {
      receiptMatches: receiptMatches.length,
      exactReceiptMatches: partialTransfer.exactReceiptMatches,
      receiptsBeforeTimeout: partialTransfer.receiptsBeforeTimeout,
      chunksUnacknowledgedAtTimeout: partialTransfer.chunksUnacknowledgedAtTimeout,
      manifestComplete: transfer.manifestComplete,
      chunkHashesVerified: transfer.chunkHashesVerified,
      receiptKeysUnique: transfer.receiptKeysUnique,
    }),
    proofGate('receipt-only-resume-after-timeout', resumeSafe, {
      chunksSkippedByReceipt: resume.chunksSkippedByReceipt,
      chunksUploadedAfterResume: resume.chunksUploadedAfterResume,
      bytesSkippedByReceipt: resume.bytesSkippedByReceipt,
      bytesUploadedAfterResume: resume.bytesUploadedAfterResume,
      duplicateChunkBytes: resume.duplicateChunkBytes,
      duplicateMutationWork: resume.duplicateMutationWork,
    }),
    proofGate('no-duplicate-mutation-work', noDuplicateMutationWork, {
      mutationWorkBeforeTimeout: partialTransfer.mutationWorkBeforeTimeout,
      mutationWorkReplayedBeforeTransferFinalize: apply.mutationWorkReplayedBeforeTransferFinalize,
      freshMutationWorkDuringTransferResume: apply.freshMutationWorkDuringTransferResume,
      resumeDuplicateMutationWork: resume.duplicateMutationWork,
      applyDuplicateMutationWork: apply.duplicateMutationWork,
    }),
    proofGate('apply-opens-after-transfer-finalize', apply.applyOpenedAfterTransferFinalize === true
      && apply.transferFinalizeSequence < apply.firstApplyBoundarySequence
      && apply.mutationWorkAllowedDuringTransferResume === false, {
      transferFinalizeSequence: apply.transferFinalizeSequence,
      firstApplyBoundarySequence: apply.firstApplyBoundarySequence,
      mutationWorkAllowedDuringTransferResume: apply.mutationWorkAllowedDuringTransferResume,
    }),
    proofGate('unit-runtime-resource-budget', runtime.profile === 'unit'
      && runtime.budgetStatus === 'passed'
      && runtime.durationMs <= runtime.budgets?.maxDurationMs
      && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes, {
      profile: runtime.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
    }),
    proofGate('hash-only-storage-performance-evidence', timeoutEvidenceHasNoRawValues({
      runtime,
      resources,
      transfer,
      timeoutProof,
    }), {
      rawValueEvidenceLeaks: timeoutEvidenceHasNoRawValues({
        runtime,
        resources,
        transfer,
        timeoutProof,
      }) ? 0 : 1,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.productionThroughput === 'not-claimed'
      && release.speedClaimsAllowed === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO', {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      productionThroughput: release.productionThroughput,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function unsafeEvidenceDecisions(evidence) {
  const missingReceipt = withPassedStatus(clone(evidence));
  missingReceipt.timeoutProof.receiptMatches[0].matched = false;
  missingReceipt.timeoutProof.partialTransfer.exactReceiptMatches -= 1;

  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.timeoutProof.resume.duplicateMutationWork = 1;
  duplicateMutationWork.timeoutProof.apply.duplicateMutationWork = 1;
  duplicateMutationWork.timeoutProof.apply.noDuplicateMutationWork = false;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingReceipt: resolveTimeoutBudgetStoragePerformanceProof(missingReceipt),
    duplicateMutationWork: resolveTimeoutBudgetStoragePerformanceProof(duplicateMutationWork),
    overBudget: resolveTimeoutBudgetStoragePerformanceProof(overBudget),
    prematurePassStatus: resolveTimeoutBudgetStoragePerformanceProof(prematurePassStatus),
  };
}

function projectTimeoutProof(proof) {
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
    rolloutSafetySummary: report.rolloutSafetyGates.summary,
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
    runtime: evidence.runtime,
    resources: evidence.resources,
    transfer: evidence.transfer,
    timeoutProof: evidence.timeoutProof,
    release: evidence.release,
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
