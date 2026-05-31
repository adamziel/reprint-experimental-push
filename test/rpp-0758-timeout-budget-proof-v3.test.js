import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGuardedExecutorBenchmark } from '../scripts/bench/guarded-executor-benchmark.js';
import { buildChunkTransferTimeoutBudgetProof } from '../src/timeout-budget-proof.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0758-timeout-budget-proof-v3';
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
  'generated-timeout-budget-cases-covered',
  'timeout-budget-interrupts-transfer-before-apply',
  'durable-local-receipts-before-timeout',
  'receipt-only-resume-after-timeout',
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

test('RPP-0758 variant 3 generated timeout budget coverage resumes without duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildVariant3Proof();

  assert.equal(proof.rppId, 'RPP-0758');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 3);
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

  assert.equal(proof.generatedCoverage.source, 'local-support-generated-timeout-budget-cases');
  assert.equal(proof.generatedCoverage.timeoutVariant, 'timeout-budget-proof-v3');
  assert.equal(proof.generatedCoverage.caseCount, 4);
  assert.equal(proof.generatedCoverage.deterministicCaseVector, true);
  assert.deepEqual(proof.generatedCoverage.timeoutReceiptCounts, [1, 2, 3, 4]);
  assert.deepEqual(proof.generatedCoverage.caseStatuses, ['passed', 'passed', 'passed', 'passed']);
  assert.deepEqual(proof.generatedCoverage.caseHashes.map((hash) => /^[a-f0-9]{64}$/.test(hash)), [
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
  assert.equal(proof.transfer.timeoutReceiptsBeforeTimeout, 2);
  assert.equal(proof.transfer.timeoutChunksUploadedAfterResume, 2);
  assert.equal(proof.transfer.timeoutDuplicateMutationWork, 0);
  assert.match(proof.transfer.planIdHash, /^[a-f0-9]{64}$/);
  assert.match(proof.transfer.resourceKeyHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.timeoutCases.caseCount, 4);
  assert.equal(proof.timeoutCases.allCasesPassed, true);
  assert.equal(proof.timeoutCases.totalChunksSkippedByReceipt, 10);
  assert.equal(proof.timeoutCases.totalChunksUploadedAfterResume, 8);
  assert.equal(proof.timeoutCases.totalDuplicateChunkBytes, 0);
  assert.equal(proof.timeoutCases.totalDuplicateMutationWork, 0);
  assert.equal(proof.timeoutCases.maxMutationWorkBeforeTimeout, 0);
  assert.equal(proof.timeoutCases.maxMutationWorkBeforeTransferFinalize, 0);
  assert.equal(proof.timeoutCases.cases.length, 4);

  for (const timeoutCase of proof.timeoutCases.cases) {
    assert.equal(timeoutCase.status, 'passed');
    assert.equal(timeoutCase.budgetScope, 'chunk-transfer-attempt');
    assert.equal(timeoutCase.timeoutExpiredDuring, 'chunk-transfer');
    assert.equal(timeoutCase.timeoutBeforeApply, true);
    assert.equal(timeoutCase.nextChunkWouldExceedBudget, true);
    assert.equal(timeoutCase.timeoutExpiredBeforeCompletion, true);
    assert.ok(timeoutCase.elapsedMsForDurableReceipts < timeoutCase.elapsedMsAtTimeout);
    assert.equal(timeoutCase.receiptOnlyResumeSafe, true);
    assert.equal(timeoutCase.receiptsBeforeTimeout, timeoutCase.timeoutAfterChunks);
    assert.equal(
      timeoutCase.chunksUploadedAfterResume,
      timeoutCase.chunkCount - timeoutCase.timeoutAfterChunks,
    );
    assert.equal(timeoutCase.exactReceiptMatches, timeoutCase.chunkCount);
    assert.equal(timeoutCase.duplicateReceiptKeys, 0);
    assert.equal(timeoutCase.canonicalVisibleAtTimeout, false);
    assert.equal(timeoutCase.missingReceiptBlocksSkip, true);
    assert.equal(timeoutCase.mismatchedReceiptBlocksSkip, true);
    assert.equal(timeoutCase.duplicateChunkBytes, 0);
    assert.equal(timeoutCase.resumeDuplicateMutationWork, 0);
    assert.equal(timeoutCase.applyDuplicateMutationWork, 0);
    assert.equal(timeoutCase.duplicateMutationWork, 0);
    assert.equal(timeoutCase.mutationWorkBeforeTimeout, 0);
    assert.equal(timeoutCase.mutationWorkReplayedBeforeTransferFinalize, 0);
    assert.equal(timeoutCase.freshMutationWorkDuringTransferResume, 0);
    assert.equal(timeoutCase.applyOpenedAfterTransferFinalize, true);
    assert.equal(timeoutCase.mutationWorkAllowedDuringTransferResume, false);
    assert.ok(timeoutCase.transferFinalizeSequence < timeoutCase.firstApplyBoundarySequence);
    assert.deepEqual(timeoutCase.resumeCursorFields, expectedResumeCursorFields);
    assert.match(timeoutCase.caseHash, /^[a-f0-9]{64}$/);
    assert.match(timeoutCase.planIdHash, /^[a-f0-9]{64}$/);
    assert.match(timeoutCase.resourceKeyHash, /^[a-f0-9]{64}$/);
    assert.match(timeoutCase.proofHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(timeoutCase.receiptMatches.length, timeoutCase.chunkCount);
    assert.ok(timeoutCase.receiptMatches.every((match) => match.matched === true));
    assert.ok(timeoutCase.receiptMatches.some((match) => match.receiptedBeforeTimeout));
    assert.ok(timeoutCase.receiptMatches.some((match) => match.resumedAfterTimeout));
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
  assert.ok(proof.unsafe.missingReceipt.blockedBy.includes('durable-local-receipts-before-timeout'));
  assert.ok(proof.unsafe.missingReceipt.blockedBy.includes('receipt-only-resume-after-timeout'));
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

test('RPP-0758 variant 3 fails closed for missing receipts, duplicate mutation work, and stale gates', () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveTimeoutBudgetV3Proof(evidence);
  const unsafeDecisions = unsafeTimeoutBudgetDecisions(evidence);

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(
    safeDecision.recomputedGates.map((gate) => gate.status),
    Array(expectedGateIds.length).fill('pass'),
  );

  assert.equal(unsafeDecisions.missingReceipt.updated, false);
  assert.ok(unsafeDecisions.missingReceipt.blockedBy.includes('durable-local-receipts-before-timeout'));
  assert.ok(unsafeDecisions.missingReceipt.blockedBy.includes('receipt-only-resume-after-timeout'));
  assert.equal(unsafeDecisions.duplicateMutationWork.updated, false);
  assert.ok(unsafeDecisions.duplicateMutationWork.blockedBy.includes('no-duplicate-mutation-work'));
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
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyTimeoutEvidence(decision);
  }
});

function buildVariant3Proof() {
  const { report, evidence } = buildRecordedEvidence();
  const safeDecision = resolveTimeoutBudgetV3Proof(evidence);
  const unsafe = projectUnsafeDecisions(unsafeTimeoutBudgetDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'timeoutCases',
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
    rppId: 'RPP-0758',
    proofId,
    variant: 3,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
    generatedCoverage: evidence.generatedCoverage,
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: evidence.benchmark,
    transfer: evidence.transfer,
    timeoutCases: evidence.timeoutCases,
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
      mode: 'hash-count-only-timeout-budget-storage-performance',
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
  const report = runUnitBenchmark();
  const generatedCases = generatedTimeoutBudgetCases();
  const repeatedCases = generatedTimeoutBudgetCases();
  const evidence = buildTimeoutBudgetV3Evidence({
    report,
    generatedCases,
    repeatedCases,
  });
  recordCorrectnessGates(evidence);
  return { report, evidence };
}

function runUnitBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0758-timeout-v3-'));
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

function buildTimeoutBudgetV3Evidence({ report, generatedCases, repeatedCases }) {
  const timeoutProof = report.evidence.timeoutBudgetProof;
  const caseHashes = generatedCases.map((timeoutCase) => timeoutCase.caseHash);
  const repeatedCaseHashes = repeatedCases.map((timeoutCase) => timeoutCase.caseHash);
  const deterministicCaseVector = sameArray(caseHashes, repeatedCaseHashes);
  const totalDuplicateMutationWork = generatedCases.reduce(
    (sum, timeoutCase) => sum + timeoutCase.duplicateMutationWork,
    0,
  );

  return {
    schemaVersion: 1,
    rppId: 'RPP-0758',
    proofId,
    variant: 3,
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
      source: 'local-support-generated-timeout-budget-cases',
      timeoutVariant: 'timeout-budget-proof-v3',
      caseCount: generatedCases.length,
      deterministicCaseVector,
      timeoutReceiptCounts: generatedCases.map((timeoutCase) => timeoutCase.receiptsBeforeTimeout),
      chunkCounts: generatedCases.map((timeoutCase) => timeoutCase.chunkCount),
      caseStatuses: generatedCases.map((timeoutCase) => timeoutCase.status),
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
    timeoutCases: {
      caseCount: generatedCases.length,
      allCasesPassed: generatedCases.every((timeoutCase) => timeoutCase.status === 'passed'),
      totalChunksSkippedByReceipt: generatedCases.reduce(
        (sum, timeoutCase) => sum + timeoutCase.chunksSkippedByReceipt,
        0,
      ),
      totalChunksUploadedAfterResume: generatedCases.reduce(
        (sum, timeoutCase) => sum + timeoutCase.chunksUploadedAfterResume,
        0,
      ),
      totalDuplicateChunkBytes: generatedCases.reduce(
        (sum, timeoutCase) => sum + timeoutCase.duplicateChunkBytes,
        0,
      ),
      totalDuplicateMutationWork,
      maxMutationWorkBeforeTimeout: Math.max(
        ...generatedCases.map((timeoutCase) => timeoutCase.mutationWorkBeforeTimeout),
      ),
      maxMutationWorkBeforeTransferFinalize: Math.max(
        ...generatedCases.map((timeoutCase) =>
          timeoutCase.mutationWorkReplayedBeforeTransferFinalize),
      ),
      cases: generatedCases,
    },
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeTimeoutBudgetV3Gates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveTimeoutBudgetV3Proof(evidence) {
  const recomputedGates = recomputeTimeoutBudgetV3Gates(evidence);
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
          timeoutReceiptCounts: evidence.generatedCoverage.timeoutReceiptCounts,
        }),
        timeoutResumeHash: sha256({
          totalChunksSkippedByReceipt: evidence.timeoutCases.totalChunksSkippedByReceipt,
          totalChunksUploadedAfterResume: evidence.timeoutCases.totalChunksUploadedAfterResume,
          totalDuplicateChunkBytes: evidence.timeoutCases.totalDuplicateChunkBytes,
          totalDuplicateMutationWork: evidence.timeoutCases.totalDuplicateMutationWork,
        }),
        duplicateMutationWork: evidence.timeoutCases.totalDuplicateMutationWork,
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

function recomputeTimeoutBudgetV3Gates(evidence) {
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const storage = resources.storage || {};
  const processResources = resources.process || {};
  const generatedCoverage = evidence.generatedCoverage || {};
  const timeoutCases = evidence.timeoutCases || {};
  const cases = Array.isArray(timeoutCases.cases) ? timeoutCases.cases : [];
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const generatedCasesCovered = generatedCoverage.source === 'local-support-generated-timeout-budget-cases'
    && generatedCoverage.timeoutVariant === 'timeout-budget-proof-v3'
    && generatedCoverage.caseCount >= 4
    && generatedCoverage.caseCount === cases.length
    && generatedCoverage.deterministicCaseVector === true
    && sameArray(generatedCoverage.caseHashes || [], generatedCoverage.repeatedCaseHashes || [])
    && sameArray(generatedCoverage.timeoutReceiptCounts || [], [1, 2, 3, 4])
    && new Set(generatedCoverage.chunkCounts || []).size >= 3
    && generatedCoverage.caseStatuses?.every((status) => status === 'passed');
  const timeoutInterruptsTransfer = cases.length === generatedCoverage.caseCount
    && cases.every((timeoutCase) => (
      timeoutCase.status === 'passed'
      && timeoutCase.budgetScope === 'chunk-transfer-attempt'
      && timeoutCase.timeoutExpiredDuring === 'chunk-transfer'
      && timeoutCase.timeoutBeforeApply === true
      && timeoutCase.nextChunkWouldExceedBudget === true
      && timeoutCase.timeoutExpiredBeforeCompletion === true
      && timeoutCase.elapsedMsForDurableReceipts < timeoutCase.elapsedMsAtTimeout
      && timeoutCase.receiptsBeforeTimeout > 0
      && timeoutCase.receiptsBeforeTimeout < timeoutCase.chunkCount
      && timeoutCase.chunksUnacknowledgedAtTimeout > 0
    ));
  const durableReceiptCoverage = cases.length === generatedCoverage.caseCount
    && cases.every((timeoutCase) => (
      timeoutCase.status === 'passed'
      && timeoutCase.chunkCount > 1
      && timeoutCase.exactReceiptMatches === timeoutCase.chunkCount
      && timeoutCase.receiptMatches.length === timeoutCase.chunkCount
      && timeoutCase.receiptMatches.every((match) => match.matched === true)
      && timeoutCase.receiptsBeforeTimeout + timeoutCase.chunksUnacknowledgedAtTimeout
        === timeoutCase.chunkCount
      && timeoutCase.unacknowledgedChunksMarkedComplete === 0
      && timeoutCase.duplicateReceiptKeys === 0
      && timeoutCase.canonicalVisibleAtTimeout === false
    ));
  const resumeSafe = cases.every((timeoutCase) => (
    timeoutCase.receiptOnlyResumeSafe === true
    && timeoutCase.chunksSkippedByReceipt === timeoutCase.receiptsBeforeTimeout
    && timeoutCase.chunksUploadedAfterResume === timeoutCase.chunksUnacknowledgedAtTimeout
    && timeoutCase.bytesSkippedByReceipt + timeoutCase.bytesUploadedAfterResume
      === timeoutCase.fileBytes
    && timeoutCase.duplicateChunkBytes === 0
    && timeoutCase.resumeDuplicateMutationWork === 0
    && timeoutCase.missingReceiptBlocksSkip === true
    && timeoutCase.mismatchedReceiptBlocksSkip === true
    && sameArray(timeoutCase.resumeCursorFields || [], expectedResumeCursorFields)
  ));
  const noDuplicateMutationWork = timeoutCases.totalDuplicateMutationWork === 0
    && timeoutCases.maxMutationWorkBeforeTimeout === 0
    && timeoutCases.maxMutationWorkBeforeTransferFinalize === 0
    && cases.every((timeoutCase) => (
      timeoutCase.mutationWorkBeforeTimeout === 0
      && timeoutCase.mutationWorkReplayedBeforeTransferFinalize === 0
      && timeoutCase.freshMutationWorkDuringTransferResume === 0
      && timeoutCase.resumeDuplicateMutationWork === 0
      && timeoutCase.applyDuplicateMutationWork === 0
      && timeoutCase.duplicateMutationWork === 0
      && timeoutCase.noDuplicateMutationWork === true
    ));
  const applyOpensAfterTransferFinalize = cases.every((timeoutCase) => (
    timeoutCase.applyOpenedAfterTransferFinalize === true
    && timeoutCase.transferFinalizeSequence < timeoutCase.firstApplyBoundarySequence
    && timeoutCase.mutationWorkAllowedDuringTransferResume === false
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
    proofGate('generated-timeout-budget-cases-covered', generatedCasesCovered, {
      caseCount: generatedCoverage.caseCount,
      timeoutReceiptCounts: generatedCoverage.timeoutReceiptCounts,
      chunkCounts: generatedCoverage.chunkCounts,
      deterministicCaseVector: generatedCoverage.deterministicCaseVector,
    }),
    proofGate('timeout-budget-interrupts-transfer-before-apply', timeoutInterruptsTransfer, {
      timeoutBudgetMs: cases.map((timeoutCase) => timeoutCase.timeoutBudgetMs),
      elapsedMsAtTimeout: cases.map((timeoutCase) => timeoutCase.elapsedMsAtTimeout),
      timeoutReceiptCounts: cases.map((timeoutCase) => timeoutCase.receiptsBeforeTimeout),
      timeoutBeforeApply: cases.map((timeoutCase) => timeoutCase.timeoutBeforeApply),
    }),
    proofGate('durable-local-receipts-before-timeout', durableReceiptCoverage, {
      caseCount: cases.length,
      exactReceiptMatches: cases.map((timeoutCase) => timeoutCase.exactReceiptMatches),
      receiptsBeforeTimeout: cases.map((timeoutCase) => timeoutCase.receiptsBeforeTimeout),
      chunksUnacknowledgedAtTimeout: cases.map((timeoutCase) =>
        timeoutCase.chunksUnacknowledgedAtTimeout),
      duplicateReceiptKeys: cases.map((timeoutCase) => timeoutCase.duplicateReceiptKeys),
    }),
    proofGate('receipt-only-resume-after-timeout', resumeSafe, {
      totalChunksSkippedByReceipt: timeoutCases.totalChunksSkippedByReceipt,
      totalChunksUploadedAfterResume: timeoutCases.totalChunksUploadedAfterResume,
      totalDuplicateChunkBytes: timeoutCases.totalDuplicateChunkBytes,
      duplicateMutationWork: cases.map((timeoutCase) => timeoutCase.resumeDuplicateMutationWork),
    }),
    proofGate('no-duplicate-mutation-work', noDuplicateMutationWork, {
      totalDuplicateMutationWork: timeoutCases.totalDuplicateMutationWork,
      maxMutationWorkBeforeTimeout: timeoutCases.maxMutationWorkBeforeTimeout,
      maxMutationWorkBeforeTransferFinalize: timeoutCases.maxMutationWorkBeforeTransferFinalize,
      duplicateMutationWorkByCase: cases.map((timeoutCase) => timeoutCase.duplicateMutationWork),
    }),
    proofGate('apply-opens-after-transfer-finalize', applyOpensAfterTransferFinalize, {
      transferFinalizeSequences: cases.map((timeoutCase) => timeoutCase.transferFinalizeSequence),
      firstApplyBoundarySequences: cases.map((timeoutCase) => timeoutCase.firstApplyBoundarySequence),
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
  missingReceipt.timeoutCases.cases[0].receiptMatches[0].matched = false;
  missingReceipt.timeoutCases.cases[0].exactReceiptMatches -= 1;
  missingReceipt.timeoutCases.cases[0].receiptOnlyResumeSafe = false;

  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.timeoutCases.cases[1].resumeDuplicateMutationWork = 1;
  duplicateMutationWork.timeoutCases.cases[1].freshMutationWorkDuringTransferResume = 1;
  duplicateMutationWork.timeoutCases.cases[1].applyDuplicateMutationWork = 1;
  duplicateMutationWork.timeoutCases.cases[1].duplicateMutationWork = 2;
  duplicateMutationWork.timeoutCases.cases[1].noDuplicateMutationWork = false;
  duplicateMutationWork.timeoutCases.totalDuplicateMutationWork = 2;

  const timeoutCompletesBeforeBudget = withPassedStatus(clone(evidence));
  timeoutCompletesBeforeBudget.timeoutCases.cases[2].nextChunkWouldExceedBudget = false;
  timeoutCompletesBeforeBudget.timeoutCases.cases[2].timeoutExpiredBeforeCompletion = false;

  const earlyApplyBoundary = withPassedStatus(clone(evidence));
  earlyApplyBoundary.timeoutCases.cases[2].firstApplyBoundarySequence =
    earlyApplyBoundary.timeoutCases.cases[2].transferFinalizeSequence - 1;
  earlyApplyBoundary.timeoutCases.cases[2].applyOpenedAfterTransferFinalize = false;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingReceipt: resolveTimeoutBudgetV3Proof(missingReceipt),
    duplicateMutationWork: resolveTimeoutBudgetV3Proof(duplicateMutationWork),
    timeoutCompletesBeforeBudget: resolveTimeoutBudgetV3Proof(timeoutCompletesBeforeBudget),
    earlyApplyBoundary: resolveTimeoutBudgetV3Proof(earlyApplyBoundary),
    overBudget: resolveTimeoutBudgetV3Proof(overBudget),
    prematurePassStatus: resolveTimeoutBudgetV3Proof(prematurePassStatus),
  };
}

function generatedTimeoutBudgetCases() {
  return generatedTimeoutBudgetSpecs().map((spec) => buildGeneratedTimeoutBudgetCase(spec));
}

function generatedTimeoutBudgetSpecs() {
  return [3, 4, 5, 6].map((chunkCount, index) => ({
    caseId: `timeout-budget-${index + 1}`,
    fileBytes: chunkCount * benchmarkOptions.chunkSizeBytes,
    chunkSizeBytes: benchmarkOptions.chunkSizeBytes,
    chunkCount,
    timeoutAfterChunks: index + 1,
  }));
}

function buildGeneratedTimeoutBudgetCase(spec) {
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
  const timeoutBudgetProof = buildChunkTransferTimeoutBudgetProof({
    planId,
    resourceKey,
    manifestEntries,
    chunkReceiptRecords,
    journalRecords,
    resumeRecords: [],
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
    generatedCoverage: evidence.generatedCoverage,
    runtime: evidence.runtime,
    resources: evidence.resources,
    transfer: evidence.transfer,
    timeoutCases: evidence.timeoutCases,
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
