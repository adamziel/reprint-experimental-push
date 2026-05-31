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
import { buildChunkTransferTimeoutBudgetProof } from '../src/timeout-budget-proof.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0798-timeout-budget-proof-release-verifier-v5';
const evidenceSource = 'timeout-budget-proof-release-verifier-v5';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const chunkAttemptBudgetMs = 1_000;
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256PrefixedPattern = /^sha256:[a-f0-9]{64}$/;
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
const expectedReleaseVerifierGateIds = Object.freeze([
  'release-verifier-runtime-resources-gates-reported',
  'built-on-timeout-budget-proof-v4',
  'deterministic-replay-resume-cases-carried-through',
  'timeout-budget-interrupts-transfer-before-apply',
  'receipt-only-replay-resume-without-duplicate-mutation-work',
  'resume-journal-records-contain-no-mutation-work',
  'apply-opens-after-transfer-finalize',
  'rollout-safety-gate-vector-carried-through',
  'hash-count-only-release-verifier-evidence',
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
const mutationRecordTypes = Object.freeze([
  'mutation-observed',
  'mutation-applied',
]);

test('RPP-0798 release verifier v5 carries timeout budget proof without duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildReleaseVerifierProof();

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0798');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0778');
  assert.equal(proof.builtOn.proofId, 'rpp-0778-timeout-budget-proof-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.previousVariant.rppId, 'RPP-0758');
  assert.equal(proof.builtOn.previousVariant.proofId, 'rpp-0758-timeout-budget-proof-v3');
  assert.equal(proof.builtOn.previousVariant.variant, 3);
  assert.equal(proof.builtOn.previousVariant.status, 'passed');
  assert.equal(proof.builtOn.previousVariant.builtOn.rppId, 'RPP-0738');
  assert.equal(proof.builtOn.previousVariant.builtOn.proofId, 'rpp-0738-timeout-budget-proof-v2');
  assert.equal(proof.builtOn.previousVariant.builtOn.variant, 2);
  assert.equal(proof.builtOn.previousVariant.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceTimeoutProof.rppId, 'RPP-0718');
  assert.equal(proof.builtOn.sourceTimeoutProof.proofId, 'rpp-0718-timeout-budget-proof');
  assert.equal(proof.builtOn.sourceTimeoutProof.variant, 1);
  assert.equal(proof.builtOn.sourceTimeoutProof.status, 'passed');
  assert.match(proof.builtOn.sourceTimeoutProof.evidenceHash, sha256Pattern);

  assert.equal(
    proof.releaseVerifier.command,
    'node --test --test-name-pattern RPP-0798 test/rpp-0798-timeout-budget-proof-release-verifier-v5.test.js',
  );
  assert.equal(proof.releaseVerifier.runtimeReported, true);
  assert.equal(proof.releaseVerifier.resourcesReported, true);
  assert.equal(proof.releaseVerifier.passFailGatesReported, true);
  assert.equal(proof.releaseVerifier.gateCount, Object.keys(expectedRolloutGateStatuses).length);
  assert.equal(proof.releaseVerifier.productionGateEvidence, 'not-present');
  assert.equal(proof.releaseVerifier.carryThrough, 'support-only-local-release-verifier');
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
  assert.equal(proof.resources.storage.localStorageProof, 'support-only-lab-file-journal');
  assert.equal(proof.resources.storage.productionBacked, false);
  assert.equal(proof.resources.storage.finalStagingRecordPresent, true);
  assert.equal(proof.resources.storage.chunkReceipts, proof.transfer.chunkCount);
  assert.equal(proof.resources.journals.allJournalsIntegrityOk, true);
  assert.equal(proof.resources.journals.durableJournalsContainNoRawValues, true);

  assert.equal(proof.transfer.fileBytes, benchmarkOptions.fileBytes);
  assert.equal(proof.transfer.chunkSizeBytes, benchmarkOptions.chunkSizeBytes);
  assert.equal(proof.transfer.chunkCount, 4);
  assert.equal(proof.transfer.timeoutBudgetScope, 'chunk-transfer-attempt');
  assert.equal(proof.transfer.timeoutProofStatus, 'passed');
  assert.equal(proof.transfer.timeoutReceiptsBeforeTimeout, 2);
  assert.equal(proof.transfer.timeoutChunksUploadedAfterResume, 2);
  assert.equal(proof.transfer.timeoutDuplicateChunkBytes, 0);
  assert.equal(proof.transfer.timeoutDuplicateMutationWork, 0);
  assert.match(proof.transfer.planIdHash, sha256Pattern);
  assert.match(proof.transfer.resourceKeyHash, sha256Pattern);

  assert.equal(proof.replayCoverage.sourceRppId, 'RPP-0778');
  assert.equal(proof.replayCoverage.source, 'local-support-replayed-chunk-transfer-resume-cases');
  assert.equal(proof.replayCoverage.releaseVerifierVariant, evidenceSource);
  assert.equal(proof.replayCoverage.timeoutVariant, 'timeout-budget-proof-release-verifier-v5');
  assert.equal(proof.replayCoverage.previousVariant, 'timeout-budget-proof-v4');
  assert.equal(proof.replayCoverage.caseCount, 4);
  assert.equal(proof.replayCoverage.deterministicCaseVector, true);
  assert.deepEqual(proof.replayCoverage.timeoutReceiptCounts, [1, 2, 3, 4]);
  assert.deepEqual(proof.replayCoverage.resumeReplayChunkCounts, [4, 5, 6, 7]);
  assert.deepEqual(proof.replayCoverage.unreceiptedChunkCounts, [3, 3, 3, 3]);
  assert.deepEqual(proof.replayCoverage.caseStatuses, ['passed', 'passed', 'passed', 'passed']);
  assert.ok(proof.replayCoverage.caseHashes.every((hash) => sha256Pattern.test(hash)));
  assert.deepEqual(proof.replayCoverage.caseHashes, proof.replayCoverage.repeatedCaseHashes);

  assert.equal(proof.replayResume.caseCount, 4);
  assert.equal(proof.replayResume.allCasesPassed, true);
  assert.equal(proof.replayResume.totalChunksReplayedOnResume, 22);
  assert.equal(proof.replayResume.totalChunksSkippedByReceipt, 10);
  assert.equal(proof.replayResume.totalChunksUploadedAfterResume, 12);
  assert.equal(proof.replayResume.totalDuplicateChunkBytes, 0);
  assert.equal(proof.replayResume.totalDuplicateMutationWork, 0);
  assert.equal(proof.replayResume.totalResumeBookkeepingRecordCount, 22);
  assert.equal(proof.replayResume.totalResumeMutationRecordCount, 0);
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
    assert.equal(replayCase.resumeBookkeepingRecordCount, replayCase.chunkCount);
    assert.equal(replayCase.resumeMutationRecordCount, 0);
    assert.equal(replayCase.mutationWorkBeforeTimeout, 0);
    assert.equal(replayCase.mutationWorkReplayedBeforeTransferFinalize, 0);
    assert.equal(replayCase.freshMutationWorkDuringTransferResume, 0);
    assert.equal(replayCase.noDuplicateMutationWork, true);
    assert.equal(replayCase.applyOpenedAfterTransferFinalize, true);
    assert.equal(replayCase.mutationWorkAllowedDuringTransferResume, false);
    assert.ok(replayCase.transferFinalizeSequence < replayCase.firstApplyBoundarySequence);
    assert.deepEqual(replayCase.resumeCursorFields, expectedResumeCursorFields);
    assert.equal(replayCase.resumeDecisionHashes.length, replayCase.chunkCount);
    assert.ok(replayCase.resumeDecisionHashes.every((hash) => sha256PrefixedPattern.test(hash)));
    assert.match(replayCase.caseHash, sha256Pattern);
    assert.match(replayCase.planIdHash, sha256Pattern);
    assert.match(replayCase.resourceKeyHash, sha256Pattern);
    assert.match(replayCase.proofHash, sha256PrefixedPattern);
    assert.equal(replayCase.receiptMatches.length, replayCase.chunkCount);
    assert.ok(replayCase.receiptMatches.every((match) => match.matched === true));
    assert.ok(replayCase.receiptMatches.some((match) => match.receiptedBeforeTimeout));
    assert.ok(replayCase.receiptMatches.some((match) => match.resumedAfterTimeout));
  }

  assert.deepEqual(proof.rolloutSafety.gateStatuses, expectedRolloutGateStatuses);
  assert.equal(proof.rolloutSafety.summary.passed, 9);
  assert.equal(proof.rolloutSafety.summary.blocked, 3);
  assert.equal(proof.rolloutSafety.summary.failed, 0);
  assert.equal(proof.rolloutSafety.summary.speedClaimsAllowed, false);

  assert.deepEqual(proof.correctness.gateIds, expectedReleaseVerifierGateIds);
  assert.deepEqual(
    proof.correctness.recomputedGateVector.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashCountOnlyOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.equal(proof.determinism.sameReplayProjection, true);
  assert.deepEqual(proof.determinism.ignoredVolatileFields, [
    'runtime.durationMs',
    'resources.process',
  ]);
  assert.match(proof.outputHash, sha256PrefixedPattern);
  assert.deepEqual(proof.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass']);

  assert.equal(proof.unsafe.missingRuntimeReport.updated, false);
  assert.ok(proof.unsafe.missingRuntimeReport.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(proof.unsafe.staleReplayCoverage.updated, false);
  assert.ok(proof.unsafe.staleReplayCoverage.blockedBy
    .includes('deterministic-replay-resume-cases-carried-through'));
  assert.equal(proof.unsafe.missingReceipt.updated, false);
  assert.ok(proof.unsafe.missingReceipt.blockedBy
    .includes('receipt-only-replay-resume-without-duplicate-mutation-work'));
  assert.equal(proof.unsafe.duplicateChunkReplay.updated, false);
  assert.ok(proof.unsafe.duplicateChunkReplay.blockedBy
    .includes('receipt-only-replay-resume-without-duplicate-mutation-work'));
  assert.equal(proof.unsafe.duplicateMutationWork.updated, false);
  assert.ok(proof.unsafe.duplicateMutationWork.blockedBy
    .includes('receipt-only-replay-resume-without-duplicate-mutation-work'));
  assert.equal(proof.unsafe.resumeMutationWork.updated, false);
  assert.ok(proof.unsafe.resumeMutationWork.blockedBy
    .includes('resume-journal-records-contain-no-mutation-work'));
  assert.equal(proof.unsafe.timeoutCompletesBeforeBudget.updated, false);
  assert.ok(proof.unsafe.timeoutCompletesBeforeBudget.blockedBy
    .includes('timeout-budget-interrupts-transfer-before-apply'));
  assert.equal(proof.unsafe.earlyApplyBoundary.updated, false);
  assert.ok(proof.unsafe.earlyApplyBoundary.blockedBy.includes('apply-opens-after-transfer-finalize'));
  assert.equal(proof.unsafe.rolloutGateMissing.updated, false);
  assert.ok(proof.unsafe.rolloutGateMissing.blockedBy
    .includes('rollout-safety-gate-vector-carried-through'));
  assert.equal(proof.unsafe.rawValueLeak.updated, false);
  assert.ok(proof.unsafe.rawValueLeak.blockedBy.includes('hash-count-only-release-verifier-evidence'));
  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.ok(proof.unsafe.overBudget.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.releaseEligible, false);
  assert.equal(proof.release.releaseVerifierCarryThrough, 'support-only-local-release-verifier');
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));

  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.redaction.publicEvidenceHash, sha256Pattern);
  assert.match(proof.redaction.laneDecisionHash, sha256Pattern);
  assert.match(proof.evidenceHash, sha256Pattern);
  assertHashCountOnlyReleaseVerifierEvidence(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0798 timeout budget proof release verifier' }));
});

test('RPP-0798 release verifier v5 blocks stale timeout budget carry-through evidence', {
  concurrency: false,
}, () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence);
  const unsafeDecisions = unsafeReleaseVerifierDecisions(evidence);

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(
    safeDecision.recomputedGates.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );

  assert.equal(unsafeDecisions.missingRuntimeReport.updated, false);
  assert.ok(unsafeDecisions.missingRuntimeReport.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(unsafeDecisions.staleReplayCoverage.updated, false);
  assert.ok(unsafeDecisions.staleReplayCoverage.blockedBy
    .includes('deterministic-replay-resume-cases-carried-through'));
  assert.equal(unsafeDecisions.missingReceipt.updated, false);
  assert.ok(unsafeDecisions.missingReceipt.blockedBy
    .includes('receipt-only-replay-resume-without-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.duplicateChunkReplay.updated, false);
  assert.ok(unsafeDecisions.duplicateChunkReplay.blockedBy
    .includes('receipt-only-replay-resume-without-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.duplicateMutationWork.updated, false);
  assert.ok(unsafeDecisions.duplicateMutationWork.blockedBy
    .includes('receipt-only-replay-resume-without-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.resumeMutationWork.updated, false);
  assert.ok(unsafeDecisions.resumeMutationWork.blockedBy
    .includes('resume-journal-records-contain-no-mutation-work'));
  assert.equal(unsafeDecisions.timeoutCompletesBeforeBudget.updated, false);
  assert.ok(unsafeDecisions.timeoutCompletesBeforeBudget.blockedBy
    .includes('timeout-budget-interrupts-transfer-before-apply'));
  assert.equal(unsafeDecisions.earlyApplyBoundary.updated, false);
  assert.ok(unsafeDecisions.earlyApplyBoundary.blockedBy.includes('apply-opens-after-transfer-finalize'));
  assert.equal(unsafeDecisions.rolloutGateMissing.updated, false);
  assert.ok(unsafeDecisions.rolloutGateMissing.blockedBy
    .includes('rollout-safety-gate-vector-carried-through'));
  assert.equal(unsafeDecisions.rawValueLeak.updated, false);
  assert.ok(unsafeDecisions.rawValueLeak.blockedBy
    .includes('hash-count-only-release-verifier-evidence'));
  assert.equal(unsafeDecisions.overBudget.updated, false);
  assert.ok(unsafeDecisions.overBudget.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, sha256Pattern);
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
    'replayResume',
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
    rppId: 'RPP-0798',
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
    replayCoverage: evidence.replayCoverage,
    replayResume: evidence.replayResume,
    rolloutSafety: evidence.rolloutSafety,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashCountOnlyOutput: safeDecision.hashCountOnlyOutput,
      outputEmittedAfterGates: safeDecision.outputEmitted,
    },
    determinism: evidence.determinism,
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-count-only-timeout-budget-proof-release-verifier-v5',
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
  const generatedCases = generatedReplayResumeCases();
  const repeatedCases = generatedReplayResumeCases();
  const evidence = buildReleaseVerifierEvidence({
    report,
    generatedCases,
    repeatedCases,
  });
  recordCorrectnessGates(evidence);
  return { report, evidence };
}

function runUnitBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0798-timeout-v5-'));
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

function buildReleaseVerifierEvidence({ report, generatedCases, repeatedCases }) {
  const timeoutProof = report.evidence.timeoutBudgetProof;
  const productionBlockers = productionThroughputBlockers(report);
  const rolloutGates = report.rolloutSafetyGates.gates;
  const caseHashes = generatedCases.map((replayCase) => replayCase.caseHash);
  const repeatedCaseHashes = repeatedCases.map((replayCase) => replayCase.caseHash);
  const deterministicCaseVector = sameArray(caseHashes, repeatedCaseHashes);
  const generatedCasesPassed = generatedCases.every((replayCase) =>
    replayCase.status === 'passed');

  return {
    schemaVersion: 1,
    rppId: 'RPP-0798',
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0778',
      proofId: 'rpp-0778-timeout-budget-proof-v4',
      variant: 4,
      status: generatedCasesPassed && timeoutProof.status === 'passed' ? 'passed' : 'blocked',
      previousVariant: {
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
      },
      sourceTimeoutProof: {
        rppId: 'RPP-0718',
        proofId: timeoutProof.proofId,
        variant: timeoutProof.variant,
        status: timeoutProof.status,
        evidenceHash: timeoutProof.evidenceHash,
      },
    },
    releaseVerifier: {
      command:
        'node --test --test-name-pattern RPP-0798 test/rpp-0798-timeout-budget-proof-release-verifier-v5.test.js',
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
      carryThrough: 'support-only-local-release-verifier',
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
        failureProbeModes: report.resources.journals.failureProbeModes,
        allJournalsIntegrityOk: report.evidence.journal.allJournalsIntegrityOk,
        durableJournalsContainNoRawValues:
          report.evidence.redaction.durableJournalsContainNoRawValues,
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
    replayCoverage: {
      sourceRppId: 'RPP-0778',
      source: 'local-support-replayed-chunk-transfer-resume-cases',
      releaseVerifierVariant: evidenceSource,
      timeoutVariant: 'timeout-budget-proof-release-verifier-v5',
      previousVariant: 'timeout-budget-proof-v4',
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
    replayResume: summarizeReplayResumeCases(generatedCases),
    rolloutSafety: {
      gateStatuses: Object.fromEntries(rolloutGates.map((gate) => [gate.id, gate.status])),
      summary: report.rolloutSafetyGates.summary,
    },
    determinism: {
      sameReplayProjection: deterministicCaseVector,
      firstReplayProjectionHash: digest({
        caseHashes,
        timeoutReceiptCounts: generatedCases.map((replayCase) => replayCase.receiptsBeforeTimeout),
        resumeReplayChunkCounts: generatedCases.map((replayCase) => replayCase.chunksReplayedOnResume),
      }),
      secondReplayProjectionHash: digest({
        caseHashes: repeatedCaseHashes,
        timeoutReceiptCounts: repeatedCases.map((replayCase) => replayCase.receiptsBeforeTimeout),
        resumeReplayChunkCounts: repeatedCases.map((replayCase) => replayCase.chunksReplayedOnResume),
      }),
      ignoredVolatileFields: [
        'runtime.durationMs',
        'resources.process',
      ],
    },
    release: supportOnlyReleasePosture(report, productionBlockers),
  };
}

function summarizeReplayResumeCases(cases) {
  return {
    caseCount: cases.length,
    allCasesPassed: cases.every((replayCase) => replayCase.status === 'passed'),
    totalChunksReplayedOnResume: cases.reduce(
      (sum, replayCase) => sum + replayCase.chunksReplayedOnResume,
      0,
    ),
    totalChunksSkippedByReceipt: cases.reduce(
      (sum, replayCase) => sum + replayCase.chunksSkippedByReceipt,
      0,
    ),
    totalChunksUploadedAfterResume: cases.reduce(
      (sum, replayCase) => sum + replayCase.chunksUploadedAfterResume,
      0,
    ),
    totalDuplicateChunkBytes: cases.reduce(
      (sum, replayCase) => sum + replayCase.duplicateChunkBytes,
      0,
    ),
    totalDuplicateMutationWork: cases.reduce(
      (sum, replayCase) => sum + replayCase.duplicateMutationWork,
      0,
    ),
    totalResumeBookkeepingRecordCount: cases.reduce(
      (sum, replayCase) => sum + replayCase.resumeBookkeepingRecordCount,
      0,
    ),
    totalResumeMutationRecordCount: cases.reduce(
      (sum, replayCase) => sum + replayCase.resumeMutationRecordCount,
      0,
    ),
    maxMutationWorkBeforeTimeout: Math.max(
      ...cases.map((replayCase) => replayCase.mutationWorkBeforeTimeout),
    ),
    maxMutationWorkBeforeTransferFinalize: Math.max(
      ...cases.map((replayCase) => replayCase.mutationWorkReplayedBeforeTransferFinalize),
    ),
    maxFreshMutationWorkDuringTransferResume: Math.max(
      ...cases.map((replayCase) => replayCase.freshMutationWorkDuringTransferResume),
    ),
    cases,
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
        timeoutBudgetHash: sha256({
          builtOn: evidence.builtOn,
          transfer: evidence.transfer,
          replayCoverage: evidence.replayCoverage,
        }),
        replayResumeHash: sha256({
          caseCount: evidence.replayResume.caseCount,
          totalChunksReplayedOnResume: evidence.replayResume.totalChunksReplayedOnResume,
          totalChunksSkippedByReceipt: evidence.replayResume.totalChunksSkippedByReceipt,
          totalChunksUploadedAfterResume: evidence.replayResume.totalChunksUploadedAfterResume,
          totalDuplicateChunkBytes: evidence.replayResume.totalDuplicateChunkBytes,
          totalDuplicateMutationWork: evidence.replayResume.totalDuplicateMutationWork,
          totalResumeMutationRecordCount: evidence.replayResume.totalResumeMutationRecordCount,
        }),
        rolloutGateHash: sha256(evidence.rolloutSafety.gateStatuses),
        totalChunksSkippedByReceipt: evidence.replayResume.totalChunksSkippedByReceipt,
        totalChunksUploadedAfterResume: evidence.replayResume.totalChunksUploadedAfterResume,
        duplicateMutationWork: evidence.transfer.timeoutDuplicateMutationWork
          + evidence.replayResume.totalDuplicateMutationWork,
        resumeMutationRecordCount: evidence.replayResume.totalResumeMutationRecordCount,
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
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const storage = resources.storage || {};
  const processResources = resources.process || {};
  const journals = resources.journals || {};
  const transfer = evidence.transfer || {};
  const replayCoverage = evidence.replayCoverage || {};
  const replayResume = evidence.replayResume || {};
  const cases = Array.isArray(replayResume.cases) ? replayResume.cases : [];
  const rolloutSafety = evidence.rolloutSafety || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const previousVariant = evidence.builtOn?.previousVariant || {};
  const sourceTimeoutProof = evidence.builtOn?.sourceTimeoutProof || {};
  const caseStatuses = Array.isArray(replayCoverage.caseStatuses)
    ? replayCoverage.caseStatuses
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
    && releaseVerifier.failGateIds.length === 0
    && releaseVerifier.productionGateEvidence === 'not-present'
    && releaseVerifier.carryThrough === 'support-only-local-release-verifier';
  const runtimeWithinBudget = runtime.profile === 'unit'
    && runtime.budgetStatus === 'passed'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && storage.receiptBackend === 'lab-file-journal-receipts'
    && storage.localStorageProof === 'support-only-lab-file-journal'
    && storage.productionBacked === false
    && storage.finalStagingRecordPresent === true
    && journals.allJournalsIntegrityOk === true
    && journals.durableJournalsContainNoRawValues === true;
  const builtOnV4 = evidence.builtOn?.rppId === 'RPP-0778'
    && evidence.builtOn?.proofId === 'rpp-0778-timeout-budget-proof-v4'
    && evidence.builtOn?.variant === 4
    && evidence.builtOn?.status === 'passed'
    && previousVariant.rppId === 'RPP-0758'
    && previousVariant.proofId === 'rpp-0758-timeout-budget-proof-v3'
    && previousVariant.variant === 3
    && previousVariant.status === 'passed'
    && previousVariant.builtOn?.rppId === 'RPP-0738'
    && previousVariant.builtOn?.proofId === 'rpp-0738-timeout-budget-proof-v2'
    && previousVariant.builtOn?.variant === 2
    && previousVariant.builtOn?.status === 'passed'
    && sourceTimeoutProof.rppId === 'RPP-0718'
    && sourceTimeoutProof.proofId === 'rpp-0718-timeout-budget-proof'
    && sourceTimeoutProof.variant === 1
    && sourceTimeoutProof.status === 'passed'
    && isSha256Hash(sourceTimeoutProof.evidenceHash);
  const replayCasesCarried = replayCoverage.sourceRppId === 'RPP-0778'
    && replayCoverage.source === 'local-support-replayed-chunk-transfer-resume-cases'
    && replayCoverage.releaseVerifierVariant === evidenceSource
    && replayCoverage.timeoutVariant === 'timeout-budget-proof-release-verifier-v5'
    && replayCoverage.previousVariant === 'timeout-budget-proof-v4'
    && replayCoverage.caseCount >= 4
    && replayCoverage.caseCount === cases.length
    && replayCoverage.deterministicCaseVector === true
    && sameArray(replayCoverage.caseHashes || [], replayCoverage.repeatedCaseHashes || [])
    && sameArray(replayCoverage.timeoutReceiptCounts || [], [1, 2, 3, 4])
    && sameArray(replayCoverage.resumeReplayChunkCounts || [], [4, 5, 6, 7])
    && sameArray(replayCoverage.unreceiptedChunkCounts || [], [3, 3, 3, 3])
    && caseStatuses.length === replayCoverage.caseCount
    && caseStatuses.every((status) => status === 'passed');
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
    && Array.isArray(replayCase.resumeDecisionHashes)
    && replayCase.resumeDecisionHashes.length === replayCase.chunkCount
    && replayCase.resumeDecisionHashes.every((hash) => /^sha256:[a-f0-9]{64}$/.test(hash))
  ));
  const noDuplicateMutationWork = transfer.timeoutDuplicateMutationWork === 0
    && replayResume.totalDuplicateMutationWork === 0
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
  const resumeJournalHasNoMutationWork = replayResume.totalResumeMutationRecordCount === 0
    && cases.every((replayCase) => (
      replayCase.resumeBookkeepingRecordCount === replayCase.chunkCount
      && replayCase.resumeMutationRecordCount === 0
      && replayCase.freshMutationWorkDuringTransferResume === 0
    ));
  const applyOpensAfterTransferFinalize = cases.every((replayCase) => (
    replayCase.applyOpenedAfterTransferFinalize === true
    && replayCase.transferFinalizeSequence < replayCase.firstApplyBoundarySequence
    && replayCase.mutationWorkAllowedDuringTransferResume === false
  ));
  const rolloutGateVectorCarried = Object.entries(expectedRolloutGateStatuses)
    .every(([id, status]) => rolloutSafety.gateStatuses?.[id] === status)
    && rolloutSafety.summary?.passed === 9
    && rolloutSafety.summary?.blocked === 3
    && rolloutSafety.summary?.failed === 0
    && rolloutSafety.summary?.speedClaimsAllowed === false;

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
    proofGate('built-on-timeout-budget-proof-v4', builtOnV4, {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      previousVariantStatus: previousVariant.status,
      sourceTimeoutProofStatus: sourceTimeoutProof.status,
    }),
    proofGate('deterministic-replay-resume-cases-carried-through', replayCasesCarried, {
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
    proofGate('receipt-only-replay-resume-without-duplicate-mutation-work',
      preTimeoutReceiptsSkipReplayedChunks && resumeUploadsOnlyUnreceiptedChunks
        && noDuplicateMutationWork, {
      totalChunksReplayedOnResume: replayResume.totalChunksReplayedOnResume,
      totalChunksSkippedByReceipt: replayResume.totalChunksSkippedByReceipt,
      totalChunksUploadedAfterResume: replayResume.totalChunksUploadedAfterResume,
      totalDuplicateChunkBytes: replayResume.totalDuplicateChunkBytes,
      totalDuplicateMutationWork: replayResume.totalDuplicateMutationWork,
      timeoutDuplicateMutationWork: transfer.timeoutDuplicateMutationWork,
    }),
    proofGate('resume-journal-records-contain-no-mutation-work', resumeJournalHasNoMutationWork, {
      totalResumeBookkeepingRecordCount: replayResume.totalResumeBookkeepingRecordCount,
      totalResumeMutationRecordCount: replayResume.totalResumeMutationRecordCount,
      resumeMutationRecordCounts: cases.map((replayCase) => replayCase.resumeMutationRecordCount),
    }),
    proofGate('apply-opens-after-transfer-finalize', applyOpensAfterTransferFinalize, {
      transferFinalizeSequences: cases.map((replayCase) => replayCase.transferFinalizeSequence),
      firstApplyBoundarySequences: cases.map((replayCase) => replayCase.firstApplyBoundarySequence),
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

  const staleReplayCoverage = withPassedStatus(clone(evidence));
  staleReplayCoverage.replayCoverage.repeatedCaseHashes = [
    ...staleReplayCoverage.replayCoverage.repeatedCaseHashes.slice(0, -1),
    digest({ stale: 'timeout-budget-release-verifier-v5' }),
  ];

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

  const resumeMutationWork = withPassedStatus(clone(evidence));
  replaceReplayCase(
    resumeMutationWork,
    2,
    buildGeneratedReplayResumeCase(generatedReplayResumeSpecs()[2], {
      resumeMutationWork: true,
    }),
  );

  const timeoutCompletesBeforeBudget = withPassedStatus(clone(evidence));
  timeoutCompletesBeforeBudget.replayResume.cases[2].nextChunkWouldExceedBudget = false;
  timeoutCompletesBeforeBudget.replayResume.cases[2].timeoutExpiredBeforeCompletion = false;

  const earlyApplyBoundary = withPassedStatus(clone(evidence));
  earlyApplyBoundary.replayResume.cases[2].firstApplyBoundarySequence =
    earlyApplyBoundary.replayResume.cases[2].transferFinalizeSequence - 1;
  earlyApplyBoundary.replayResume.cases[2].applyOpenedAfterTransferFinalize = false;

  const rolloutGateMissing = withPassedStatus(clone(evidence));
  delete rolloutGateMissing.rolloutSafety.gateStatuses['receipt-only-resume'];
  rolloutGateMissing.rolloutSafety.summary.passed -= 1;
  rolloutGateMissing.releaseVerifier.passGateIds =
    rolloutGateMissing.releaseVerifier.passGateIds.filter((id) => id !== 'receipt-only-resume');

  const rawValueLeak = withPassedStatus(clone(evidence));
  rawValueLeak.replayCoverage.leakedPath = 'wp-content/uploads/2026/05/catalog-export.bin';

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingRuntimeReport: resolveReleaseVerifierCarryThrough(missingRuntimeReport),
    staleReplayCoverage: resolveReleaseVerifierCarryThrough(staleReplayCoverage),
    missingReceipt: resolveReleaseVerifierCarryThrough(missingReceipt),
    duplicateChunkReplay: resolveReleaseVerifierCarryThrough(duplicateChunkReplay),
    duplicateMutationWork: resolveReleaseVerifierCarryThrough(duplicateMutationWork),
    resumeMutationWork: resolveReleaseVerifierCarryThrough(resumeMutationWork),
    timeoutCompletesBeforeBudget: resolveReleaseVerifierCarryThrough(timeoutCompletesBeforeBudget),
    earlyApplyBoundary: resolveReleaseVerifierCarryThrough(earlyApplyBoundary),
    rolloutGateMissing: resolveReleaseVerifierCarryThrough(rolloutGateMissing),
    rawValueLeak: resolveReleaseVerifierCarryThrough(rawValueLeak),
    overBudget: resolveReleaseVerifierCarryThrough(overBudget),
    prematurePassStatus: resolveReleaseVerifierCarryThrough(prematurePassStatus),
  };
}

function replaceReplayCase(evidence, caseIndex, replayCase) {
  evidence.replayResume.cases[caseIndex] = replayCase;
  evidence.replayResume = summarizeReplayResumeCases(evidence.replayResume.cases);
  evidence.replayCoverage.caseStatuses = evidence.replayResume.cases.map((currentCase) =>
    currentCase.status);
  evidence.replayCoverage.caseHashes = evidence.replayResume.cases.map((currentCase) =>
    currentCase.caseHash);
  evidence.replayCoverage.repeatedCaseHashes = [...evidence.replayCoverage.caseHashes];
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

function buildGeneratedReplayResumeCase(spec, options = {}) {
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
  const replayRecords = manifestEntries.map((entry, index) => ({
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
  const resumeRecords = options.resumeMutationWork
    ? [
        ...replayRecords,
        {
          type: 'mutation-applied',
          sequence: spec.chunkCount + replayRecords.length + 10,
        },
      ]
    : replayRecords;
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
    resumeReplayedWholeManifest: replayRecords.length === spec.chunkCount,
    chunksReplayedOnResume: manifestEntries.length,
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
    resumeDecisionHashes: replayRecords.map((record) => record.actionHash),
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
    transfer: {
      chunkReceipts: report.resources.transfer.chunkReceipts,
      chunkManifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
      finalizedHashHash: digest(report.resources.transfer.finalizedHash),
    },
    timeoutProofHash: digest(timeoutProofCore(report.evidence.timeoutBudgetProof)),
    rolloutSafetySummary: report.rolloutSafetyGates.summary,
    productionBlockers,
    claims: {
      labGuardedExecutorEvidence: report.claims.labGuardedExecutorEvidence,
      productionThroughputAllowed: report.claims.productionThroughput.allowed,
      productionThroughputStatus: report.claims.productionThroughput.status,
    },
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
    replayCoverage: evidence.replayCoverage,
    replayResume: evidence.replayResume,
    rolloutSafety: evidence.rolloutSafety,
    determinism: evidence.determinism,
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
