import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runChunkReplayIdempotencyBenchmark } from '../scripts/bench/guarded-executor-benchmark.js';
import {
  buildChunkReplayIdempotencyEvidence,
  resolveChunkReplayAttempt,
} from '../src/chunk-replay-idempotency.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0789-chunk-replay-idempotency-release-verifier-v5';
const sourceProofId = 'rpp-0769-chunk-replay-idempotency-v4';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const scope = {
  planId: 'plan-rpp-0789',
  resourceKey: 'file:wp-content/uploads/2026/05/rpp-0789-large.bin',
};
const requiredBenchmarkGateIds = Object.freeze([
  'durable-chunk-receipts',
  'chunk-hash-verification',
  'chunk-replay-idempotency',
  'no-duplicate-mutation-work',
  'large-site-runtime-budget',
]);
const carriedVariant4GateIds = Object.freeze([
  'built-on-rpp-0749-v3',
  'durable-local-receipts-complete',
  'repeated-replay-idempotency',
  'stable-replay-decision-hashes',
  'stale-or-mismatched-replay-fails-closed',
  'guarded-large-local-budget',
  'hash-only-storage-performance-evidence',
  'support-only-release-no-go',
]);
const releaseVerifierGateIds = Object.freeze([
  'built-on-rpp-0769-v4',
  'release-verifier-runtime-resources-gates-reported',
  'chunk-replay-idempotency-correctness-carried-through',
  'guarded-large-run-finished-inside-documented-budgets',
  'release-verifier-output-gated-by-correctness',
  'deterministic-hash-only-release-verifier-evidence',
  'release-verifier-carry-through-claimed-support-only',
  'support-only-release-no-go',
]);

test('RPP-0789 release verifier variant 5 carries chunk replay idempotency through large-site budgets', {
  concurrency: false,
}, () => {
  const report = runLargeReplayBenchmark();
  const proof = buildReleaseVerifierSupportProof(report);

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0789');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, 'chunk-replay-idempotency-release-verifier-v5');
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.deepEqual(proof.gates.map((gate) => gate.id), releaseVerifierGateIds);
  assert.deepEqual([...new Set(proof.gates.map((gate) => gate.status))], ['pass']);

  assert.equal(proof.builtOn.rppId, 'RPP-0769');
  assert.equal(proof.builtOn.proofId, sourceProofId);
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.source.rppId, 'RPP-0749');
  assert.equal(proof.builtOn.source.variant, 3);
  assert.equal(proof.builtOn.source.source.rppId, 'RPP-0729');
  assert.equal(proof.builtOn.source.source.variant, 2);
  assert.equal(proof.builtOn.sourceBenchmark.rppId, 'RPP-0709');
  assert.equal(proof.builtOn.sourceBenchmark.benchmark, 'rpp-0709-chunk-replay-idempotency');
  assert.match(proof.builtOn.sourceBenchmark.evidenceHash, sha256Pattern);

  assert.equal(proof.releaseVerifier.benchmarkId, 'rpp-0709-chunk-replay-idempotency');
  assert.equal(proof.releaseVerifier.command,
    'node --test --test-name-pattern RPP-0789 test/rpp-0789-chunk-replay-idempotency-release-verifier-v5.test.js');
  assert.equal(proof.releaseVerifier.runtimeReported, true);
  assert.equal(proof.releaseVerifier.resourcesReported, true);
  assert.equal(proof.releaseVerifier.passFailGatesReported, true);
  assert.equal(proof.releaseVerifier.carryThrough, 'support-only-claimed');
  assert.deepEqual(proof.releaseVerifier.passGateIds.sort(), [...requiredBenchmarkGateIds].sort());
  assert.deepEqual(proof.releaseVerifier.failGateIds, []);
  assert.deepEqual(proof.releaseVerifier.requiredBenchmarkGateIds, requiredBenchmarkGateIds);
  assert.deepEqual(proof.releaseVerifier.carriedVariant4GateIds, carriedVariant4GateIds);
  assert.equal(proof.releaseVerifier.productionGateEvidence, 'not-present');

  assert.equal(proof.largeSite.profile, 'guardedLarge');
  assert.equal(proof.largeSite.fileBytes, 402_653_184);
  assert.equal(proof.largeSite.chunkSizeBytes, 8_388_608);
  assert.equal(proof.largeSite.chunkCount, 48);
  assert.equal(proof.storage.receiptBackend, 'lab-file-journal-receipts');
  assert.equal(proof.storage.productionBacked, false);
  assert.equal(proof.storage.chunkReceipts, proof.largeSite.chunkCount);
  assert.equal(proof.storage.durableJournalHasNoRawValues, true);
  assert.match(proof.storage.chunkManifestDigestHash, sha256Pattern);
  assert.match(proof.storage.finalizedHashHash, sha256Pattern);

  assert.equal(proof.replay.replayAttemptsPerChunk, 2);
  assert.equal(proof.replay.attemptedReplayCount, 96);
  assert.equal(proof.replay.existingReceiptReturns, 96);
  assert.equal(proof.replay.exactReceiptMatches, proof.largeSite.chunkCount);
  assert.equal(proof.replay.receiptRecordsBeforeReplay, proof.largeSite.chunkCount);
  assert.equal(proof.replay.receiptRecordsAfterReplay, proof.largeSite.chunkCount);
  assert.equal(proof.replay.uniqueReceiptKeys, proof.largeSite.chunkCount);
  assert.equal(proof.replay.repeatedReplayReturnedExistingReceipts, true);
  assert.equal(proof.replay.receiptRecordCountStableDuringReplay, true);
  assert.equal(proof.replay.duplicateChunkBytes, 0);
  assert.equal(proof.replay.duplicateReceiptRecordsWritten, 0);
  assert.equal(proof.replay.duplicateMutationWork, 0);
  assert.equal(proof.replay.applyBoundaryOpenedDuringReplay, false);
  assert.equal(proof.replay.replayDecisionHashCount, proof.replay.sampleReplayDecisionHashes.length);
  assert.ok(proof.replay.sampleReplayDecisionHashes.every(isSha256Hash));
  assert.equal(proof.replay.replayDecisionHashesStable, true);
  assert.ok(Object.values(proof.failClosed).every((value) => value === true));

  assert.equal(proof.budgets.generatedAt, fixedNow.toISOString());
  assert.equal(proof.budgets.profile, 'guardedLarge');
  assert.equal(proof.budgets.durationWithinBudget, true);
  assert.equal(proof.budgets.heapWithinBudget, true);
  assert.equal(proof.budgets.largeSiteRunFinishesInsideDocumentedBudgets, true);
  assert.equal(proof.budgets.durationMs <= proof.budgets.maxDurationMs, true);
  assert.equal(proof.budgets.heapUsedBytes <= proof.budgets.maxHeapUsedBytes, true);

  assert.deepEqual(proof.sourceCorrectness.gateIds, carriedVariant4GateIds);
  assert.deepEqual(proof.sourceCorrectness.recomputedGateVector.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.sourceCorrectness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.sourceCorrectness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.sourceCorrectness.hashOnlyOutput, true);
  assert.match(proof.sourceCorrectness.outputHash, sha256EvidencePattern);

  assert.equal(proof.correctness.variant4CorrectnessCarriedThrough, true);
  assert.equal(proof.correctness.benchmarkGatesRetained, true);
  assert.equal(proof.correctness.releaseVerifierOutputGatedByCorrectness, true);
  assert.equal(proof.correctness.deterministicHashOnlyProjection, true);
  assert.equal(proof.correctness.noDuplicateReplayWork, true);
  assert.equal(proof.correctness.largeSiteRunFinishesInsideDocumentedBudgets, true);

  assert.equal(proof.unsafe.missingReceipt.updated, false);
  assert.ok(proof.unsafe.missingReceipt.blockedBy.includes('durable-local-receipts-complete'));
  assert.equal(proof.unsafe.duplicateReplayWork.updated, false);
  assert.ok(proof.unsafe.duplicateReplayWork.blockedBy.includes('repeated-replay-idempotency'));
  assert.equal(proof.unsafe.unstableReplayDecisionHashes.updated, false);
  assert.ok(proof.unsafe.unstableReplayDecisionHashes.blockedBy.includes('stable-replay-decision-hashes'));
  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.ok(proof.unsafe.overBudget.blockedBy.includes('guarded-large-local-budget'));
  assert.equal(proof.unsafe.productionClaim.updated, false);
  assert.ok(proof.unsafe.productionClaim.blockedBy.includes('support-only-release-no-go'));
  assert.equal(proof.unsafe.missingReleaseVerifierCarryThrough.updated, false);
  assert.ok(proof.unsafe.missingReleaseVerifierCarryThrough.blockedBy
    .includes('release-verifier-carry-through-claimed-support-only'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));
  for (const decision of Object.values(proof.unsafe)) {
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, sha256Pattern);
  }

  assert.equal(proof.release.releaseVerifierCarryThrough, 'support-only-claimed');
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.productionStorageReceipts, 'not-claimed');
  assert.equal(proof.release.productionRowBatchExecution, 'not-claimed');
  assert.equal(proof.release.productionAtomicGroupCommit, 'not-claimed');
  assert.equal(proof.release.liveTopology, 'not-claimed');
  assert.equal(proof.release.authPrerequisites, 'not-claimed');
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.evidenceHash, sha256Pattern);
  assertHashOnlyChunkReplayEvidence(proof);
});

test('RPP-0789 release verifier focused replay decisions stay idempotent and fail closed', () => {
  const entries = [
    manifestEntry(),
    manifestEntry({
      chunkIndex: 1,
      offsetBytes: 262_144,
      chunkDigest: `sha256:${'d'.repeat(64)}`,
      receiptKey: `${scope.planId}:${scope.resourceKey}:sha256:${'a'.repeat(64)}:chunk:1:262144:262144:sha256:${'d'.repeat(64)}`,
      idempotencyKey: `${scope.planId}:${scope.resourceKey}:sha256:${'a'.repeat(64)}:chunk:1`,
    }),
  ];
  const receipts = entries.map((entry) => receiptFor(entry));
  const repeatedReplays = [0, 1, 2, 3, 4].map(() => resolveChunkReplayAttempt({
    ...scope,
    manifestEntry: entries[0],
    chunkReceiptRecords: receipts,
  }));
  const originalDecisionHash = digest(publicReplayDecision(repeatedReplays[0]));
  const reorderedDecisionHash = digest(publicReplayDecision(resolveChunkReplayAttempt({
    ...scope,
    manifestEntry: entries[0],
    chunkReceiptRecords: [...receipts].reverse(),
  })));
  const staleVisibleReceipt = resolveChunkReplayAttempt({
    ...scope,
    manifestEntry: entries[0],
    chunkReceiptRecords: [receiptFor(entries[0], { canonicalVisible: true })],
  });
  const mismatchedRange = resolveChunkReplayAttempt({
    ...scope,
    manifestEntry: entries[0],
    chunkReceiptRecords: [receiptFor(entries[0], { offsetBytes: 1 })],
  });
  const evidence = buildChunkReplayIdempotencyEvidence({
    ...scope,
    profile: 'unit',
    manifestEntries: entries,
    chunkReceiptRecords: receipts,
    replayAttemptsPerChunk: 5,
    timings: {
      totalMs: 150,
      chunkReplayDecisionMs: 4,
    },
  });
  const overBudget = buildChunkReplayIdempotencyEvidence({
    ...scope,
    profile: 'unit',
    manifestEntries: entries,
    chunkReceiptRecords: receipts,
    replayAttemptsPerChunk: 5,
    timings: {
      totalMs: 60_001,
      chunkReplayDecisionMs: 4,
    },
  });
  const proof = buildFocusedReleaseVerifierProof({ evidence, repeatedReplays });

  assert.deepEqual(repeatedReplays.map((result) => result.status), [
    'receipt-returned',
    'receipt-returned',
    'receipt-returned',
    'receipt-returned',
    'receipt-returned',
  ]);
  assert.equal(new Set(repeatedReplays.map((result) => result.receiptKey)).size, 1);
  assert.ok(repeatedReplays.every((result) => result.bytesWritten === 0));
  assert.ok(repeatedReplays.every((result) => result.receiptRecordsCreated === 0));
  assert.ok(repeatedReplays.every((result) => result.mutationWork === 0));
  assert.equal(originalDecisionHash, reorderedDecisionHash);
  assert.equal(staleVisibleReceipt.status, 'blocked');
  assert.equal(staleVisibleReceipt.reason, 'canonical-visible-receipt-conflict');
  assert.equal(mismatchedRange.status, 'blocked');
  assert.equal(mismatchedRange.reason, 'idempotency-key-conflict');

  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.attempts.attemptedReplays, 10);
  assert.equal(evidence.attempts.exactReceiptReplays, 10);
  assert.equal(evidence.attempts.duplicateChunkBytes, 0);
  assert.equal(evidence.attempts.duplicateReceiptRecordsCreated, 0);
  assert.equal(evidence.attempts.duplicateMutationWork, 0);
  assert.equal(evidence.attempts.canonicalVisibleDuringReplay, false);
  assert.equal(evidence.budgets.largeSiteRunFinishesInsideDocumentedBudgets, true);
  assert.equal(overBudget.status, 'blocked');
  assert.equal(overBudget.budgets.checks.totalRuntimeMs.passed, false);
  assert.equal(overBudget.budgets.largeSiteRunFinishesInsideDocumentedBudgets, false);

  assert.equal(proof.rppId, 'RPP-0789');
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, 'chunk-replay-idempotency-release-verifier-focused-v5');
  assert.equal(proof.status, 'passed');
  assert.equal(proof.releaseVerifierCarryThrough, 'support-only-claimed');
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.equal(proof.replayAttemptsPerChunk, 5);
  assert.equal(proof.exactReceiptReplays, 10);
  assert.equal(proof.duplicateReplayWork, 0);
  assert.match(proof.evidenceHash, sha256Pattern);
  assertEvidenceHasNoRawReplayValues(proof, entries);
});

test('RPP-0789 release verifier variant 5 preserves failed runtime budget gates for NO-GO diagnosis', () => {
  const report = runUnitBudgetFailureBenchmark();
  const proof = buildFailGateReleaseVerifierProof(report);

  assert.equal(report.ok, false);
  assert.deepEqual(report.gates.map((gate) => gate.id), requiredBenchmarkGateIds);
  assert.equal(gateById(report, 'large-site-runtime-budget').status, 'fail');
  for (const gateId of requiredBenchmarkGateIds.filter((id) => id !== 'large-site-runtime-budget')) {
    assert.equal(gateById(report, gateId).status, 'pass', `${gateId} should remain pass`);
  }

  assert.equal(proof.rppId, 'RPP-0789');
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, 'chunk-replay-idempotency-release-verifier-fail-gate-v5');
  assert.equal(proof.status, 'failed_support_gate');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.equal(proof.releaseVerifierCarryThrough, 'support-only-claimed');
  assert.equal(proof.runtimeReported, true);
  assert.equal(proof.resourcesReported, true);
  assert.equal(proof.passFailGatesReported, true);
  assert.deepEqual(proof.failGateIds, ['large-site-runtime-budget']);
  assert.equal(proof.failedBudgetGate.id, 'large-site-runtime-budget');
  assert.equal(proof.failedBudgetGate.profile, 'unit');
  assert.equal(proof.failedBudgetGate.maxHeapUsedBytes, 1);
  assert.ok(proof.failedBudgetGate.heapUsedBytes > 1);
  assert.equal(proof.failedBudgetGate.largeSiteRunFinishesInsideDocumentedBudgets, false);
  assert.equal(proof.replay.attemptedReplayCount, 4);
  assert.equal(proof.replay.existingReceiptReturns, 4);
  assert.equal(proof.replay.duplicateReceiptRecordsWritten, 0);
  assert.equal(proof.replay.duplicateChunkBytes, 0);
  assert.equal(proof.replay.duplicateMutationWork, 0);
  assert.equal(proof.storage.chunkReceipts, 4);
  assert.match(proof.evidenceHash, sha256Pattern);
  assertHashOnlyChunkReplayEvidence(proof);
});

function runLargeReplayBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0789-replay-v5-'));
  try {
    return runChunkReplayIdempotencyBenchmark({
      profile: 'guardedLarge',
      now: fixedNow,
      tempDir,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function runUnitBudgetFailureBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0789-replay-fail-v5-'));
  try {
    return runChunkReplayIdempotencyBenchmark({
      profile: 'unit',
      now: fixedNow,
      tempDir,
      maxHeapUsedBytes: 1,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function manifestEntry(overrides = {}) {
  return {
    chunkIndex: 0,
    offsetBytes: 0,
    sizeBytes: 262_144,
    localResourceHash: `sha256:${'a'.repeat(64)}`,
    chunkDigest: `sha256:${'b'.repeat(64)}`,
    receiptKey: `${scope.planId}:${scope.resourceKey}:sha256:${'a'.repeat(64)}:chunk:0:0:262144:sha256:${'b'.repeat(64)}`,
    idempotencyKey: `${scope.planId}:${scope.resourceKey}:sha256:${'a'.repeat(64)}:chunk:0`,
    canonicalVisible: false,
    ...overrides,
  };
}

function receiptFor(entry, overrides = {}) {
  return {
    type: 'chunk-receipt',
    ...scope,
    state: 'staged',
    chunkCount: 2,
    chunkIndex: entry.chunkIndex,
    offsetBytes: entry.offsetBytes,
    sizeBytes: entry.sizeBytes,
    localResourceHash: entry.localResourceHash,
    chunkDigest: entry.chunkDigest,
    receiptKey: entry.receiptKey,
    idempotencyKey: entry.idempotencyKey,
    canonicalVisible: false,
    ...overrides,
  };
}

function buildReleaseVerifierSupportProof(report) {
  const sourceEvidence = buildCarriedVariant4Evidence({ report });
  recordVariant4CorrectnessGates(sourceEvidence);
  const release = supportOnlyReleaseProjection(report);
  const sourceDecision = resolveCarriedVariant4Proof(sourceEvidence);
  const releaseDecision = resolveReleaseVerifierOutput({ sourceEvidence, release, report });
  const unsafe = projectUnsafeDecisions(unsafeReleaseVerifierDecisions(sourceEvidence, release, report));
  const benchmarkGateVector = gateStatuses(report);
  const benchmarkProjectionHash = digest(publicBenchmarkProjection(report));
  const deterministicHashOnlyProjection = sourceEvidence.replay.replayDecisionHashesStable === true
    && sameArray(
      sourceEvidence.replay.sampleReplayDecisionHashes,
      sourceEvidence.replay.recomputedSampleReplayDecisionHashes,
    )
    && chunkReplayEvidenceHasNoRawValues(publicReleaseVerifierProjection({
      sourceEvidence,
      release,
      report,
      benchmarkProjectionHash,
    }));
  const variant4CorrectnessCarriedThrough = sourceEvidence.status === 'passed'
    && sourceDecision.correctnessGatesHold === true
    && sourceEvidence.correctnessGates.length === carriedVariant4GateIds.length
    && sameArray(sourceEvidence.correctnessGates.map((gate) => gate.id), carriedVariant4GateIds)
    && sourceDecision.recomputedGates.every((gate) => gate.status === 'pass');
  const benchmarkGatesRetained = hasPassFailGateReport(report)
    && report.gates.every((gate) => gate.status === 'pass');
  const noDuplicateReplayWork = sourceEvidence.replay.duplicateChunkBytes === 0
    && sourceEvidence.replay.duplicateReceiptRecordsWritten === 0
    && sourceEvidence.replay.duplicateMutationWork === 0;
  const largeSiteRunInsideBudgets = sourceEvidence.budgets.largeSiteRunFinishesInsideDocumentedBudgets === true
    && sourceEvidence.budgets.durationMs <= sourceEvidence.budgets.maxDurationMs
    && sourceEvidence.budgets.heapUsedBytes <= sourceEvidence.budgets.maxHeapUsedBytes;

  const gates = [
    proofGate('built-on-rpp-0769-v4',
      sourceEvidence.rppId === 'RPP-0769'
        && sourceEvidence.variant === 4
        && sourceEvidence.proofId === sourceProofId
        && sourceEvidence.builtOn?.rppId === 'RPP-0749'
        && sourceEvidence.builtOn?.variant === 3, {
      sourceRppId: sourceEvidence.rppId,
      sourceVariant: sourceEvidence.variant,
      sourceProofId: sourceEvidence.proofId,
    }),
    proofGate('release-verifier-runtime-resources-gates-reported',
      hasRuntimeReport(report) && hasResourceReport(report) && hasPassFailGateReport(report), {
      runtimeReported: hasRuntimeReport(report),
      resourcesReported: hasResourceReport(report),
      gateCount: report.gates.length,
    }),
    proofGate('chunk-replay-idempotency-correctness-carried-through',
      variant4CorrectnessCarriedThrough
        && benchmarkGatesRetained
        && sourceEvidence.replay.repeatedReplayReturnedExistingReceipts
        && sourceEvidence.replay.receiptRecordCountStableDuringReplay
        && noDuplicateReplayWork, {
      attemptedReplayCount: sourceEvidence.replay.attemptedReplayCount,
      existingReceiptReturns: sourceEvidence.replay.existingReceiptReturns,
      benchmarkPassGateCount: report.gates.filter((gate) => gate.status === 'pass').length,
      noDuplicateReplayWork,
    }),
    proofGate('guarded-large-run-finished-inside-documented-budgets',
      sourceEvidence.largeSite.profile === 'guardedLarge'
        && sourceEvidence.budgets.profile === 'guardedLarge'
        && largeSiteRunInsideBudgets, {
      durationMs: sourceEvidence.budgets.durationMs,
      maxDurationMs: sourceEvidence.budgets.maxDurationMs,
      heapUsedBytes: sourceEvidence.budgets.heapUsedBytes,
      maxHeapUsedBytes: sourceEvidence.budgets.maxHeapUsedBytes,
    }),
    proofGate('release-verifier-output-gated-by-correctness',
      releaseDecision.updated
        && releaseDecision.outputEmitted
        && releaseDecision.correctnessGatesHold
        && releaseDecision.hashOnlyOutput, {
      outputHash: releaseDecision.outputHash,
      blockedBy: releaseDecision.blockedBy,
    }),
    proofGate('deterministic-hash-only-release-verifier-evidence',
      deterministicHashOnlyProjection, {
      replayDecisionHashCount: sourceEvidence.replay.replayDecisionHashCount,
      benchmarkProjectionHash,
      rawValueEvidenceLeaks: deterministicHashOnlyProjection ? 0 : 1,
    }),
    proofGate('release-verifier-carry-through-claimed-support-only',
      release.releaseVerifierCarryThrough === 'support-only-claimed'
        && release.productionBacked === false
        && release.releaseEligible === false, {
      releaseVerifierCarryThrough: release.releaseVerifierCarryThrough,
      productionBacked: release.productionBacked,
      releaseEligible: release.releaseEligible,
    }),
    proofGate('support-only-release-no-go',
      release.supportOnly === true
        && release.productionBacked === false
        && release.finalReleaseStatus === 'NO-GO'
        && release.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
  const publicProof = {
    schemaVersion: 1,
    rppId: 'RPP-0789',
    proofId,
    variant: 5,
    evidenceSource: 'chunk-replay-idempotency-release-verifier-v5',
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: release.finalReleaseStatus,
    integrationRecommendation: release.integrationRecommendation,
    builtOn: {
      rppId: 'RPP-0769',
      proofId: sourceProofId,
      variant: 4,
      source: sourceEvidence.builtOn,
      sourceBenchmark: sourceEvidence.builtOn.sourceBenchmark,
    },
    releaseVerifier: {
      benchmarkId: report.benchmark,
      command: 'node --test --test-name-pattern RPP-0789 test/rpp-0789-chunk-replay-idempotency-release-verifier-v5.test.js',
      runtimeReported: hasRuntimeReport(report),
      resourcesReported: hasResourceReport(report),
      passFailGatesReported: hasPassFailGateReport(report),
      carryThrough: release.releaseVerifierCarryThrough,
      passGateIds: report.gates.filter((gate) => gate.status === 'pass').map((gate) => gate.id),
      failGateIds: report.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
      requiredBenchmarkGateIds: [...requiredBenchmarkGateIds],
      carriedVariant4GateIds: [...carriedVariant4GateIds],
      productionGateEvidence: 'not-present',
    },
    benchmark: publicBenchmarkProjection(report),
    largeSite: sourceEvidence.largeSite,
    storage: sourceEvidence.storage,
    replay: sourceEvidence.replay,
    failClosed: sourceEvidence.failClosed,
    budgets: sourceEvidence.budgets,
    sourceCorrectness: {
      gateIds: sourceEvidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: sourceDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput:
        objectKeyBefore(sourceEvidence, 'correctnessGates', 'largeSite'),
      correctnessGatesHoldBeforeOutput: sourceDecision.correctnessGatesHold,
      hashOnlyOutput: sourceDecision.hashOnlyOutput,
      outputEmittedAfterGates: sourceDecision.outputEmitted,
      outputHash: sourceDecision.outputHash,
    },
    correctness: {
      variant4CorrectnessCarriedThrough,
      benchmarkGatesRetained,
      releaseVerifierOutputGatedByCorrectness: releaseDecision.updated
        && releaseDecision.outputEmitted
        && releaseDecision.correctnessGatesHold,
      deterministicHashOnlyProjection,
      noDuplicateReplayWork,
      largeSiteRunFinishesInsideDocumentedBudgets: largeSiteRunInsideBudgets,
      benchmarkGateVector,
    },
    unsafe,
    gates,
    release,
    outputHash: releaseDecision.outputHash,
    redaction: {
      mode: 'hash-and-count-only-chunk-replay-release-verifier-v5',
      rawValueEvidenceLeaks: chunkReplayEvidenceHasNoRawValues(publicReleaseVerifierProjection({
        sourceEvidence,
        release,
        report,
        benchmarkProjectionHash,
      })) ? 0 : 1,
      publicEvidenceHash: digest(publicReleaseVerifierProjection({
        sourceEvidence,
        release,
        report,
        benchmarkProjectionHash,
      })),
      releaseDecisionHash: releaseDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildCarriedVariant4Evidence({ report }) {
  const replay = report.evidence.replayIdempotency;
  const benchmarkProjection = publicBenchmarkProjection(report);
  const sampleReplayDecisionHashes = replay.sampleReplayDecisions.map((decision) => digest(decision));
  const recomputedSampleReplayDecisionHashes = replay.sampleReplayDecisions
    .map((decision) => digest(decision));

  return {
    schemaVersion: 1,
    rppId: 'RPP-0769',
    proofId: sourceProofId,
    variant: 4,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0749',
      proofId: 'rpp-0749-chunk-replay-idempotency-v3',
      variant: 3,
      source: {
        rppId: 'RPP-0729',
        proofId: 'rpp-0729-chunk-replay-idempotency-v2',
        variant: 2,
      },
      sourceBenchmark: {
        rppId: report.rppId,
        benchmark: report.benchmark,
        evidenceHash: digest(benchmarkProjection),
      },
    },
    benchmark: benchmarkProjection,
    correctnessGates: [],
    largeSite: {
      profile: report.profile,
      fileBytes: report.resources.transfer.fileBytes,
      chunkSizeBytes: report.resources.transfer.chunkSizeBytes,
      chunkCount: report.resources.transfer.chunkCount,
      bytesMovedThroughStaging: report.resources.transfer.bytesMovedThroughStaging,
      manifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
      finalizedHashHash: digest(report.resources.transfer.finalizedHash),
    },
    storage: {
      stagingBackend: report.resources.transfer.staging,
      storageProof: 'support-only-local-file-journal',
      receiptBackend: 'lab-file-journal-receipts',
      productionBacked: false,
      chunkReceipts: report.resources.transfer.chunkReceipts,
      transferRecords: report.resources.journals.transferRecords,
      journalIntegrity: report.resources.journals.integrity,
      durableJournalHasNoRawValues: report.resources.journals.durableJournalHasNoRawValues,
      chunkManifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
      finalizedHashHash: digest(report.resources.transfer.finalizedHash),
    },
    replay: {
      proofId: replay.proofId,
      sourceVariant: replay.variant,
      status: replay.status,
      replayScope: replay.replayScope,
      planIdHash: digest(replay.planId),
      resourceKeyHash: digest(replay.resourceKey),
      chunkCount: replay.chunkCount,
      replayAttemptsPerChunk: replay.replayAttemptsPerChunk,
      attemptedReplayCount: replay.attemptedReplayCount,
      existingReceiptReturns: replay.idempotentSkips,
      exactReceiptMatches: replay.exactReceiptMatches,
      idempotentReplaySafe: replay.idempotentReplaySafe,
      receiptRecordsBeforeReplay: replay.receipts.beforeReplay,
      receiptRecordsAfterReplay: replay.receipts.afterReplay,
      duplicateReceiptRecordsWritten: replay.receipts.duplicateReceiptRecordsWritten,
      uniqueReceiptKeys: replay.receipts.uniqueReceiptKeys,
      bytesRewrittenDuringReplay: replay.bytes.bytesRewrittenDuringReplay,
      duplicateChunkBytes: replay.bytes.duplicateChunkBytes,
      duplicateMutationWork: replay.mutationWork.duplicateMutationWork,
      noDuplicateMutationWork: replay.mutationWork.noDuplicateMutationWork,
      applyBoundaryOpenedDuringReplay: replay.mutationWork.applyBoundaryOpenedDuringReplay,
      replayCursorFields: replay.replayCursorFields,
      replayDecisionHashCount: sampleReplayDecisionHashes.length,
      sampleReplayDecisionHashes,
      recomputedSampleReplayDecisionHashes,
      replayDecisionHashesStable: sameArray(sampleReplayDecisionHashes, recomputedSampleReplayDecisionHashes),
      evidenceHash: replay.evidenceHash,
      repeatedReplayReturnedExistingReceipts: replay.replayAttemptsPerChunk >= 2
        && replay.idempotentSkips === replay.attemptedReplayCount,
      receiptRecordCountStableDuringReplay:
        replay.receipts.beforeReplay === replay.receipts.afterReplay,
    },
    failClosed: replay.failClosed,
    budgets: {
      generatedAt: report.runtime.generatedAt,
      profile: report.runtime.profile,
      budgetStatus: report.runtime.budgetStatus,
      durationMs: report.runtime.durationMs,
      maxDurationMs: report.runtime.budgets.maxDurationMs,
      durationWithinBudget: report.runtime.budgetEvidence.durationWithinBudget,
      heapUsedBytes: report.resources.process.heapUsedBytes,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      heapWithinBudget: report.runtime.budgetEvidence.heapWithinBudget,
      largeSiteRunFinishesInsideDocumentedBudgets: report.runtime.budgetStatus === 'passed',
      conservativeBudgetReporting: report.runtime.conservativeBudgetReporting,
    },
    benchmarkGates: report.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
      evidenceHash: digest(gate.evidence),
    })),
    release: supportOnlySourceReleasePosture(report),
  };
}

function recordVariant4CorrectnessGates(evidence) {
  const gates = recomputeVariant4ProofGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveCarriedVariant4Proof(evidence) {
  const recomputedGates = recomputeVariant4ProofGates(evidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, carriedVariant4GateIds);
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
        proofId: sourceProofId,
        variant: 4,
        gateVectorHash: sha256(recomputedGates),
        largeSiteBudgetHash: sha256(evidence.budgets),
        replayHash: sha256({
          replayAttemptsPerChunk: evidence.replay.replayAttemptsPerChunk,
          attemptedReplayCount: evidence.replay.attemptedReplayCount,
          existingReceiptReturns: evidence.replay.existingReceiptReturns,
          duplicateChunkBytes: evidence.replay.duplicateChunkBytes,
          duplicateReceiptRecordsWritten: evidence.replay.duplicateReceiptRecordsWritten,
          duplicateMutationWork: evidence.replay.duplicateMutationWork,
          replayDecisionHashCount: evidence.replay.replayDecisionHashCount,
          replayDecisionHashesStable: evidence.replay.replayDecisionHashesStable,
        }),
        storageHash: sha256({
          chunkReceipts: evidence.storage.chunkReceipts,
          receiptBackend: evidence.storage.receiptBackend,
          productionBacked: evidence.storage.productionBacked,
        }),
        duplicateReplayWork: evidence.replay.duplicateChunkBytes
          + evidence.replay.duplicateReceiptRecordsWritten
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
    hashOnlyOutput: output ? chunkReplayEvidenceHasNoRawValues(output) : false,
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

function resolveReleaseVerifierOutput({ sourceEvidence, release, report }) {
  const sourceDecision = resolveCarriedVariant4Proof(sourceEvidence);
  const releaseFailures = [
    ...(!hasRuntimeReport(report) || !hasResourceReport(report) || !hasPassFailGateReport(report)
      ? ['release-verifier-runtime-resources-gates-reported']
      : []),
    ...(!report.gates.every((gate) => gate.status === 'pass') ? ['benchmark-gates-not-passed'] : []),
    ...(!(
      release.releaseVerifierCarryThrough === 'support-only-claimed'
      && release.productionBacked === false
      && release.releaseEligible === false
    ) ? ['release-verifier-carry-through-claimed-support-only'] : []),
    ...(!(
      release.supportOnly === true
      && release.productionBacked === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO'
    ) ? ['support-only-release-no-go'] : []),
  ];
  const blockedBy = unique([...sourceDecision.blockedBy, ...releaseFailures]);
  const correctnessGatesHold = blockedBy.length === 0;
  const output = correctnessGatesHold
    ? {
        proofId,
        variant: 5,
        sourceOutputHash: sourceDecision.outputHash,
        benchmarkGateVectorHash: sha256(gateStatuses(report)),
        largeSiteBudgetHash: sha256(sourceEvidence.budgets),
        replayHash: sha256({
          replayAttemptsPerChunk: sourceEvidence.replay.replayAttemptsPerChunk,
          attemptedReplayCount: sourceEvidence.replay.attemptedReplayCount,
          existingReceiptReturns: sourceEvidence.replay.existingReceiptReturns,
          duplicateChunkBytes: sourceEvidence.replay.duplicateChunkBytes,
          duplicateReceiptRecordsWritten: sourceEvidence.replay.duplicateReceiptRecordsWritten,
          duplicateMutationWork: sourceEvidence.replay.duplicateMutationWork,
          replayDecisionHashesStable: sourceEvidence.replay.replayDecisionHashesStable,
        }),
        releaseVerifierCarryThrough: release.releaseVerifierCarryThrough,
        finalReleaseStatus: release.finalReleaseStatus,
        integrationRecommendation: release.integrationRecommendation,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: sourceEvidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    hashOnlyOutput: output ? chunkReplayEvidenceHasNoRawValues(output) : false,
    blockedBy,
    sourceDecisionHash: sourceDecision.decisionHash,
    outputHash: output ? sha256(output) : null,
  };

  return {
    ...publicDecision,
    output,
    decisionHash: digest(publicDecision),
  };
}

function recomputeVariant4ProofGates(evidence) {
  const largeSite = evidence.largeSite || {};
  const storage = evidence.storage || {};
  const replay = evidence.replay || {};
  const failClosed = evidence.failClosed || {};
  const budgets = evidence.budgets || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const failClosedProbeCount = Object.keys(failClosed).length;
  const failClosedProbesPass = failClosedProbeCount >= 5
    && Object.values(failClosed).every((value) => value === true);
  const durableLocalReceiptsComplete = storage.receiptBackend === 'lab-file-journal-receipts'
    && storage.storageProof === 'support-only-local-file-journal'
    && storage.productionBacked === false
    && storage.chunkReceipts === largeSite.chunkCount
    && storage.journalIntegrity === 'ok'
    && storage.durableJournalHasNoRawValues === true;
  const repeatedReplayIdempotent = replay.status === 'passed'
    && replay.sourceVariant === 1
    && replay.chunkCount === largeSite.chunkCount
    && replay.replayAttemptsPerChunk >= 2
    && replay.attemptedReplayCount === largeSite.chunkCount * replay.replayAttemptsPerChunk
    && replay.existingReceiptReturns === replay.attemptedReplayCount
    && replay.exactReceiptMatches === largeSite.chunkCount
    && replay.idempotentReplaySafe === true
    && replay.receiptRecordsBeforeReplay === largeSite.chunkCount
    && replay.receiptRecordsAfterReplay === largeSite.chunkCount
    && replay.uniqueReceiptKeys === largeSite.chunkCount
    && replay.repeatedReplayReturnedExistingReceipts === true
    && replay.receiptRecordCountStableDuringReplay === true
    && replay.bytesRewrittenDuringReplay === 0
    && replay.duplicateChunkBytes === 0
    && replay.duplicateReceiptRecordsWritten === 0
    && replay.duplicateMutationWork === 0
    && replay.noDuplicateMutationWork === true
    && replay.applyBoundaryOpenedDuringReplay === false;
  const stableReplayDecisionHashes = Number.isInteger(replay.replayDecisionHashCount)
    && replay.replayDecisionHashCount > 0
    && replay.replayDecisionHashCount === replay.sampleReplayDecisionHashes?.length
    && replay.replayDecisionHashCount === replay.recomputedSampleReplayDecisionHashes?.length
    && replay.sampleReplayDecisionHashes.every(isSha256Hash)
    && sameArray(replay.sampleReplayDecisionHashes, replay.recomputedSampleReplayDecisionHashes)
    && replay.replayDecisionHashesStable === true
    && isSha256Hash(replay.evidenceHash);
  const guardedLargeBudgetHolds = largeSite.profile === 'guardedLarge'
    && budgets.profile === 'guardedLarge'
    && budgets.budgetStatus === 'passed'
    && budgets.durationWithinBudget === true
    && budgets.heapWithinBudget === true
    && budgets.durationMs <= budgets.maxDurationMs
    && budgets.heapUsedBytes <= budgets.maxHeapUsedBytes
    && budgets.largeSiteRunFinishesInsideDocumentedBudgets === true;

  return [
    proofGate('built-on-rpp-0749-v3', evidence.builtOn?.rppId === 'RPP-0749'
      && evidence.builtOn?.variant === 3
      && evidence.builtOn?.source?.rppId === 'RPP-0729'
      && evidence.builtOn?.source?.variant === 2
      && evidence.builtOn?.sourceBenchmark?.rppId === 'RPP-0709'
      && evidence.builtOn?.sourceBenchmark?.benchmark === 'rpp-0709-chunk-replay-idempotency'
      && isSha256Hash(evidence.builtOn?.sourceBenchmark?.evidenceHash), {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      sourceRppId: evidence.builtOn?.source?.rppId,
      sourceBenchmark: evidence.builtOn?.sourceBenchmark?.benchmark,
    }),
    proofGate('durable-local-receipts-complete', durableLocalReceiptsComplete, {
      receiptBackend: storage.receiptBackend,
      productionBacked: storage.productionBacked,
      chunkReceipts: storage.chunkReceipts,
      chunkCount: largeSite.chunkCount,
      journalIntegrity: storage.journalIntegrity,
      durableJournalHasNoRawValues: storage.durableJournalHasNoRawValues,
    }),
    proofGate('repeated-replay-idempotency', repeatedReplayIdempotent, {
      replayAttemptsPerChunk: replay.replayAttemptsPerChunk,
      attemptedReplayCount: replay.attemptedReplayCount,
      existingReceiptReturns: replay.existingReceiptReturns,
      receiptRecordsBeforeReplay: replay.receiptRecordsBeforeReplay,
      receiptRecordsAfterReplay: replay.receiptRecordsAfterReplay,
      duplicateChunkBytes: replay.duplicateChunkBytes,
      duplicateReceiptRecordsWritten: replay.duplicateReceiptRecordsWritten,
      duplicateMutationWork: replay.duplicateMutationWork,
    }),
    proofGate('stable-replay-decision-hashes', stableReplayDecisionHashes, {
      replayDecisionHashCount: replay.replayDecisionHashCount,
      replayDecisionHashesStable: replay.replayDecisionHashesStable,
    }),
    proofGate('stale-or-mismatched-replay-fails-closed', failClosedProbesPass, {
      failClosedProbeCount,
      failedProbeCount: Object.values(failClosed).filter((value) => value !== true).length,
    }),
    proofGate('guarded-large-local-budget', guardedLargeBudgetHolds, {
      profile: budgets.profile,
      durationMs: budgets.durationMs,
      maxDurationMs: budgets.maxDurationMs,
      heapUsedBytes: budgets.heapUsedBytes,
      maxHeapUsedBytes: budgets.maxHeapUsedBytes,
      largeSiteRunFinishesInsideDocumentedBudgets:
        budgets.largeSiteRunFinishesInsideDocumentedBudgets,
    }),
    proofGate('hash-only-storage-performance-evidence',
      chunkReplayEvidenceHasNoRawValues(publicChunkReplayEvidenceProjection(evidence)), {
        rawValueEvidenceLeaks: chunkReplayEvidenceHasNoRawValues(
          publicChunkReplayEvidenceProjection(evidence),
        ) ? 0 : 1,
      }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.productionThroughput === 'not-claimed'
      && release.speedClaimsAllowed === false
      && release.productionStorageReceipts === 'not-claimed'
      && release.productionRowBatchExecution === 'not-claimed'
      && release.productionAtomicGroupCommit === 'not-claimed'
      && release.liveTopology === 'not-claimed'
      && release.credentials === 'not-claimed'
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO'
      && releaseBlockers.includes('production-storage-receipts-not-measured')
      && releaseBlockers.includes('production-row-batch-executor-not-measured')
      && releaseBlockers.includes('production-atomic-group-commit-not-measured'), {
      productionThroughput: release.productionThroughput,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function unsafeReleaseVerifierDecisions(sourceEvidence, release, report) {
  const missingReceipt = withPassedStatus(clone(sourceEvidence));
  missingReceipt.storage.chunkReceipts -= 1;
  missingReceipt.replay.exactReceiptMatches -= 1;
  missingReceipt.replay.receiptRecordsBeforeReplay -= 1;
  missingReceipt.replay.receiptRecordsAfterReplay -= 1;

  const duplicateReplayWork = withPassedStatus(clone(sourceEvidence));
  duplicateReplayWork.replay.bytesRewrittenDuringReplay = 1;
  duplicateReplayWork.replay.duplicateChunkBytes = 1;
  duplicateReplayWork.replay.duplicateReceiptRecordsWritten = 1;
  duplicateReplayWork.replay.duplicateMutationWork = 1;
  duplicateReplayWork.replay.noDuplicateMutationWork = false;

  const unstableReplayDecisionHashes = withPassedStatus(clone(sourceEvidence));
  unstableReplayDecisionHashes.replay.recomputedSampleReplayDecisionHashes = [
    digest('rpp-0789-unstable-replay-decision-hash'),
    ...unstableReplayDecisionHashes.replay.recomputedSampleReplayDecisionHashes.slice(1),
  ];
  unstableReplayDecisionHashes.replay.replayDecisionHashesStable = false;

  const overBudget = withPassedStatus(clone(sourceEvidence));
  overBudget.budgets.durationMs = overBudget.budgets.maxDurationMs + 1;
  overBudget.budgets.durationWithinBudget = false;
  overBudget.budgets.largeSiteRunFinishesInsideDocumentedBudgets = false;

  const productionClaim = withPassedStatus(clone(sourceEvidence));
  productionClaim.release.productionBacked = true;
  productionClaim.release.productionThroughput = 'claimed';
  productionClaim.release.productionStorageReceipts = 'claimed';
  productionClaim.release.productionRowBatchExecution = 'claimed';
  productionClaim.release.productionAtomicGroupCommit = 'claimed';
  productionClaim.release.liveTopology = 'claimed';
  productionClaim.release.credentials = 'claimed';
  productionClaim.release.finalReleaseStatus = 'GO';
  productionClaim.release.integrationRecommendation = 'GO';

  const missingReleaseVerifierCarryThrough = withPassedStatus(clone(sourceEvidence));
  const missingCarryThroughRelease = {
    ...release,
    releaseVerifierCarryThrough: 'not-claimed',
  };

  const prematurePassStatus = withPassedStatus(clone(sourceEvidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingReceipt: resolveReleaseVerifierOutput({ sourceEvidence: missingReceipt, release, report }),
    duplicateReplayWork: resolveReleaseVerifierOutput({ sourceEvidence: duplicateReplayWork, release, report }),
    unstableReplayDecisionHashes: resolveReleaseVerifierOutput({
      sourceEvidence: unstableReplayDecisionHashes,
      release,
      report,
    }),
    overBudget: resolveReleaseVerifierOutput({ sourceEvidence: overBudget, release, report }),
    productionClaim: resolveReleaseVerifierOutput({ sourceEvidence: productionClaim, release, report }),
    missingReleaseVerifierCarryThrough: resolveReleaseVerifierOutput({
      sourceEvidence: missingReleaseVerifierCarryThrough,
      release: missingCarryThroughRelease,
      report,
    }),
    prematurePassStatus: resolveReleaseVerifierOutput({ sourceEvidence: prematurePassStatus, release, report }),
  };
}

function buildFocusedReleaseVerifierProof({ evidence, repeatedReplays }) {
  const replayDecisionHashes = repeatedReplays.map((result) => digest(publicReplayDecision(result)));
  const proof = {
    schemaVersion: 1,
    rppId: 'RPP-0789',
    variant: 5,
    evidenceSource: 'chunk-replay-idempotency-release-verifier-focused-v5',
    status: evidence.status === 'passed' ? 'passed' : 'failed',
    releaseVerifierCarryThrough: 'support-only-claimed',
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    replayAttemptsPerChunk: 5,
    attemptedReplays: evidence.attempts.attemptedReplays,
    exactReceiptReplays: evidence.attempts.exactReceiptReplays,
    duplicateReplayWork: evidence.attempts.duplicateChunkBytes
      + evidence.attempts.duplicateReceiptRecordsCreated
      + evidence.attempts.duplicateMutationWork,
    canonicalVisibleDuringReplay: evidence.attempts.canonicalVisibleDuringReplay,
    replayDecisionHashCount: replayDecisionHashes.length,
    replayDecisionHashes,
    outputHash: sha256({
      attemptedReplays: evidence.attempts.attemptedReplays,
      exactReceiptReplays: evidence.attempts.exactReceiptReplays,
      duplicateChunkBytes: evidence.attempts.duplicateChunkBytes,
      duplicateReceiptRecordsCreated: evidence.attempts.duplicateReceiptRecordsCreated,
      duplicateMutationWork: evidence.attempts.duplicateMutationWork,
    }),
  };

  return {
    ...proof,
    evidenceHash: digest(proof),
  };
}

function buildFailGateReleaseVerifierProof(report) {
  const runtimeGate = gateById(report, 'large-site-runtime-budget');
  const proof = {
    schemaVersion: 1,
    rppId: 'RPP-0789',
    variant: 5,
    evidenceSource: 'chunk-replay-idempotency-release-verifier-fail-gate-v5',
    status: 'failed_support_gate',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    releaseVerifierCarryThrough: 'support-only-claimed',
    runtimeReported: hasRuntimeReport(report),
    resourcesReported: hasResourceReport(report),
    passFailGatesReported: hasPassFailGateReport(report),
    passGateIds: report.gates.filter((gate) => gate.status === 'pass').map((gate) => gate.id),
    failGateIds: report.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
    failedBudgetGate: {
      id: runtimeGate.id,
      profile: runtimeGate.evidence.profile,
      durationMs: runtimeGate.evidence.durationMs,
      maxDurationMs: runtimeGate.evidence.maxDurationMs,
      heapUsedBytes: runtimeGate.evidence.heapUsedBytes,
      maxHeapUsedBytes: runtimeGate.evidence.maxHeapUsedBytes,
      largeSiteRunFinishesInsideDocumentedBudgets: false,
    },
    storage: {
      receiptBackend: 'lab-file-journal-receipts',
      productionBacked: false,
      chunkReceipts: report.resources.transfer.chunkReceipts,
      chunkCount: report.resources.transfer.chunkCount,
      durableJournalHasNoRawValues: report.resources.journals.durableJournalHasNoRawValues,
    },
    replay: {
      attemptedReplayCount: report.resources.replay.attemptedReplayCount,
      existingReceiptReturns: report.resources.replay.idempotentSkips,
      duplicateReceiptRecordsWritten: report.resources.replay.duplicateReceiptRecordsWritten,
      duplicateChunkBytes: report.evidence.replayIdempotency.bytes.duplicateChunkBytes,
      duplicateMutationWork: report.resources.replay.duplicateMutationWork,
      applyBoundaryOpenedDuringReplay:
        report.evidence.replayIdempotency.mutationWork.applyBoundaryOpenedDuringReplay,
    },
  };

  return {
    ...proof,
    evidenceHash: digest(proof),
  };
}

function publicBenchmarkProjection(report) {
  return {
    rppId: report.rppId,
    benchmark: report.benchmark,
    profile: report.profile,
    ok: report.ok,
    transfer: {
      fileBytes: report.resources.transfer.fileBytes,
      chunkSizeBytes: report.resources.transfer.chunkSizeBytes,
      chunkCount: report.resources.transfer.chunkCount,
      chunkManifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
      finalizedHashHash: digest(report.resources.transfer.finalizedHash),
    },
    replay: {
      attemptedReplayCount: report.resources.replay.attemptedReplayCount,
      idempotentSkips: report.resources.replay.idempotentSkips,
      duplicateReceiptRecordsWritten: report.resources.replay.duplicateReceiptRecordsWritten,
      bytesRewrittenDuringReplay: report.resources.replay.bytesRewrittenDuringReplay,
      duplicateMutationWork: report.resources.replay.duplicateMutationWork,
    },
    runtime: {
      profile: report.runtime.profile,
      budgetStatus: report.runtime.budgetStatus,
      maxDurationMs: report.runtime.budgets.maxDurationMs,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
    },
    gates: gateStatuses(report),
  };
}

function publicChunkReplayEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    benchmark: evidence.benchmark,
    largeSite: evidence.largeSite,
    storage: evidence.storage,
    replay: evidence.replay,
    failClosed: evidence.failClosed,
    budgets: evidence.budgets,
    benchmarkGates: evidence.benchmarkGates,
    release: evidence.release,
  };
}

function publicReleaseVerifierProjection({
  sourceEvidence,
  release,
  report,
  benchmarkProjectionHash,
}) {
  return {
    rppId: 'RPP-0789',
    proofId,
    variant: 5,
    source: {
      rppId: sourceEvidence.rppId,
      proofId: sourceEvidence.proofId,
      variant: sourceEvidence.variant,
      correctnessGateIds: sourceEvidence.correctnessGates.map((gate) => gate.id),
      correctnessGateStatuses: sourceEvidence.correctnessGates.map((gate) => gate.status),
    },
    benchmark: {
      rppId: report.rppId,
      benchmark: report.benchmark,
      profile: report.profile,
      projectionHash: benchmarkProjectionHash,
      gateStatuses: gateStatuses(report),
    },
    largeSite: sourceEvidence.largeSite,
    storage: sourceEvidence.storage,
    replay: sourceEvidence.replay,
    budgets: sourceEvidence.budgets,
    release,
  };
}

function supportOnlySourceReleasePosture(report) {
  return {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: report.claims.productionThroughput,
    speedClaimsAllowed: false,
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecution: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    liveTopology: 'not-claimed',
    credentials: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'live-topology-not-supplied',
      'credentials-not-supplied',
      'release-verifier-carry-through-not-claimed',
    ],
  };
}

function supportOnlyReleaseProjection(report) {
  return {
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecution: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    liveTopology: 'not-claimed',
    authPrerequisites: 'not-claimed',
    releaseVerifierCarryThrough: 'support-only-claimed',
    releaseVerifierScope: 'local-chunk-replay-idempotency-support-evidence',
    productionThroughput: report.claims.productionThroughput,
    speedClaimsAllowed: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'live-topology-not-supplied',
      'auth-prerequisites-not-supplied',
      'release-verifier-production-gate-not-present',
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

function publicReplayDecision(result) {
  return {
    status: result.status,
    reason: result.reason,
    canSkipUpload: result.canSkipUpload,
    receiptKeyHash: digest(result.receiptKey || null),
    idempotencyKeyHash: digest(result.idempotencyKey || null),
    bytesWritten: result.bytesWritten,
    receiptRecordsCreated: result.receiptRecordsCreated,
    mutationWork: result.mutationWork,
    canonicalVisible: result.canonicalVisible,
  };
}

function hasRuntimeReport(report) {
  return report.runtime
    && report.runtime.benchmarkId === 'rpp-0709-chunk-replay-idempotency'
    && typeof report.runtime.generatedAt === 'string'
    && typeof report.runtime.durationMs === 'number'
    && typeof report.runtime.node === 'string'
    && typeof report.runtime.platform === 'string'
    && typeof report.runtime.arch === 'string'
    && typeof report.runtime.cpuCount === 'number';
}

function hasResourceReport(report) {
  return report.resources
    && report.resources.transfer
    && report.resources.replay
    && report.resources.journals
    && report.resources.process
    && typeof report.resources.transfer.chunkCount === 'number'
    && typeof report.resources.replay.attemptedReplayCount === 'number'
    && typeof report.resources.journals.transferRecords === 'number'
    && typeof report.resources.process.heapUsedBytes === 'number';
}

function hasPassFailGateReport(report) {
  return Array.isArray(report.gates)
    && report.gates.length === requiredBenchmarkGateIds.length
    && report.gates.every((gate) => requiredBenchmarkGateIds.includes(gate.id)
      && ['pass', 'fail'].includes(gate.status));
}

function gateStatuses(report) {
  return report.gates.map((gate) => ({
    id: gate.id,
    status: gate.status,
  }));
}

function gateById(proofOrReport, id) {
  const gates = proofOrReport.gates || proofOrReport.correctnessGates;
  const gate = gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `missing gate ${id}`);
  return gate;
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function assertHashOnlyChunkReplayEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  for (const token of rawReplayTokens()) {
    assert.equal(serialized.includes(token), false, `evidence leaked raw replay token ${token}`);
  }
}

function assertEvidenceHasNoRawReplayValues(evidence, entries) {
  const serialized = JSON.stringify(evidence);
  for (const token of rawReplayTokens(entries)) {
    assert.equal(serialized.includes(token), false, `focused evidence leaked raw replay token ${token}`);
  }
}

function chunkReplayEvidenceHasNoRawValues(evidence) {
  const serialized = JSON.stringify(evidence);
  return rawReplayTokens().every((token) => serialized.includes(token) === false);
}

function rawReplayTokens(entries = []) {
  return [
    scope.planId,
    scope.resourceKey,
    'plan-guarded-executor-benchmark',
    'file:wp-content/uploads/2026/05/catalog-export.bin',
    'wp-content/uploads/2026/05/catalog-export.bin',
    'wp-content/uploads/2026/05/rpp-0789-large.bin',
    'catalog-export.bin',
    ...entries.flatMap((entry) => [entry.receiptKey, entry.idempotencyKey]),
  ];
}

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  return evidence;
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

function isSha256Hash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
