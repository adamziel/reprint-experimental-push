import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  productionThroughputBlockers,
  runGuardedExecutorBenchmark,
} from '../scripts/bench/guarded-executor-benchmark.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';
import { buildChunkTransferTransactionBoundaryPolicy } from '../src/transaction-boundary-policy.js';

const proofId = 'rpp-0783-transaction-boundary-policy-release-verifier-v5';
const evidenceSource = 'transaction-boundary-policy-release-verifier-v5';
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
const expectedReleaseVerifierGateIds = Object.freeze([
  'release-verifier-runtime-resources-gates-reported',
  'built-on-transaction-boundary-policy-v4',
  'transaction-boundary-receipt-only-resume',
  'deterministic-resume-regression-carried-through',
  'apply-after-transfer-finalize-no-duplicate-mutation-work',
  'rollout-safety-gate-vector-carried-through',
  'hash-count-only-release-verifier-evidence',
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
const expectedRolloutGateStatuses = Object.freeze({
  'guarded-transfer-manifest': 'passed',
  'chunk-hash-verification': 'passed',
  'receipt-only-resume': 'passed',
  'chunk-replay-idempotency': 'passed',
  'live-remote-preconditions': 'passed',
  'parallel-snapshot-hashing': 'passed',
  'durable-journal-integrity': 'passed',
  'failure-recovery-classification': 'passed',
  'atomic-group-visibility': 'passed',
  'production-storage-receipts': 'blocked',
  'production-row-batch-executor': 'blocked',
  'production-atomic-group-commit': 'blocked',
});

test('RPP-0783 release verifier v5 carries transaction boundary policy with zero duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildReleaseVerifierProof();

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0783');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0763');
  assert.equal(proof.builtOn.proofId, 'rpp-0763-transaction-boundary-policy-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourcePolicy.policyId, 'rpp-0703-transaction-boundary-policy');
  assert.equal(proof.builtOn.sourcePolicy.variant, 1);
  assert.equal(proof.builtOn.sourcePolicy.status, 'passed');
  assert.match(proof.builtOn.sourcePolicy.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.releaseVerifier.command,
    'node --test --test-name-pattern RPP-0783 test/rpp-0783-transaction-boundary-policy-release-verifier-v5.test.js');
  assert.equal(proof.releaseVerifier.runtimeReported, true);
  assert.equal(proof.releaseVerifier.resourcesReported, true);
  assert.equal(proof.releaseVerifier.passFailGatesReported, true);
  assert.equal(proof.releaseVerifier.productionGateEvidence, 'not-present');
  assert.deepEqual(proof.releaseVerifier.passGateIds.sort(), [
    'atomic-group-visibility',
    'chunk-hash-verification',
    'chunk-replay-idempotency',
    'durable-journal-integrity',
    'failure-recovery-classification',
    'guarded-transfer-manifest',
    'live-remote-preconditions',
    'parallel-snapshot-hashing',
    'receipt-only-resume',
  ].sort());
  assert.deepEqual(proof.releaseVerifier.blockedGateIds.sort(), [
    'production-atomic-group-commit',
    'production-row-batch-executor',
    'production-storage-receipts',
  ].sort());
  assert.deepEqual(proof.releaseVerifier.failGateIds, []);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'unit');
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.storage.receiptBackend, 'lab-file-journal-receipts');
  assert.equal(proof.resources.storage.productionBacked, false);
  assert.equal(proof.resources.storage.chunkReceipts, proof.transfer.chunkCount);
  assert.equal(proof.resources.storage.finalStagingRecordPresent, true);
  assert.equal(proof.resources.storage.fileBytes, benchmarkOptions.fileBytes);
  assert.equal(proof.resources.storage.chunkSizeBytes, benchmarkOptions.chunkSizeBytes);
  assert.equal(proof.resources.storage.chunkCount, 4);

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
  assert.deepEqual(proof.resume.resumeCursorFields, expectedResumeCursorFields);

  assert.equal(proof.resumeRegression.source, 'local-generated-transaction-boundary-release-verifier-cases');
  assert.equal(proof.resumeRegression.releaseVerifierVariant, 'transaction-boundary-policy-release-verifier-v5');
  assert.equal(proof.resumeRegression.caseCount, 4);
  assert.equal(proof.resumeRegression.deterministicCaseVector, true);
  assert.deepEqual(proof.resumeRegression.chunkCounts, [2, 3, 4, 5]);
  assert.deepEqual(proof.resumeRegression.caseStatuses, ['passed', 'passed', 'passed', 'passed']);
  assert.equal(proof.resumeRegression.totalChunksSkippedByReceipt, 14);
  assert.equal(proof.resumeRegression.totalChunksToUpload, 0);
  assert.equal(proof.resumeRegression.totalBytesToUpload, 0);
  assert.equal(proof.resumeRegression.totalDuplicateChunkBytes, 0);
  assert.equal(proof.resumeRegression.totalDuplicateMutationWork, 0);
  assert.equal(proof.resumeRegression.duplicateResumeProbeCount, 4);
  assert.equal(proof.resumeRegression.duplicateResumeProbesBlocked, 4);
  assert.equal(proof.resumeRegression.missingReceiptProbesBlocked, 4);

  for (const resumeCase of proof.resumeRegression.cases) {
    assert.equal(resumeCase.status, 'passed');
    assert.equal(resumeCase.transferComplete, true);
    assert.equal(resumeCase.exactReceiptMatches, resumeCase.chunkCount);
    assert.equal(resumeCase.chunksToUpload, 0);
    assert.equal(resumeCase.bytesToUpload, 0);
    assert.equal(resumeCase.duplicateChunkBytes, 0);
    assert.equal(resumeCase.duplicateMutationWork, 0);
    assert.equal(resumeCase.noDuplicateMutationWork, true);
    assert.equal(resumeCase.applyOpenedAfterTransferFinalize, true);
    assert.equal(resumeCase.mutationWorkAllowedDuringTransferResume, false);
    assert.equal(resumeCase.duplicateResumeProbe.blocked, true);
    assert.equal(resumeCase.missingReceiptProbe.blocked, true);
    assert.match(resumeCase.caseHash, /^[a-f0-9]{64}$/);
    assert.match(resumeCase.policyHash, /^sha256:[a-f0-9]{64}$/);
  }

  assert.equal(proof.apply.applyOpenedAfterTransferFinalize, true);
  assert.equal(proof.apply.mutationWorkAllowedDuringTransferResume, false);
  assert.equal(proof.apply.mutationWorkReplayedBeforeTransferFinalize, 0);
  assert.equal(proof.apply.freshMutationWorkDuringTransferResume, 0);
  assert.equal(proof.apply.duplicateMutationWork, 0);
  assert.equal(proof.apply.noDuplicateMutationWork, true);

  assert.equal(proof.replay.status, 'passed');
  assert.equal(proof.replay.idempotentReplaySafe, true);
  assert.equal(proof.replay.attemptedReplayCount, proof.transfer.chunkCount * 2);
  assert.equal(proof.replay.idempotentSkips, proof.replay.attemptedReplayCount);
  assert.equal(proof.replay.duplicateChunkBytes, 0);
  assert.equal(proof.replay.duplicateReceiptRecordsWritten, 0);
  assert.equal(proof.replay.duplicateMutationWork, 0);
  assert.equal(proof.replay.noDuplicateMutationWork, true);
  assert.equal(proof.replay.applyBoundaryOpenedDuringReplay, false);

  assert.deepEqual(proof.rolloutSafety.gateStatuses, expectedRolloutGateStatuses);
  assert.equal(proof.rolloutSafety.summary.passed, 9);
  assert.equal(proof.rolloutSafety.summary.blocked, 3);
  assert.equal(proof.rolloutSafety.summary.failed, 0);
  assert.equal(proof.rolloutSafety.summary.speedClaimsAllowed, false);

  assert.deepEqual(proof.correctness.gateIds, expectedReleaseVerifierGateIds);
  assert.deepEqual(proof.correctness.recomputedGateVector.map((gate) => gate.status), [
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
  assert.deepEqual(proof.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass']);

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.releaseVerifierCarryThrough, 'support-only-local-release-verifier');
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));

  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.redaction.publicEvidenceHash, /^[a-f0-9]{64}$/);
  assert.match(proof.redaction.laneDecisionHash, /^[a-f0-9]{64}$/);
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertHashCountOnlyReleaseVerifierEvidence(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0783 transaction boundary release verifier proof' }));
});

test('RPP-0783 release verifier v5 blocks stale transaction boundary carry-through evidence', () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence);
  const unsafeDecisions = unsafeReleaseVerifierDecisions(evidence);

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
  ]);

  assert.equal(unsafeDecisions.missingRuntimeReport.updated, false);
  assert.ok(unsafeDecisions.missingRuntimeReport.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(unsafeDecisions.missingReceipt.updated, false);
  assert.ok(unsafeDecisions.missingReceipt.blockedBy
    .includes('transaction-boundary-receipt-only-resume'));
  assert.equal(unsafeDecisions.regressionUpload.updated, false);
  assert.ok(unsafeDecisions.regressionUpload.blockedBy
    .includes('deterministic-resume-regression-carried-through'));
  assert.equal(unsafeDecisions.duplicateMutationWork.updated, false);
  assert.ok(unsafeDecisions.duplicateMutationWork.blockedBy
    .includes('apply-after-transfer-finalize-no-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.earlyApplyBoundary.updated, false);
  assert.ok(unsafeDecisions.earlyApplyBoundary.blockedBy
    .includes('apply-after-transfer-finalize-no-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy
    .includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashCountOnlyReleaseVerifierEvidence(decision);
  }
});

function buildReleaseVerifierProof() {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence);
  const unsafe = projectUnsafeDecisions(unsafeReleaseVerifierDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'transfer',
  );
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('release-verifier-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-release-verifier-evidence-fails-closed',
      Object.values(unsafe).every((decision) => (
        decision.updated === false
          && decision.outputEmitted === false
          && decision.attemptedPassBlocked === true
      )), {
        blockedDecisionHashes: Object.values(unsafe).map((decision) => decision.decisionHash),
      }),
    proofGate('hash-count-only-release-verifier-proof',
      releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)), {
        rawValueEvidenceLeaks:
          releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)) ? 0 : 1,
      }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.releaseEligible === false
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicProof = {
    schemaVersion: 1,
    rppId: 'RPP-0783',
    proofId,
    variant: 5,
    evidenceSource,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
    integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: evidence.benchmark,
    transfer: evidence.transfer,
    resume: evidence.resume,
    resumeRegression: evidence.resumeRegression,
    apply: evidence.apply,
    replay: evidence.replay,
    rolloutSafety: evidence.rolloutSafety,
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
      mode: 'hash-count-only-transaction-boundary-release-verifier',
      rawValueEvidenceLeaks: releaseVerifierEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(evidence)),
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
  const generatedCases = generatedReleaseVerifierResumeCases();
  const repeatedCases = generatedReleaseVerifierResumeCases();
  const evidence = buildReleaseVerifierEvidence({
    report,
    generatedCases,
    repeatedCases,
  });
  recordCorrectnessGates(evidence);
  return { report, evidence };
}

function runUnitBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0783-boundary-v5-'));
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

function buildReleaseVerifierEvidence({
  report,
  generatedCases,
  repeatedCases,
}) {
  const policy = report.evidence.transactionBoundaryPolicy;
  const replay = report.evidence.guardedTransfer.replayIdempotency;
  const productionBlockers = productionThroughputBlockers(report);
  const rolloutGates = report.rolloutSafetyGates.gates;
  const caseHashes = generatedCases.map((resumeCase) => resumeCase.caseHash);
  const repeatedCaseHashes = repeatedCases.map((resumeCase) => resumeCase.caseHash);
  const deterministicCaseVector = sameArray(caseHashes, repeatedCaseHashes);

  return {
    schemaVersion: 1,
    rppId: 'RPP-0783',
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0763',
      proofId: 'rpp-0763-transaction-boundary-policy-v4',
      variant: 4,
      status: policy.status === 'passed' ? 'passed' : 'blocked',
      sourcePolicy: {
        rppId: 'RPP-0703',
        policyId: policy.policyId,
        variant: policy.variant,
        status: policy.status,
        evidenceHash: policy.evidenceHash,
      },
    },
    releaseVerifier: {
      command:
        'node --test --test-name-pattern RPP-0783 test/rpp-0783-transaction-boundary-policy-release-verifier-v5.test.js',
      runtimeReported: hasRuntimeReport(report),
      resourcesReported: hasResourceReport(report),
      passFailGatesReported: hasRolloutGateReport(report),
      gateCount: rolloutGates.length,
      passGateIds: rolloutGates
        .filter((gate) => gate.status === 'passed')
        .map((gate) => gate.id),
      blockedGateIds: rolloutGates
        .filter((gate) => gate.status === 'blocked')
        .map((gate) => gate.id),
      failGateIds: rolloutGates
        .filter((gate) => gate.status === 'failed')
        .map((gate) => gate.id),
      productionGateEvidence: 'not-present',
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
        fileBytes: report.shape.fileBytes,
        chunkSizeBytes: report.shape.chunkSizeBytes,
        chunkCount: report.shape.chunkCount,
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
        failureProbeModes: report.resources.journals.failureProbeModes,
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
      source: 'local-generated-transaction-boundary-release-verifier-cases',
      releaseVerifierVariant: 'transaction-boundary-policy-release-verifier-v5',
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
      exactReceiptMatches: replay.exactReceiptMatches,
      idempotentSkips: replay.idempotentSkips,
      idempotentReplaySafe: replay.idempotentReplaySafe,
      duplicateChunkBytes: replay.bytes.duplicateChunkBytes,
      duplicateReceiptRecordsWritten: replay.receipts.duplicateReceiptRecordsWritten,
      duplicateMutationWork: replay.mutationWork.duplicateMutationWork,
      noDuplicateMutationWork: replay.mutationWork.noDuplicateMutationWork,
      applyBoundaryOpenedDuringReplay: replay.mutationWork.applyBoundaryOpenedDuringReplay,
      evidenceHash: replay.evidenceHash,
    },
    rolloutSafety: {
      gateStatuses: Object.fromEntries(rolloutGates.map((gate) => [gate.id, gate.status])),
      summary: report.rolloutSafetyGates.summary,
    },
    release: supportOnlyReleasePosture(report, productionBlockers),
  };
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeReleaseVerifierGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveReleaseVerifierCarryThrough(evidence) {
  const recomputedGates = recomputeReleaseVerifierGates(evidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedReleaseVerifierGateIds);
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
        evidenceSource,
        gateVectorHash: sha256(recomputedGates),
        releaseVerifierHash: sha256(evidence.releaseVerifier),
        transactionBoundaryHash: sha256({
          transfer: evidence.transfer,
          resume: evidence.resume,
          apply: evidence.apply,
          replay: evidence.replay,
        }),
        resumeRegressionHash: sha256({
          caseCount: evidence.resumeRegression.caseCount,
          caseHashes: evidence.resumeRegression.caseHashes,
          totalChunksToUpload: evidence.resumeRegression.totalChunksToUpload,
          totalDuplicateMutationWork: evidence.resumeRegression.totalDuplicateMutationWork,
          duplicateResumeProbesBlocked: evidence.resumeRegression.duplicateResumeProbesBlocked,
        }),
        rolloutGateHash: sha256(evidence.rolloutSafety.gateStatuses),
        duplicateMutationWork: evidence.resume.duplicateMutationWork
          + evidence.apply.duplicateMutationWork
          + evidence.replay.duplicateMutationWork
          + evidence.resumeRegression.totalDuplicateMutationWork,
        supportOnly: evidence.release.supportOnly,
        productionBacked: evidence.release.productionBacked,
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
    hashCountOnlyOutput: output ? releaseVerifierEvidenceHasNoRawValues(output) : false,
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

function recomputeReleaseVerifierGates(evidence) {
  const releaseVerifier = evidence.releaseVerifier || {};
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
  const rolloutSafety = evidence.rolloutSafety || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const receiptMatches = Array.isArray(transfer.receiptMatches)
    ? transfer.receiptMatches
    : [];
  const releaseVerifierReported = releaseVerifier.runtimeReported === true
    && releaseVerifier.resourcesReported === true
    && releaseVerifier.passFailGatesReported === true
    && releaseVerifier.gateCount === Object.keys(expectedRolloutGateStatuses).length
    && Array.isArray(releaseVerifier.passGateIds)
    && Array.isArray(releaseVerifier.blockedGateIds)
    && Array.isArray(releaseVerifier.failGateIds)
    && releaseVerifier.passGateIds.length === 9
    && releaseVerifier.blockedGateIds.length === 3
    && releaseVerifier.failGateIds.length === 0;
  const builtOnV4 = evidence.builtOn?.rppId === 'RPP-0763'
    && evidence.builtOn?.proofId === 'rpp-0763-transaction-boundary-policy-v4'
    && evidence.builtOn?.variant === 4
    && evidence.builtOn?.status === 'passed'
    && sourcePolicy.policyId === 'rpp-0703-transaction-boundary-policy'
    && sourcePolicy.variant === 1
    && sourcePolicy.status === 'passed'
    && isSha256Hash(sourcePolicy.evidenceHash);
  const receiptOnlyResumeSafe = transfer.complete === true
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
    && resume.status === 'passed'
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
  const generatedCasesCovered =
    resumeRegression.source === 'local-generated-transaction-boundary-release-verifier-cases'
    && resumeRegression.releaseVerifierVariant === 'transaction-boundary-policy-release-verifier-v5'
    && resumeRegression.caseCount === 4
    && resumeRegression.caseCount === cases.length
    && resumeRegression.deterministicCaseVector === true
    && sameArray(resumeRegression.caseHashes || [], resumeRegression.repeatedCaseHashes || [])
    && sameArray(resumeRegression.chunkCounts || [], [2, 3, 4, 5])
    && resumeRegression.caseStatuses?.every((status) => status === 'passed')
    && resumeRegression.totalChunksToUpload === 0
    && resumeRegression.totalBytesToUpload === 0
    && resumeRegression.totalDuplicateChunkBytes === 0
    && resumeRegression.totalDuplicateMutationWork === 0
    && resumeRegression.duplicateResumeProbeCount === cases.length
    && resumeRegression.duplicateResumeProbesBlocked === cases.length
    && resumeRegression.missingReceiptProbesBlocked === cases.length
    && cases.every((resumeCase) => (
      resumeCase.transferComplete === true
      && resumeCase.exactReceiptMatches === resumeCase.chunkCount
      && resumeCase.chunksToUpload === 0
      && resumeCase.bytesToUpload === 0
      && resumeCase.duplicateChunkBytes === 0
      && resumeCase.duplicateMutationWork === 0
      && resumeCase.noDuplicateMutationWork === true
      && resumeCase.duplicateResumeProbe.blocked === true
      && resumeCase.missingReceiptProbe.blocked === true
    ));
  const noDuplicateMutationWork = resume.duplicateMutationWork === 0
    && apply.mutationWorkReplayedBeforeTransferFinalize === 0
    && apply.freshMutationWorkDuringTransferResume === 0
    && apply.duplicateMutationWork === 0
    && apply.noDuplicateMutationWork === true
    && replay.duplicateMutationWork === 0
    && replay.noDuplicateMutationWork === true
    && replay.idempotentReplaySafe === true
    && replay.duplicateReceiptRecordsWritten === 0
    && replay.duplicateChunkBytes === 0
    && resumeRegression.totalDuplicateMutationWork === 0;
  const applyOpensAfterTransferFinalize = apply.applyOpenedAfterTransferFinalize === true
    && transfer.transferFinalizeSequence < apply.firstApplyBoundarySequence
    && apply.mutationWorkAllowedDuringTransferResume === false
    && replay.applyBoundaryOpenedDuringReplay === false
    && cases.every((resumeCase) => (
      resumeCase.applyOpenedAfterTransferFinalize === true
      && resumeCase.transferFinalizeSequence < resumeCase.firstApplyBoundarySequence
      && resumeCase.mutationWorkAllowedDuringTransferResume === false
    ));
  const rolloutGateVectorCarried = Object.entries(expectedRolloutGateStatuses)
    .every(([id, status]) => rolloutSafety.gateStatuses?.[id] === status)
    && rolloutSafety.summary?.passed === 9
    && rolloutSafety.summary?.blocked === 3
    && rolloutSafety.summary?.failed === 0
    && rolloutSafety.summary?.speedClaimsAllowed === false;
  const runtimeWithinBudget = runtime.profile === 'unit'
    && runtime.budgetStatus === 'passed'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && journals.allJournalsIntegrityOk === true
    && journals.durableJournalsContainNoRawValues === true;

  return [
    proofGate('release-verifier-runtime-resources-gates-reported',
      releaseVerifierReported && runtimeWithinBudget, {
        runtimeReported: releaseVerifier.runtimeReported,
        resourcesReported: releaseVerifier.resourcesReported,
        passFailGatesReported: releaseVerifier.passFailGatesReported,
        gateCount: releaseVerifier.gateCount,
        durationMs: runtime.durationMs,
        heapUsedBytes: processResources.heapUsedBytes,
      }),
    proofGate('built-on-transaction-boundary-policy-v4', builtOnV4, {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      sourcePolicyStatus: sourcePolicy.status,
      sourcePolicyVariant: sourcePolicy.variant,
    }),
    proofGate('transaction-boundary-receipt-only-resume', receiptOnlyResumeSafe, {
      exactReceiptMatches: transfer.exactReceiptMatches,
      chunkCount: transfer.chunkCount,
      chunksSkippedByReceipt: resume.chunksSkippedByReceipt,
      chunksToUpload: resume.chunksToUpload,
      duplicateMutationWork: resume.duplicateMutationWork,
    }),
    proofGate('deterministic-resume-regression-carried-through', generatedCasesCovered, {
      caseCount: resumeRegression.caseCount,
      chunkCounts: resumeRegression.chunkCounts,
      totalChunksToUpload: resumeRegression.totalChunksToUpload,
      totalDuplicateMutationWork: resumeRegression.totalDuplicateMutationWork,
    }),
    proofGate('apply-after-transfer-finalize-no-duplicate-mutation-work',
      applyOpensAfterTransferFinalize && noDuplicateMutationWork, {
        transferFinalizeSequence: transfer.transferFinalizeSequence,
        firstApplyBoundarySequence: apply.firstApplyBoundarySequence,
        applyDuplicateMutationWork: apply.duplicateMutationWork,
        replayDuplicateMutationWork: replay.duplicateMutationWork,
        regressionDuplicateMutationWork: resumeRegression.totalDuplicateMutationWork,
      }),
    proofGate('rollout-safety-gate-vector-carried-through', rolloutGateVectorCarried, {
      passed: rolloutSafety.summary?.passed,
      blocked: rolloutSafety.summary?.blocked,
      failed: rolloutSafety.summary?.failed,
      speedClaimsAllowed: rolloutSafety.summary?.speedClaimsAllowed,
    }),
    proofGate('hash-count-only-release-verifier-evidence',
      releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)), {
        rawValueEvidenceLeaks:
          releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)) ? 0 : 1,
      }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.releaseEligible === false
      && release.releaseVerifierCarryThrough === 'support-only-local-release-verifier'
      && release.productionThroughput === 'not-claimed'
      && release.speedClaimsAllowed === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO'
      && releaseBlockers.includes('production-storage-receipts-not-measured')
      && releaseBlockers.includes('production-row-batch-executor-not-measured')
      && releaseBlockers.includes('production-atomic-group-commit-not-measured'), {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      releaseEligible: release.releaseEligible,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function unsafeReleaseVerifierDecisions(evidence) {
  const missingRuntimeReport = withPassedStatus(clone(evidence));
  missingRuntimeReport.releaseVerifier.runtimeReported = false;

  const missingReceipt = withPassedStatus(clone(evidence));
  missingReceipt.transfer.receiptMatches[0].matched = false;
  missingReceipt.transfer.exactReceiptMatches -= 1;
  missingReceipt.resume.chunksSkippedByReceipt -= 1;
  missingReceipt.resume.chunksToUpload = 1;
  missingReceipt.resume.bytesToUpload = benchmarkOptions.chunkSizeBytes;

  const regressionUpload = withPassedStatus(clone(evidence));
  regressionUpload.resumeRegression.cases[1].chunksToUpload = 1;
  regressionUpload.resumeRegression.cases[1].bytesToUpload =
    regressionUpload.resumeRegression.cases[1].chunkSizeBytes;
  regressionUpload.resumeRegression.totalChunksToUpload = 1;
  regressionUpload.resumeRegression.totalBytesToUpload =
    regressionUpload.resumeRegression.cases[1].chunkSizeBytes;

  const duplicateMutationWork = withPassedStatus(clone(evidence));
  duplicateMutationWork.resume.duplicateMutationWork = 1;
  duplicateMutationWork.apply.duplicateMutationWork = 1;
  duplicateMutationWork.apply.noDuplicateMutationWork = false;
  duplicateMutationWork.replay.duplicateMutationWork = 1;
  duplicateMutationWork.replay.noDuplicateMutationWork = false;
  duplicateMutationWork.resumeRegression.totalDuplicateMutationWork = 1;

  const earlyApplyBoundary = withPassedStatus(clone(evidence));
  earlyApplyBoundary.apply.applyOpenedAfterTransferFinalize = false;
  earlyApplyBoundary.apply.firstApplyBoundarySequence =
    earlyApplyBoundary.transfer.transferFinalizeSequence;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingRuntimeReport: resolveReleaseVerifierCarryThrough(missingRuntimeReport),
    missingReceipt: resolveReleaseVerifierCarryThrough(missingReceipt),
    regressionUpload: resolveReleaseVerifierCarryThrough(regressionUpload),
    duplicateMutationWork: resolveReleaseVerifierCarryThrough(duplicateMutationWork),
    earlyApplyBoundary: resolveReleaseVerifierCarryThrough(earlyApplyBoundary),
    prematurePassStatus: resolveReleaseVerifierCarryThrough(prematurePassStatus),
  };
}

function generatedReleaseVerifierResumeCases() {
  return [2, 3, 4, 5].map((chunkCount) => buildReleaseVerifierResumeCase({
    caseId: `release-verifier-resume-${chunkCount}-chunks`,
    fileBytes: chunkCount * benchmarkOptions.chunkSizeBytes,
    chunkSizeBytes: benchmarkOptions.chunkSizeBytes,
    chunkCount,
  }));
}

function buildReleaseVerifierResumeCase(spec) {
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
      graphIdentityTargetCount: report.shape.graphIdentityTargetCount,
      snapshotHashResources: report.shape.snapshotHashResources,
      snapshotHashJobs: report.shape.snapshotHashJobs,
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
    releaseEligible: false,
    productionThroughput: report.throughput.productionThroughput,
    speedClaimsAllowed: report.rolloutSafetyGates.summary.speedClaimsAllowed,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'support-only-local-release-verifier',
    productionReleaseApproval: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: unique([
      ...productionBlockers,
      'live-production-service-not-supplied',
      'production-release-approval-not-supplied',
    ]),
  };
}

function publicReleaseVerifierEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    evidenceSource: evidence.evidenceSource,
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: evidence.benchmark,
    transfer: evidence.transfer,
    resume: evidence.resume,
    resumeRegression: evidence.resumeRegression,
    apply: evidence.apply,
    replay: evidence.replay,
    rolloutSafety: evidence.rolloutSafety,
    release: evidence.release,
  };
}

function hasRuntimeReport(report) {
  return report.runtime
    && typeof report.runtime.generatedAt === 'string'
    && typeof report.runtime.durationMs === 'number'
    && typeof report.runtime.node === 'string'
    && typeof report.runtime.platform === 'string'
    && typeof report.runtime.arch === 'string'
    && typeof report.runtime.cpuCount === 'number';
}

function hasResourceReport(report) {
  return report.resources
    && report.resources.process
    && report.resources.transfer
    && report.resources.apply
    && report.resources.journals
    && typeof report.resources.process.heapUsedBytes === 'number'
    && typeof report.resources.transfer.chunkReceipts === 'number'
    && typeof report.resources.apply.mutationResources === 'number'
    && typeof report.resources.journals.successRecords === 'number';
}

function hasRolloutGateReport(report) {
  const gates = report.rolloutSafetyGates?.gates;
  return Array.isArray(gates)
    && gates.length === Object.keys(expectedRolloutGateStatuses).length
    && gates.every((gate) =>
      expectedRolloutGateStatuses[gate.id] === gate.status);
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

function assertHashCountOnlyReleaseVerifierEvidence(value) {
  assert.equal(releaseVerifierEvidenceHasNoRawValues(value), true);
}

function releaseVerifierEvidenceHasNoRawValues(value) {
  return !rawReleaseVerifierEvidencePattern().test(JSON.stringify(value));
}

function rawReleaseVerifierEvidencePattern() {
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
