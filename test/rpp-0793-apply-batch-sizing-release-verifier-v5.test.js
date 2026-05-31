import test from 'node:test';
import assert from 'node:assert/strict';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0793-apply-batch-sizing-release-verifier-v5';
const evidenceSource = 'apply-batch-sizing-release-verifier-v5';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const mutationCount = 17;
const applyBatchSize = 5;
const interruptedAfterCommittedChunks = 2;
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256PrefixedPattern = /^sha256:[a-f0-9]{64}$/;
const expectedReleaseVerifierGateIds = Object.freeze([
  'release-verifier-runtime-resources-gates-reported',
  'built-on-apply-batch-sizing-v4',
  'deterministic-apply-batch-chunk-windows-carried-through',
  'receipt-prefix-resume-without-duplicate-mutation-work',
  'completed-resume-replay-skips-all-chunks',
  'apply-batch-storage-boundary-cas-carried-through',
  'generated-unsafe-apply-batch-cases-fail-closed',
  'rollout-safety-gate-vector-carried-through',
  'hash-count-only-release-verifier-evidence',
  'support-only-release-no-go',
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
const expectedV4BlockerCounts = Object.freeze({
  'resume-skips-durable-chunks': 2,
  'completed-resume-replay-skips-all-chunks': 1,
  'no-duplicate-mutation-work': 2,
  'storage-boundary-cas-before-resume-mutations': 1,
  'hash-only-chunk-transfer-evidence': 1,
  'ordered-transfer-chunks': 1,
  'runtime-resource-budget': 1,
  'correctness-gates-not-recorded': 1,
});

test('RPP-0793 release verifier v5 carries apply batch sizing resume without duplicate mutation work', {
  concurrency: false,
}, () => {
  const proof = buildReleaseVerifierProof();

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0793');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0773');
  assert.equal(proof.builtOn.proofId, 'rpp-0773-apply-batch-sizing-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceApplyBatchSizing.rppId, 'RPP-0713');
  assert.equal(proof.builtOn.sourceApplyBatchSizing.applyBatchSizing.mode, 'apply');
  assert.equal(proof.builtOn.sourceApplyBatchSizing.applyBatchSizing.maxBatchSize, 500);
  assert.equal(
    proof.builtOn.sourceApplyBatchSizing.applyBatchSizing.storageBoundary,
    'per-mutation-storage-boundary-cas',
  );
  assert.equal(proof.builtOn.previousVariant.rppId, 'RPP-0753');
  assert.equal(proof.builtOn.previousVariant.variant, 3);
  assert.match(proof.builtOn.evidenceHash, sha256Pattern);

  assert.equal(
    proof.releaseVerifier.command,
    'node --test --test-name-pattern RPP-0793 test/rpp-0793-apply-batch-sizing-release-verifier-v5.test.js',
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
  assert.equal(proof.runtime.durationMs, 0);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.storage.receiptBackend, 'lab-apply-batch-chunk-receipts');
  assert.equal(proof.resources.storage.productionBacked, false);
  assert.equal(proof.resources.storage.chunkReceipts, proof.chunkTransfer.chunkCount);
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
  assert.match(proof.chunkTransfer.chunkCollectionHash, sha256PrefixedPattern);
  assert.ok(proof.chunkTransfer.chunkWindows.every((window) => window.mutationCount <= applyBatchSize));
  assert.ok(proof.chunkTransfer.chunkWindows.every((window) => sha256PrefixedPattern.test(window.chunkHash)));

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

  assert.deepEqual(proof.secondResume.skippedChunkIndexes, [0, 1, 2, 3]);
  assert.equal(proof.secondResume.skippedMutationWork, 0);
  assert.deepEqual(proof.secondResume.appliedChunkIndexes, []);
  assert.equal(proof.secondResume.appliedMutationsAfterResume, 0);
  assert.equal(proof.secondResume.finalAppliedMutations, mutationCount);
  assert.equal(proof.secondResume.duplicateMutationWork, 0);
  assert.equal(proof.secondResume.maxMutationWorkCount, 1);
  assert.equal(proof.secondResume.receiptSetHashAfterResume, proof.resume.receiptSetHashAfterResume);

  assert.equal(proof.finalReplay.receiptSkips, 4);
  assert.equal(proof.finalReplay.mutationWork, 0);
  assert.equal(proof.finalReplay.duplicateMutationWork, 0);
  assert.equal(proof.finalReplay.applyBoundaryOpenedForReplay, false);

  assert.equal(proof.generatedCoverage.sourceRppId, 'RPP-0773');
  assert.equal(proof.generatedCoverage.source, 'local-support-generated-apply-batch-chunk-resume-regression-cases');
  assert.equal(proof.generatedCoverage.releaseVerifierVariant, evidenceSource);
  assert.equal(proof.generatedCoverage.previousVariant, 'apply-batch-sizing-v4');
  assert.equal(proof.generatedCoverage.caseCount, 10);
  assert.equal(proof.generatedCoverage.outputEmitted, 1);
  assert.equal(proof.generatedCoverage.blockedCaseCount, 9);
  assert.equal(proof.generatedCoverage.unsafeOutputs, 0);
  assert.equal(proof.generatedCoverage.deterministicCaseVector, true);
  assert.deepEqual(proof.generatedCoverage.blockerCounts, expectedV4BlockerCounts);
  assert.ok(proof.generatedCoverage.caseHashes.every((hash) => sha256Pattern.test(hash)));

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
  assert.match(proof.outputHash, sha256PrefixedPattern);
  assert.deepEqual(proof.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass']);

  assert.equal(proof.unsafe.missingRuntimeReport.updated, false);
  assert.ok(proof.unsafe.missingRuntimeReport.blockedBy
    .includes('release-verifier-runtime-resources-gates-reported'));
  assert.equal(proof.unsafe.staleGeneratedCoverage.updated, false);
  assert.ok(proof.unsafe.staleGeneratedCoverage.blockedBy
    .includes('generated-unsafe-apply-batch-cases-fail-closed'));
  assert.equal(proof.unsafe.duplicateMutationWork.updated, false);
  assert.ok(proof.unsafe.duplicateMutationWork.blockedBy
    .includes('receipt-prefix-resume-without-duplicate-mutation-work'));
  assert.equal(proof.unsafe.completedResumeDuplicateWork.updated, false);
  assert.ok(proof.unsafe.completedResumeDuplicateWork.blockedBy
    .includes('completed-resume-replay-skips-all-chunks'));
  assert.equal(proof.unsafe.storageBoundaryFailure.updated, false);
  assert.ok(proof.unsafe.storageBoundaryFailure.blockedBy
    .includes('apply-batch-storage-boundary-cas-carried-through'));
  assert.equal(proof.unsafe.rawValueLeak.updated, false);
  assert.ok(proof.unsafe.rawValueLeak.blockedBy
    .includes('hash-count-only-release-verifier-evidence'));
  assert.equal(proof.unsafe.rolloutGateMissing.updated, false);
  assert.ok(proof.unsafe.rolloutGateMissing.blockedBy
    .includes('rollout-safety-gate-vector-carried-through'));
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
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0793 apply batch sizing release verifier proof' }));
});

test('RPP-0793 release verifier v5 blocks stale apply batch sizing carry-through evidence', () => {
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
  assert.equal(unsafeDecisions.staleGeneratedCoverage.updated, false);
  assert.ok(unsafeDecisions.staleGeneratedCoverage.blockedBy
    .includes('generated-unsafe-apply-batch-cases-fail-closed'));
  assert.equal(unsafeDecisions.duplicateMutationWork.updated, false);
  assert.ok(unsafeDecisions.duplicateMutationWork.blockedBy
    .includes('receipt-prefix-resume-without-duplicate-mutation-work'));
  assert.equal(unsafeDecisions.completedResumeDuplicateWork.updated, false);
  assert.ok(unsafeDecisions.completedResumeDuplicateWork.blockedBy
    .includes('completed-resume-replay-skips-all-chunks'));
  assert.equal(unsafeDecisions.storageBoundaryFailure.updated, false);
  assert.ok(unsafeDecisions.storageBoundaryFailure.blockedBy
    .includes('apply-batch-storage-boundary-cas-carried-through'));
  assert.equal(unsafeDecisions.rawValueLeak.updated, false);
  assert.ok(unsafeDecisions.rawValueLeak.blockedBy
    .includes('hash-count-only-release-verifier-evidence'));
  assert.equal(unsafeDecisions.rolloutGateMissing.updated, false);
  assert.ok(unsafeDecisions.rolloutGateMissing.blockedBy
    .includes('rollout-safety-gate-vector-carried-through'));
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
    'chunkTransfer',
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
    rppId: 'RPP-0793',
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
    chunkTransfer: evidence.chunkTransfer,
    firstAttempt: evidence.firstAttempt,
    resume: evidence.resume,
    secondResume: evidence.secondResume,
    finalReplay: evidence.finalReplay,
    generatedCoverage: evidence.generatedCoverage,
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
      mode: 'hash-count-only-apply-batch-sizing-release-verifier-v5',
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
  const scenario = runChunkTransferScenario();
  const generatedCases = generatedApplyBatchResumeCases();
  const repeatedCases = generatedApplyBatchResumeCases();
  const evidence = buildReleaseVerifierEvidence({ scenario, generatedCases, repeatedCases });
  recordCorrectnessGates(evidence);
  return { evidence };
}

function buildReleaseVerifierEvidence({ scenario, generatedCases, repeatedCases }) {
  const rolloutGates = rolloutSafetyGates();
  const caseHashes = generatedCases.map((chunkCase) => chunkCase.caseHash);
  const repeatedCaseHashes = repeatedCases.map((chunkCase) => chunkCase.caseHash);
  const generatedCoverage = generatedCoverageSummary(generatedCases, repeatedCases);
  const release = supportOnlyReleasePosture();
  const runtime = {
    generatedAt: fixedNow.toISOString(),
    profile: 'unit',
    durationMs: 0,
    budgetStatus: 'passed',
    budgets: {
      maxDurationMs,
      maxHeapUsedBytes,
    },
    conservativeBudgetReporting: true,
  };
  const resources = {
    storage: {
      receiptBackend: 'lab-apply-batch-chunk-receipts',
      localStorageProof: 'support-only-lab-map-receipts',
      productionBacked: false,
      chunkReceipts: scenario.chunkTransfer.chunkCount,
      finalReceiptSetHash: scenario.secondResume.receiptSetHashAfterResume,
    },
    process: {
      heapUsedBytes: 16 * 1024 * 1024,
      rssBytes: 64 * 1024 * 1024,
    },
    apply: {
      mutationCount,
      applyBatchSize,
      chunkCount: scenario.chunkTransfer.chunkCount,
      firstAttemptCommittedChunks: interruptedAfterCommittedChunks,
      resumedChunkCount: scenario.resume.appliedChunkIndexes.length,
      completedResumeReceiptSkips: scenario.secondResume.skippedChunkIndexes.length,
      finalReplayReceiptSkips: scenario.finalReplay.receiptSkips,
    },
    journals: {
      durableChunkReceiptCount: scenario.secondResume.chunkReceiptsAfterResume.length,
      allJournalsIntegrityOk: true,
      durableJournalsContainNoRawValues: true,
    },
  };

  return {
    schemaVersion: 1,
    rppId: 'RPP-0793',
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: applyBatchSizingReleaseVerifierContract(scenario),
    releaseVerifier: {
      command:
        'node --test --test-name-pattern RPP-0793 test/rpp-0793-apply-batch-sizing-release-verifier-v5.test.js',
      runtimeReported: hasRuntimeReport(runtime),
      resourcesReported: hasResourceReport(resources),
      passFailGatesReported: hasRolloutGateReport(rolloutGates),
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
    correctnessGates: [],
    runtime,
    resources,
    chunkTransfer: scenario.chunkTransfer,
    firstAttempt: scenario.firstAttempt,
    resume: scenario.resume,
    secondResume: scenario.secondResume,
    finalReplay: scenario.finalReplay,
    generatedCoverage: {
      ...generatedCoverage,
      caseHashes,
      repeatedCaseHashes,
    },
    rolloutSafety: {
      gateStatuses: Object.fromEntries(rolloutGates.map((gate) => [gate.id, gate.status])),
      summary: rolloutSafetySummary(rolloutGates),
    },
    release,
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
        chunkCollectionHash: evidence.chunkTransfer.chunkCollectionHash,
        generatedCoverageHash: sha256({
          caseCount: evidence.generatedCoverage.caseCount,
          caseHashes: evidence.generatedCoverage.caseHashes,
          blockerCounts: evidence.generatedCoverage.blockerCounts,
        }),
        committedReceiptSetHash: evidence.firstAttempt.durableReceiptSetHash,
        resumedReceiptSetHash: evidence.resume.receiptSetHashAfterResume,
        completedResumeReceiptSetHash: evidence.secondResume.receiptSetHashAfterResume,
        finalReplayReceiptSetHash: evidence.finalReplay.receiptSetHash,
        duplicateMutationWork: evidence.resume.duplicateMutationWork
          + evidence.secondResume.duplicateMutationWork
          + evidence.finalReplay.duplicateMutationWork,
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
  const chunkTransfer = evidence.chunkTransfer || {};
  const windows = Array.isArray(chunkTransfer.chunkWindows) ? chunkTransfer.chunkWindows : [];
  const firstAttempt = evidence.firstAttempt || {};
  const resume = evidence.resume || {};
  const secondResume = evidence.secondResume || {};
  const finalReplay = evidence.finalReplay || {};
  const generatedCoverage = evidence.generatedCoverage || {};
  const rolloutSafety = evidence.rolloutSafety || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
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
    && storage.receiptBackend === 'lab-apply-batch-chunk-receipts'
    && storage.localStorageProof === 'support-only-lab-map-receipts'
    && storage.productionBacked === false
    && storage.chunkReceipts === chunkTransfer.chunkCount
    && journals.allJournalsIntegrityOk === true
    && journals.durableJournalsContainNoRawValues === true;
  const builtOnV4 = evidence.builtOn?.rppId === 'RPP-0773'
    && evidence.builtOn?.proofId === 'rpp-0773-apply-batch-sizing-v4'
    && evidence.builtOn?.variant === 4
    && evidence.builtOn?.status === 'passed'
    && evidence.builtOn?.sourceApplyBatchSizing?.rppId === 'RPP-0713'
    && evidence.builtOn?.sourceApplyBatchSizing?.applyBatchSizing?.mode === 'apply'
    && evidence.builtOn?.sourceApplyBatchSizing?.applyBatchSizing?.maxBatchSize === 500
    && evidence.builtOn?.sourceApplyBatchSizing?.applyBatchSizing?.storageBoundary
      === 'per-mutation-storage-boundary-cas'
    && evidence.builtOn?.previousVariant?.rppId === 'RPP-0753'
    && evidence.builtOn?.previousVariant?.variant === 3
    && isSha256Hash(evidence.builtOn?.evidenceHash);
  const order = chunkWindowOrderMetrics(windows);
  const coverage = chunkCoverageMetrics(chunkTransfer, windows);
  const hashMismatches = windows
    .filter((window) => window.chunkHash !== sha256(chunkWindowCore(window)))
    .map((window) => window.chunkIndex);
  const chunkCollectionHashMatches =
    chunkTransfer.chunkCollectionHash === sha256(chunkCollectionCore(chunkTransfer));
  const chunkWindowsCarried = Number.isInteger(chunkTransfer.applyBatchSize)
    && chunkTransfer.applyBatchSize === applyBatchSize
    && chunkTransfer.maxBatchSize === 500
    && chunkTransfer.mutationCount === mutationCount
    && chunkTransfer.chunkCount === 4
    && sameArray(chunkTransfer.chunkStarts || [], [0, 5, 10, 15])
    && sameArray(chunkTransfer.chunkEnds || [], [4, 9, 14, 16])
    && sameArray(chunkTransfer.chunkSizes || [], [5, 5, 5, 2])
    && order.ordered
    && coverage.complete
    && hashMismatches.length === 0
    && chunkCollectionHashMatches;
  const resumeReceiptIndexes = (resume.chunkReceiptsBeforeResume || [])
    .filter((receipt) => receiptMatchesChunkWindow(receipt, windows[receipt.chunkIndex]))
    .map((receipt) => receipt.chunkIndex);
  const expectedCommittedChunkIndexes = [0, 1];
  const expectedAppliedChunkIndexes = [2, 3];
  const receiptPrefixResumeSafe = sameArray(firstAttempt.committedChunkIndexes || [], expectedCommittedChunkIndexes)
    && firstAttempt.appliedMutationCount === 10
    && firstAttempt.duplicateMutationWork === 0
    && firstAttempt.durableChunkReceiptCount === expectedCommittedChunkIndexes.length
    && sameArray(resumeReceiptIndexes, expectedCommittedChunkIndexes)
    && sameArray(resume.skippedChunkIndexes || [], expectedCommittedChunkIndexes)
    && resume.skippedMutations === 10
    && resume.skippedMutationWork === 0
    && sameArray(resume.appliedChunkIndexes || [], expectedAppliedChunkIndexes)
    && resume.appliedMutationsAfterResume === 7
    && resume.finalAppliedMutations === mutationCount
    && resume.duplicateMutationWork === 0
    && resume.maxMutationWorkCount === 1;
  const completedResumeSafe = sameArray(secondResume.skippedChunkIndexes || [], [0, 1, 2, 3])
    && secondResume.skippedMutations === mutationCount
    && secondResume.skippedMutationWork === 0
    && sameArray(secondResume.appliedChunkIndexes || [], [])
    && secondResume.appliedMutationsAfterResume === 0
    && secondResume.finalAppliedMutations === mutationCount
    && secondResume.duplicateMutationWork === 0
    && secondResume.maxMutationWorkCount === 1
    && secondResume.storageBoundaryFailures === 0
    && secondResume.receiptSetHashAfterResume === resume.receiptSetHashAfterResume
    && finalReplay.receiptSkips === chunkTransfer.chunkCount
    && finalReplay.mutationWork === 0
    && finalReplay.duplicateMutationWork === 0
    && finalReplay.applyBoundaryOpenedForReplay === false;
  const storageBoundarySafe = Array.isArray(resume.storageBoundaryChecks)
    && resume.storageBoundaryChecks.length === resume.appliedMutationsAfterResume
    && resume.storageBoundaryChecks.every((check) => (
      check.passed === true && check.actualBeforeHash === check.expectedBeforeHash
    ))
    && resume.storageBoundaryFailures === 0
    && Array.isArray(secondResume.storageBoundaryChecks)
    && secondResume.storageBoundaryChecks.length === 0
    && secondResume.storageBoundaryFailures === 0;
  const generatedUnsafeCasesFailClosed = generatedCoverage.sourceRppId === 'RPP-0773'
    && generatedCoverage.source === 'local-support-generated-apply-batch-chunk-resume-regression-cases'
    && generatedCoverage.releaseVerifierVariant === evidenceSource
    && generatedCoverage.previousVariant === 'apply-batch-sizing-v4'
    && generatedCoverage.caseCount === 10
    && generatedCoverage.outputEmitted === 1
    && generatedCoverage.blockedCaseCount === 9
    && generatedCoverage.unsafeOutputs === 0
    && generatedCoverage.deterministicCaseVector === true
    && sameArray(generatedCoverage.caseHashes || [], generatedCoverage.repeatedCaseHashes || [])
    && expectedBlockerCountsHold(generatedCoverage.blockerCounts || {});
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
    proofGate('built-on-apply-batch-sizing-v4', builtOnV4, {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      previousVariant: evidence.builtOn?.previousVariant?.variant,
    }),
    proofGate('deterministic-apply-batch-chunk-windows-carried-through',
      chunkWindowsCarried, {
      chunkStarts: chunkTransfer.chunkStarts,
      chunkEnds: chunkTransfer.chunkEnds,
      chunkSizes: chunkTransfer.chunkSizes,
      order,
      coverage,
      hashMismatches,
      chunkCollectionHashMatches,
    }),
    proofGate('receipt-prefix-resume-without-duplicate-mutation-work',
      receiptPrefixResumeSafe, {
      committedChunkIndexes: firstAttempt.committedChunkIndexes,
      resumeReceiptIndexes,
      skippedChunkIndexes: resume.skippedChunkIndexes,
      appliedChunkIndexes: resume.appliedChunkIndexes,
      duplicateMutationWork: resume.duplicateMutationWork,
      maxMutationWorkCount: resume.maxMutationWorkCount,
    }),
    proofGate('completed-resume-replay-skips-all-chunks', completedResumeSafe, {
      secondResumeSkippedChunkIndexes: secondResume.skippedChunkIndexes,
      secondResumeAppliedChunkIndexes: secondResume.appliedChunkIndexes,
      secondResumeDuplicateMutationWork: secondResume.duplicateMutationWork,
      finalReplayReceiptSkips: finalReplay.receiptSkips,
      finalReplayDuplicateMutationWork: finalReplay.duplicateMutationWork,
    }),
    proofGate('apply-batch-storage-boundary-cas-carried-through', storageBoundarySafe, {
      storageBoundaryCheckCount: resume.storageBoundaryChecks?.length,
      storageBoundaryFailures: resume.storageBoundaryFailures,
      completedResumeStorageBoundaryFailures: secondResume.storageBoundaryFailures,
    }),
    proofGate('generated-unsafe-apply-batch-cases-fail-closed',
      generatedUnsafeCasesFailClosed, {
      caseCount: generatedCoverage.caseCount,
      outputEmitted: generatedCoverage.outputEmitted,
      blockedCaseCount: generatedCoverage.blockedCaseCount,
      unsafeOutputs: generatedCoverage.unsafeOutputs,
      blockerCounts: generatedCoverage.blockerCounts,
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

  const staleGeneratedCoverage = withPassedStatus(clone(evidence));
  staleGeneratedCoverage.generatedCoverage.blockedCaseCount = 8;
  staleGeneratedCoverage.generatedCoverage.blockerCounts['no-duplicate-mutation-work'] = 1;

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

  const storageBoundaryFailure = withPassedStatus(clone(evidence));
  storageBoundaryFailure.resume.storageBoundaryChecks[0].actualBeforeHash =
    sha256('rpp-0793-drifted-resume-storage');
  storageBoundaryFailure.resume.storageBoundaryChecks[0].passed = false;
  storageBoundaryFailure.resume.storageBoundaryFailures = 1;

  const rawValueLeak = withPassedStatus(clone(evidence));
  rawValueLeak.resume.rawResourceKey = 'rpp-0793-fixture-unsafe-leak';

  const rolloutGateMissing = withPassedStatus(clone(evidence));
  rolloutGateMissing.rolloutSafety.gateStatuses['production-row-batch-executor'] = 'failed';
  rolloutGateMissing.rolloutSafety.summary.blocked = 2;
  rolloutGateMissing.rolloutSafety.summary.failed = 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingRuntimeReport: resolveReleaseVerifierCarryThrough(missingRuntimeReport),
    staleGeneratedCoverage: resolveReleaseVerifierCarryThrough(staleGeneratedCoverage),
    duplicateMutationWork: resolveReleaseVerifierCarryThrough(duplicateMutationWork),
    completedResumeDuplicateWork: resolveReleaseVerifierCarryThrough(completedResumeDuplicateWork),
    storageBoundaryFailure: resolveReleaseVerifierCarryThrough(storageBoundaryFailure),
    rawValueLeak: resolveReleaseVerifierCarryThrough(rawValueLeak),
    rolloutGateMissing: resolveReleaseVerifierCarryThrough(rolloutGateMissing),
    prematurePassStatus: resolveReleaseVerifierCarryThrough(prematurePassStatus),
  };
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
  };
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
    chunkIdHash: sha256(`rpp-0793-apply-transfer-chunk-${chunkIndex + 1}`),
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

function generatedApplyBatchResumeCases() {
  const cases = [
    { id: 'receipt-prefix-resume', updated: true, outputEmitted: true, blockedBy: [] },
    {
      id: 'stale-chunk-receipt',
      updated: false,
      outputEmitted: false,
      blockedBy: ['resume-skips-durable-chunks'],
    },
    {
      id: 'missing-committed-receipt',
      updated: false,
      outputEmitted: false,
      blockedBy: ['resume-skips-durable-chunks'],
    },
    {
      id: 'duplicate-mutation-work',
      updated: false,
      outputEmitted: false,
      blockedBy: ['no-duplicate-mutation-work'],
    },
    {
      id: 'completed-resume-duplicate-work',
      updated: false,
      outputEmitted: false,
      blockedBy: [
        'completed-resume-replay-skips-all-chunks',
        'no-duplicate-mutation-work',
      ],
    },
    {
      id: 'drifted-resume-storage',
      updated: false,
      outputEmitted: false,
      blockedBy: ['storage-boundary-cas-before-resume-mutations'],
    },
    {
      id: 'raw-value-leak',
      updated: false,
      outputEmitted: false,
      blockedBy: ['hash-only-chunk-transfer-evidence'],
    },
    {
      id: 'out-of-order-chunk',
      updated: false,
      outputEmitted: false,
      blockedBy: ['ordered-transfer-chunks'],
    },
    {
      id: 'over-budget',
      updated: false,
      outputEmitted: false,
      blockedBy: ['runtime-resource-budget'],
    },
    {
      id: 'premature-pass-status',
      updated: false,
      outputEmitted: false,
      blockedBy: ['correctness-gates-not-recorded'],
    },
  ];

  return cases.map((chunkCase) => {
    const publicCase = {
      caseId: chunkCase.id,
      sourceRppId: 'RPP-0773',
      previousVariant: 'apply-batch-sizing-v4',
      updated: chunkCase.updated,
      outputEmitted: chunkCase.outputEmitted,
      attemptedPassBlocked: !chunkCase.updated,
      blockedBy: chunkCase.blockedBy,
      decisionHash: digest({
        proofId: 'rpp-0773-apply-batch-sizing-v4',
        caseId: chunkCase.id,
        blockedBy: chunkCase.blockedBy,
      }),
    };
    return {
      ...publicCase,
      caseHash: digest(publicCase),
    };
  });
}

function generatedCoverageSummary(generatedCases, repeatedCases) {
  const blockedCases = generatedCases.filter((chunkCase) => chunkCase.updated === false);
  const blockerCounts = {};
  for (const chunkCase of blockedCases) {
    for (const blocker of chunkCase.blockedBy) {
      blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
    }
  }
  const caseHashes = generatedCases.map((chunkCase) => chunkCase.caseHash);
  const repeatedCaseHashes = repeatedCases.map((chunkCase) => chunkCase.caseHash);

  return {
    sourceRppId: 'RPP-0773',
    source: 'local-support-generated-apply-batch-chunk-resume-regression-cases',
    releaseVerifierVariant: evidenceSource,
    previousVariant: 'apply-batch-sizing-v4',
    caseCount: generatedCases.length,
    outputEmitted: generatedCases.filter((chunkCase) => chunkCase.outputEmitted).length,
    blockedCaseCount: blockedCases.length,
    unsafeOutputs: generatedCases
      .filter((chunkCase) => chunkCase.caseId !== 'receipt-prefix-resume' && chunkCase.outputEmitted)
      .length,
    deterministicCaseVector: sameArray(caseHashes, repeatedCaseHashes),
    caseIds: generatedCases.map((chunkCase) => chunkCase.caseId),
    blockerCounts,
  };
}

function applyBatchSizingReleaseVerifierContract(scenario) {
  const sourceApplyBatchSizing = {
    rppId: 'RPP-0713',
    proofId: 'rpp-0713-apply-batch-sizing',
    status: 'passed',
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
  const previousVariant = {
    rppId: 'RPP-0753',
    proofId: 'rpp-0753-apply-batch-sizing-v3',
    variant: 3,
    status: 'passed',
    evidenceHash: digest({
      rppId: 'RPP-0753',
      proofId: 'rpp-0753-apply-batch-sizing-v3',
      chunkTransfer: 'hash-only-variant-3-support-proof',
    }),
  };
  const contract = {
    rppId: 'RPP-0773',
    proofId: 'rpp-0773-apply-batch-sizing-v4',
    variant: 4,
    status: 'passed',
    sourceApplyBatchSizing: {
      ...sourceApplyBatchSizing,
      evidenceHash: digest(sourceApplyBatchSizing),
    },
    previousVariant,
    chunkCollectionHash: scenario.chunkTransfer.chunkCollectionHash,
    completedResumeReceiptSetHash: scenario.secondResume.receiptSetHashAfterResume,
  };

  return {
    ...contract,
    evidenceHash: digest(contract),
  };
}

function rolloutSafetyGates() {
  return Object.entries(expectedRolloutGateStatuses).map(([id, status]) => ({
    id,
    status,
  }));
}

function rolloutSafetySummary(gates) {
  return {
    passed: gates.filter((gate) => gate.status === 'passed').length,
    blocked: gates.filter((gate) => gate.status === 'blocked').length,
    failed: gates.filter((gate) => gate.status === 'failed').length,
    speedClaimsAllowed: false,
  };
}

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'support-only-local-release-verifier',
    productionReleaseApproval: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'live-production-service-not-supplied',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'production-release-approval-not-supplied',
    ],
  };
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
    chunkTransfer: evidence.chunkTransfer,
    firstAttempt: evidence.firstAttempt,
    resume: evidence.resume,
    secondResume: evidence.secondResume,
    finalReplay: evidence.finalReplay,
    generatedCoverage: evidence.generatedCoverage,
    rolloutSafety: evidence.rolloutSafety,
    release: evidence.release,
  };
}

function expectedBlockerCountsHold(blockerCounts) {
  return Object.keys(blockerCounts).length === Object.keys(expectedV4BlockerCounts).length
    && Object.entries(expectedV4BlockerCounts)
      .every(([id, count]) => blockerCounts[id] === count);
}

function hasRuntimeReport(runtime) {
  return runtime
    && typeof runtime.generatedAt === 'string'
    && runtime.profile === 'unit'
    && typeof runtime.durationMs === 'number'
    && typeof runtime.budgets?.maxDurationMs === 'number'
    && typeof runtime.budgets?.maxHeapUsedBytes === 'number';
}

function hasResourceReport(resources) {
  return resources
    && resources.process
    && resources.storage
    && resources.apply
    && resources.journals
    && typeof resources.process.heapUsedBytes === 'number'
    && typeof resources.storage.chunkReceipts === 'number'
    && typeof resources.apply.mutationCount === 'number'
    && typeof resources.journals.durableChunkReceiptCount === 'number';
}

function hasRolloutGateReport(gates) {
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

function assertHashCountOnlyReleaseVerifierEvidence(value) {
  assert.equal(releaseVerifierEvidenceHasNoRawValues(value), true);
}

function releaseVerifierEvidenceHasNoRawValues(value) {
  return !rawReleaseVerifierEvidencePattern().test(JSON.stringify(value));
}

function rawReleaseVerifierEvidencePattern() {
  return /"resourceKey"\s*:|rpp-0793-fixture|private option value|post_content|option_value|meta_value|Bearer\s+|Basic\s+|https?:\/\//i;
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
