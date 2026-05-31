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

const proofId = 'rpp-0788-chunk-resume-after-interruption-release-verifier-v5';
const evidenceSource = 'chunk-resume-after-interruption-release-verifier-v5';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const chunkAttemptBudgetMs = 1_000;
const sha256Pattern = /^[a-f0-9]{64}$/;
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
  'built-on-chunk-resume-after-interruption-v4',
  'deterministic-interruption-resume-cases-carried-through',
  'receipt-only-resume-without-duplicate-mutation-work',
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

test('RPP-0788 release verifier v5 carries chunk resume after interruption without duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildReleaseVerifierProof();

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0788');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0768');
  assert.equal(proof.builtOn.proofId, 'rpp-0768-chunk-resume-after-interruption-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceTimeoutBudget.rppId, 'RPP-0738');
  assert.equal(proof.builtOn.sourceTimeoutBudget.proofId, 'rpp-0738-timeout-budget-proof-v2');
  assert.equal(proof.builtOn.sourceTimeoutBudget.variant, 2);
  assert.equal(proof.builtOn.sourceTimeoutBudget.status, 'passed');
  assert.equal(proof.builtOn.sourceTimeoutBudget.sourceTimeoutProof.rppId, 'RPP-0718');
  assert.equal(
    proof.builtOn.sourceTimeoutBudget.sourceTimeoutProof.proofId,
    'rpp-0718-timeout-budget-proof',
  );
  assert.equal(proof.builtOn.sourceTimeoutBudget.sourceTimeoutProof.variant, 1);
  assert.equal(proof.builtOn.sourceTimeoutBudget.sourceTimeoutProof.status, 'passed');
  assert.match(proof.builtOn.sourceTimeoutBudget.sourceTimeoutProof.evidenceHash, sha256Pattern);

  assert.equal(
    proof.releaseVerifier.command,
    'node --test --test-name-pattern RPP-0788 test/rpp-0788-chunk-resume-after-interruption-release-verifier-v5.test.js',
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
  assert.equal(proof.transfer.timeoutReceiptsBeforeInterruption, 2);
  assert.equal(proof.transfer.timeoutChunksUploadedAfterResume, 2);
  assert.equal(proof.transfer.timeoutDuplicateMutationWork, 0);
  assert.match(proof.transfer.planIdHash, sha256Pattern);
  assert.match(proof.transfer.resourceKeyHash, sha256Pattern);

  assert.equal(proof.generatedCoverage.sourceRppId, 'RPP-0768');
  assert.equal(proof.generatedCoverage.source, 'local-support-generated-interruption-cases');
  assert.equal(proof.generatedCoverage.releaseVerifierVariant, evidenceSource);
  assert.equal(proof.generatedCoverage.resumeVariant, 'chunk-resume-after-interruption-v5');
  assert.equal(proof.generatedCoverage.caseCount, 5);
  assert.equal(proof.generatedCoverage.deterministicCaseVector, true);
  assert.deepEqual(proof.generatedCoverage.interruptionPoints, [1, 1, 2, 3, 4]);
  assert.deepEqual(proof.generatedCoverage.uniqueInterruptionPoints, [1, 2, 3, 4]);
  assert.deepEqual(proof.generatedCoverage.chunkCounts, [2, 3, 4, 5, 6]);
  assert.deepEqual(proof.generatedCoverage.caseStatuses, [
    'passed',
    'passed',
    'passed',
    'passed',
    'passed',
  ]);
  assert.ok(proof.generatedCoverage.caseHashes.every((hash) => sha256Pattern.test(hash)));

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
    assert.equal(interruptionCase.noDuplicateMutationWork, true);
    assert.equal(interruptionCase.resumeBookkeepingRecordCount, 2);
    assert.equal(interruptionCase.resumeMutationRecordCount, 0);
    assert.equal(interruptionCase.mutationWorkBeforeInterruption, 0);
    assert.equal(interruptionCase.mutationWorkReplayedBeforeTransferFinalize, 0);
    assert.equal(interruptionCase.freshMutationWorkDuringTransferResume, 0);
    assert.equal(interruptionCase.applyOpenedAfterTransferFinalize, true);
    assert.equal(interruptionCase.mutationWorkAllowedDuringTransferResume, false);
    assert.ok(interruptionCase.transferFinalizeSequence < interruptionCase.firstApplyBoundarySequence);
    assert.deepEqual(interruptionCase.resumeCursorFields, expectedResumeCursorFields);
    assert.match(interruptionCase.caseHash, sha256Pattern);
    assert.match(interruptionCase.planIdHash, sha256Pattern);
    assert.match(interruptionCase.resourceKeyHash, sha256Pattern);
    assert.match(interruptionCase.proofHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(interruptionCase.receiptMatches.length, interruptionCase.chunkCount);
    assert.ok(interruptionCase.receiptMatches.every((match) => match.matched === true));
    assert.ok(interruptionCase.receiptMatches.some((match) => match.receiptedBeforeInterruption));
    assert.ok(interruptionCase.receiptMatches.some((match) => match.resumedAfterInterruption));
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
  assert.match(proof.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(proof.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass']);

  assert.equal(proof.unsafe.missingRuntimeReport.updated, false);
  assert.ok(proof.unsafe.missingRuntimeReport.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(proof.unsafe.missingReceipt.updated, false);
  assert.ok(proof.unsafe.missingReceipt.blockedBy
    .includes('receipt-only-resume-without-duplicate-mutation-work'));
  assert.equal(proof.unsafe.duplicateMutationWork.updated, false);
  assert.ok(proof.unsafe.duplicateMutationWork.blockedBy
    .includes('receipt-only-resume-without-duplicate-mutation-work'));
  assert.equal(proof.unsafe.resumeMutationWork.updated, false);
  assert.ok(proof.unsafe.resumeMutationWork.blockedBy
    .includes('resume-journal-records-contain-no-mutation-work'));
  assert.equal(proof.unsafe.earlyApplyBoundary.updated, false);
  assert.ok(proof.unsafe.earlyApplyBoundary.blockedBy.includes('apply-opens-after-transfer-finalize'));
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
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0788 chunk resume release verifier proof' }));
});

test('RPP-0788 release verifier v5 fails closed for stale chunk resume carry-through evidence', () => {
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
  assert.equal(unsafeDecisions.missingReceipt.updated, false);
  assert.ok(unsafeDecisions.missingReceipt.blockedBy
    .includes('receipt-only-resume-without-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.duplicateMutationWork.updated, false);
  assert.ok(unsafeDecisions.duplicateMutationWork.blockedBy
    .includes('receipt-only-resume-without-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.resumeMutationWork.updated, false);
  assert.ok(unsafeDecisions.resumeMutationWork.blockedBy
    .includes('resume-journal-records-contain-no-mutation-work'));
  assert.equal(unsafeDecisions.earlyApplyBoundary.updated, false);
  assert.ok(unsafeDecisions.earlyApplyBoundary.blockedBy.includes('apply-opens-after-transfer-finalize'));
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
    'interruption',
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
    rppId: 'RPP-0788',
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
    generatedCoverage: evidence.generatedCoverage,
    interruption: evidence.interruption,
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
      mode: 'hash-count-only-chunk-resume-release-verifier-v5',
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
  const generatedCases = generatedInterruptionCases();
  const repeatedCases = generatedInterruptionCases();
  const evidence = buildReleaseVerifierEvidence({
    report,
    generatedCases,
    repeatedCases,
  });
  recordCorrectnessGates(evidence);
  return { report, evidence };
}

function runUnitBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0788-interruption-v5-'));
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
  const caseHashes = generatedCases.map((interruptionCase) => interruptionCase.caseHash);
  const repeatedCaseHashes = repeatedCases.map((interruptionCase) => interruptionCase.caseHash);
  const deterministicCaseVector = sameArray(caseHashes, repeatedCaseHashes);
  const generatedCasesPassed = generatedCases.every((interruptionCase) =>
    interruptionCase.status === 'passed');

  return {
    schemaVersion: 1,
    rppId: 'RPP-0788',
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0768',
      proofId: 'rpp-0768-chunk-resume-after-interruption-v4',
      variant: 4,
      status: generatedCasesPassed && timeoutProof.status === 'passed' ? 'passed' : 'blocked',
      sourceTimeoutBudget: {
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
    },
    releaseVerifier: {
      command:
        'node --test --test-name-pattern RPP-0788 test/rpp-0788-chunk-resume-after-interruption-release-verifier-v5.test.js',
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
      timeoutReceiptsBeforeInterruption: timeoutProof.partialTransfer.receiptsBeforeTimeout,
      timeoutChunksUploadedAfterResume: timeoutProof.resume.chunksUploadedAfterResume,
      timeoutDuplicateChunkBytes: timeoutProof.resume.duplicateChunkBytes,
      timeoutDuplicateMutationWork:
        timeoutProof.resume.duplicateMutationWork + timeoutProof.apply.duplicateMutationWork,
    },
    generatedCoverage: {
      sourceRppId: 'RPP-0768',
      source: 'local-support-generated-interruption-cases',
      releaseVerifierVariant: evidenceSource,
      resumeVariant: 'chunk-resume-after-interruption-v5',
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
    interruption: summarizeInterruptionCases(generatedCases),
    rolloutSafety: {
      gateStatuses: Object.fromEntries(rolloutGates.map((gate) => [gate.id, gate.status])),
      summary: report.rolloutSafetyGates.summary,
    },
    release: supportOnlyReleasePosture(report, productionBlockers),
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
        chunkResumeHash: sha256({
          transfer: evidence.transfer,
          generatedCoverage: evidence.generatedCoverage,
          interruptionTotals: {
            caseCount: evidence.interruption.caseCount,
            totalChunksSkippedByReceipt: evidence.interruption.totalChunksSkippedByReceipt,
            totalChunksUploadedAfterResume: evidence.interruption.totalChunksUploadedAfterResume,
            totalDuplicateChunkBytes: evidence.interruption.totalDuplicateChunkBytes,
            totalDuplicateMutationWork: evidence.interruption.totalDuplicateMutationWork,
            totalResumeMutationRecordCount: evidence.interruption.totalResumeMutationRecordCount,
          },
        }),
        rolloutGateHash: sha256(evidence.rolloutSafety.gateStatuses),
        totalChunksSkippedByReceipt: evidence.interruption.totalChunksSkippedByReceipt,
        totalChunksUploadedAfterResume: evidence.interruption.totalChunksUploadedAfterResume,
        duplicateMutationWork: evidence.transfer.timeoutDuplicateMutationWork
          + evidence.interruption.totalDuplicateMutationWork,
        resumeMutationRecordCount: evidence.interruption.totalResumeMutationRecordCount,
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
  const generatedCoverage = evidence.generatedCoverage || {};
  const interruption = evidence.interruption || {};
  const cases = Array.isArray(interruption.cases) ? interruption.cases : [];
  const rolloutSafety = evidence.rolloutSafety || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const sourceTimeoutBudget = evidence.builtOn?.sourceTimeoutBudget || {};
  const sourceTimeoutProof = sourceTimeoutBudget.sourceTimeoutProof || {};
  const generatedCaseStatuses = Array.isArray(generatedCoverage.caseStatuses)
    ? generatedCoverage.caseStatuses
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
    && releaseVerifier.productionGateEvidence === 'not-present';
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
  const builtOnV4 = evidence.builtOn?.rppId === 'RPP-0768'
    && evidence.builtOn?.proofId === 'rpp-0768-chunk-resume-after-interruption-v4'
    && evidence.builtOn?.variant === 4
    && evidence.builtOn?.status === 'passed'
    && sourceTimeoutBudget.rppId === 'RPP-0738'
    && sourceTimeoutBudget.proofId === 'rpp-0738-timeout-budget-proof-v2'
    && sourceTimeoutBudget.variant === 2
    && sourceTimeoutBudget.status === 'passed'
    && sourceTimeoutProof.rppId === 'RPP-0718'
    && sourceTimeoutProof.proofId === 'rpp-0718-timeout-budget-proof'
    && sourceTimeoutProof.variant === 1
    && sourceTimeoutProof.status === 'passed'
    && isSha256Hash(sourceTimeoutProof.evidenceHash);
  const generatedCasesCarried = generatedCoverage.sourceRppId === 'RPP-0768'
    && generatedCoverage.source === 'local-support-generated-interruption-cases'
    && generatedCoverage.releaseVerifierVariant === evidenceSource
    && generatedCoverage.resumeVariant === 'chunk-resume-after-interruption-v5'
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
  const noDuplicateMutationWork = transfer.timeoutDuplicateMutationWork === 0
    && interruption.totalDuplicateMutationWork === 0
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
    proofGate('built-on-chunk-resume-after-interruption-v4', builtOnV4, {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      sourceTimeoutBudgetStatus: sourceTimeoutBudget.status,
      sourceTimeoutProofStatus: sourceTimeoutProof.status,
    }),
    proofGate('deterministic-interruption-resume-cases-carried-through',
      generatedCasesCarried, {
      caseCount: generatedCoverage.caseCount,
      interruptionPoints: generatedCoverage.interruptionPoints,
      uniqueInterruptionPoints: generatedCoverage.uniqueInterruptionPoints,
      chunkCounts: generatedCoverage.chunkCounts,
      deterministicCaseVector: generatedCoverage.deterministicCaseVector,
    }),
    proofGate('receipt-only-resume-without-duplicate-mutation-work',
      durableReceiptCoverage && resumeSafe && noDuplicateMutationWork, {
      totalChunksSkippedByReceipt: interruption.totalChunksSkippedByReceipt,
      totalChunksUploadedAfterResume: interruption.totalChunksUploadedAfterResume,
      totalDuplicateChunkBytes: interruption.totalDuplicateChunkBytes,
      totalDuplicateMutationWork: interruption.totalDuplicateMutationWork,
      timeoutDuplicateMutationWork: transfer.timeoutDuplicateMutationWork,
    }),
    proofGate('resume-journal-records-contain-no-mutation-work', resumeJournalHasNoMutationWork, {
      totalResumeBookkeepingRecordCount: interruption.totalResumeBookkeepingRecordCount,
      totalResumeMutationRecordCount: interruption.totalResumeMutationRecordCount,
      resumeMutationRecordCounts: cases.map((interruptionCase) =>
        interruptionCase.resumeMutationRecordCount),
    }),
    proofGate('apply-opens-after-transfer-finalize', applyOpensAfterTransferFinalize, {
      transferFinalizeSequences: cases.map((interruptionCase) =>
        interruptionCase.transferFinalizeSequence),
      firstApplyBoundarySequences: cases.map((interruptionCase) =>
        interruptionCase.firstApplyBoundarySequence),
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
    missingRuntimeReport: resolveReleaseVerifierCarryThrough(missingRuntimeReport),
    missingReceipt: resolveReleaseVerifierCarryThrough(missingReceipt),
    duplicateMutationWork: resolveReleaseVerifierCarryThrough(duplicateMutationWork),
    resumeMutationWork: resolveReleaseVerifierCarryThrough(resumeMutationWork),
    earlyApplyBoundary: resolveReleaseVerifierCarryThrough(earlyApplyBoundary),
    overBudget: resolveReleaseVerifierCarryThrough(overBudget),
    prematurePassStatus: resolveReleaseVerifierCarryThrough(prematurePassStatus),
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
    generatedCoverage: evidence.generatedCoverage,
    interruption: evidence.interruption,
    rolloutSafety: evidence.rolloutSafety,
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
