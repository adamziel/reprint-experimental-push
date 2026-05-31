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

const proofId = 'rpp-0769-chunk-replay-idempotency-v4';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const scope = {
  planId: 'plan-rpp-0769',
  resourceKey: 'file:wp-content/uploads/2026/05/rpp-0769-large.bin',
};
const expectedGateIds = Object.freeze([
  'built-on-rpp-0749-v3',
  'durable-local-receipts-complete',
  'repeated-replay-idempotency',
  'stable-replay-decision-hashes',
  'stale-or-mismatched-replay-fails-closed',
  'guarded-large-local-budget',
  'hash-only-storage-performance-evidence',
  'support-only-release-no-go',
]);

test('RPP-0769 variant 4 proves guardedLarge chunk replay idempotency inside documented budgets', {
  concurrency: false,
}, () => {
  const report = runLargeReplayBenchmark();
  const proof = buildVariant4Proof(report);

  assert.equal(proof.rppId, 'RPP-0769');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0749');
  assert.equal(proof.builtOn.proofId, 'rpp-0749-chunk-replay-idempotency-v3');
  assert.equal(proof.builtOn.variant, 3);
  assert.equal(proof.builtOn.source.rppId, 'RPP-0729');
  assert.equal(proof.builtOn.source.proofId, 'rpp-0729-chunk-replay-idempotency-v2');
  assert.equal(proof.builtOn.source.variant, 2);
  assert.equal(proof.builtOn.sourceBenchmark.rppId, 'RPP-0709');
  assert.equal(proof.builtOn.sourceBenchmark.benchmark, 'rpp-0709-chunk-replay-idempotency');
  assert.match(proof.builtOn.sourceBenchmark.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.largeSite.profile, 'guardedLarge');
  assert.equal(proof.largeSite.fileBytes, 402_653_184);
  assert.equal(proof.largeSite.chunkSizeBytes, 8_388_608);
  assert.equal(proof.largeSite.chunkCount, 48);
  assert.equal(proof.storage.receiptBackend, 'lab-file-journal-receipts');
  assert.equal(proof.storage.productionBacked, false);
  assert.equal(proof.storage.chunkReceipts, proof.largeSite.chunkCount);
  assert.equal(proof.storage.durableJournalHasNoRawValues, true);
  assert.match(proof.storage.chunkManifestDigestHash, /^[a-f0-9]{64}$/);
  assert.match(proof.storage.finalizedHashHash, /^[a-f0-9]{64}$/);

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
  assert.ok(proof.replay.replayDecisionHashCount > 0);
  assert.equal(proof.replay.replayDecisionHashesStable, true);
  assert.ok(proof.replay.sampleReplayDecisionHashes.every(isSha256Hash));
  assert.ok(Object.values(proof.failClosed).every((value) => value === true));

  assert.equal(proof.budgets.generatedAt, fixedNow.toISOString());
  assert.equal(proof.budgets.profile, 'guardedLarge');
  assert.equal(proof.budgets.durationWithinBudget, true);
  assert.equal(proof.budgets.heapWithinBudget, true);
  assert.equal(proof.budgets.largeSiteRunFinishesInsideDocumentedBudgets, true);
  assert.equal(proof.budgets.durationMs <= proof.budgets.maxDurationMs, true);
  assert.equal(proof.budgets.heapUsedBytes <= proof.budgets.maxHeapUsedBytes, true);

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
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashOnlyOutput, true);
  assert.match(proof.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.missingReceipt.updated, false);
  assert.equal(proof.unsafe.missingReceipt.outputEmitted, false);
  assert.ok(proof.unsafe.missingReceipt.blockedBy.includes('durable-local-receipts-complete'));
  assert.equal(proof.unsafe.duplicateReplayWork.updated, false);
  assert.ok(proof.unsafe.duplicateReplayWork.blockedBy.includes('repeated-replay-idempotency'));
  assert.equal(proof.unsafe.unstableReplayDecisionHashes.updated, false);
  assert.ok(proof.unsafe.unstableReplayDecisionHashes.blockedBy.includes('stable-replay-decision-hashes'));
  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.ok(proof.unsafe.overBudget.blockedBy.includes('guarded-large-local-budget'));
  assert.equal(proof.unsafe.productionClaim.updated, false);
  assert.ok(proof.unsafe.productionClaim.blockedBy.includes('support-only-release-no-go'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));
  for (const decision of Object.values(proof.unsafe)) {
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
  }

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.productionStorageReceipts, 'not-claimed');
  assert.equal(proof.release.productionRowBatchExecution, 'not-claimed');
  assert.equal(proof.release.productionAtomicGroupCommit, 'not-claimed');
  assert.equal(proof.release.liveTopology, 'not-claimed');
  assert.equal(proof.release.credentials, 'not-claimed');
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertHashOnlyChunkReplayEvidence(proof);
});

test('RPP-0769 variant 4 focused module keeps deterministic replay decisions hash-only', () => {
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
  const repeatedReplays = [0, 1, 2, 3].map(() => resolveChunkReplayAttempt({
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
  const wrongResource = resolveChunkReplayAttempt({
    planId: scope.planId,
    resourceKey: `${scope.resourceKey}:stale`,
    manifestEntry: entries[0],
    chunkReceiptRecords: receipts,
  });
  const missingReceipt = resolveChunkReplayAttempt({
    ...scope,
    manifestEntry: entries[0],
    chunkReceiptRecords: [],
  });
  const evidence = buildChunkReplayIdempotencyEvidence({
    ...scope,
    profile: 'unit',
    manifestEntries: entries,
    chunkReceiptRecords: receipts,
    replayAttemptsPerChunk: 4,
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
    replayAttemptsPerChunk: 4,
    timings: {
      totalMs: 60_001,
      chunkReplayDecisionMs: 4,
    },
  });

  assert.deepEqual(repeatedReplays.map((result) => result.status), [
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
  assert.equal(wrongResource.status, 'upload-required');
  assert.equal(missingReceipt.status, 'upload-required');

  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.attempts.attemptedReplays, 8);
  assert.equal(evidence.attempts.exactReceiptReplays, 8);
  assert.equal(evidence.attempts.duplicateChunkBytes, 0);
  assert.equal(evidence.attempts.duplicateReceiptRecordsCreated, 0);
  assert.equal(evidence.attempts.duplicateMutationWork, 0);
  assert.equal(evidence.attempts.canonicalVisibleDuringReplay, false);
  assert.equal(evidence.budgets.largeSiteRunFinishesInsideDocumentedBudgets, true);
  assert.equal(overBudget.status, 'blocked');
  assert.equal(overBudget.budgets.checks.totalRuntimeMs.passed, false);
  assert.equal(overBudget.budgets.largeSiteRunFinishesInsideDocumentedBudgets, false);
  assertEvidenceHasNoRawReplayValues(evidence, entries);
});

function runLargeReplayBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0769-replay-v4-'));
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

function buildVariant4Proof(report) {
  const evidence = buildChunkReplayVariant4Evidence({ report });
  recordCorrectnessGates(evidence);
  const safeDecision = resolveChunkReplayVariant4Proof(evidence);
  const unsafe = projectUnsafeDecisions(unsafeChunkReplayDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(evidence, 'correctnessGates', 'largeSite');
  const proofGates = [
    proofGate('correctness-gates-hold-before-output', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('repeated-replay-stays-idempotent',
      evidence.replay.repeatedReplayReturnedExistingReceipts
        && evidence.replay.receiptRecordCountStableDuringReplay
        && evidence.replay.duplicateChunkBytes === 0
        && evidence.replay.duplicateReceiptRecordsWritten === 0
        && evidence.replay.duplicateMutationWork === 0, {
        attemptedReplayCount: evidence.replay.attemptedReplayCount,
        existingReceiptReturns: evidence.replay.existingReceiptReturns,
        duplicateChunkBytes: evidence.replay.duplicateChunkBytes,
        duplicateReceiptRecordsWritten: evidence.replay.duplicateReceiptRecordsWritten,
        duplicateMutationWork: evidence.replay.duplicateMutationWork,
      }),
    proofGate('deterministic-replay-decision-hashes',
      evidence.replay.replayDecisionHashesStable
        && evidence.replay.sampleReplayDecisionHashes.every(isSha256Hash), {
        replayDecisionHashCount: evidence.replay.replayDecisionHashCount,
      }),
    proofGate('large-site-run-finished-inside-documented-budgets',
      evidence.budgets.largeSiteRunFinishesInsideDocumentedBudgets, {
        durationMs: evidence.budgets.durationMs,
        maxDurationMs: evidence.budgets.maxDurationMs,
        heapUsedBytes: evidence.budgets.heapUsedBytes,
        maxHeapUsedBytes: evidence.budgets.maxHeapUsedBytes,
      }),
    proofGate('support-only-release-no-go',
      evidence.release.supportOnly === true
        && evidence.release.productionBacked === false
        && evidence.release.productionThroughput === 'not-claimed'
        && evidence.release.finalReleaseStatus === 'NO-GO'
        && evidence.release.integrationRecommendation === 'NO-GO', {
        productionThroughput: evidence.release.productionThroughput,
        finalReleaseStatus: evidence.release.finalReleaseStatus,
        integrationRecommendation: evidence.release.integrationRecommendation,
      }),
  ];
  const publicProof = {
    rppId: 'RPP-0769',
    proofId,
    variant: 4,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
    benchmark: evidence.benchmark,
    largeSite: evidence.largeSite,
    storage: evidence.storage,
    replay: evidence.replay,
    failClosed: evidence.failClosed,
    budgets: evidence.budgets,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyOutput: safeDecision.hashOnlyOutput,
      outputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: evidence.release,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-and-count-only-chunk-replay-idempotency-v4',
      rawValueEvidenceLeaks: chunkReplayEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicChunkReplayEvidenceProjection(evidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildChunkReplayVariant4Evidence({ report }) {
  const replay = report.evidence.replayIdempotency;
  const benchmarkProjection = publicBenchmarkProjection(report);
  const sampleReplayDecisionHashes = replay.sampleReplayDecisions.map((decision) => digest(decision));
  const recomputedSampleReplayDecisionHashes = replay.sampleReplayDecisions
    .map((decision) => digest(decision));

  return {
    schemaVersion: 1,
    rppId: 'RPP-0769',
    proofId,
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
    release: supportOnlyReleasePosture(report),
  };
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeChunkReplayProofGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveChunkReplayVariant4Proof(evidence) {
  const recomputedGates = recomputeChunkReplayProofGates(evidence);
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

function recomputeChunkReplayProofGates(evidence) {
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

function unsafeChunkReplayDecisions(evidence) {
  const missingReceipt = withPassedStatus(clone(evidence));
  missingReceipt.storage.chunkReceipts -= 1;
  missingReceipt.replay.exactReceiptMatches -= 1;
  missingReceipt.replay.receiptRecordsBeforeReplay -= 1;
  missingReceipt.replay.receiptRecordsAfterReplay -= 1;

  const duplicateReplayWork = withPassedStatus(clone(evidence));
  duplicateReplayWork.replay.bytesRewrittenDuringReplay = 1;
  duplicateReplayWork.replay.duplicateChunkBytes = 1;
  duplicateReplayWork.replay.duplicateReceiptRecordsWritten = 1;
  duplicateReplayWork.replay.duplicateMutationWork = 1;
  duplicateReplayWork.replay.noDuplicateMutationWork = false;

  const unstableReplayDecisionHashes = withPassedStatus(clone(evidence));
  unstableReplayDecisionHashes.replay.recomputedSampleReplayDecisionHashes = [
    digest('unstable-replay-decision-hash'),
    ...unstableReplayDecisionHashes.replay.recomputedSampleReplayDecisionHashes.slice(1),
  ];
  unstableReplayDecisionHashes.replay.replayDecisionHashesStable = false;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.budgets.durationMs = overBudget.budgets.maxDurationMs + 1;
  overBudget.budgets.durationWithinBudget = false;
  overBudget.budgets.largeSiteRunFinishesInsideDocumentedBudgets = false;

  const productionClaim = withPassedStatus(clone(evidence));
  productionClaim.release.productionBacked = true;
  productionClaim.release.productionThroughput = 'claimed';
  productionClaim.release.productionStorageReceipts = 'claimed';
  productionClaim.release.productionRowBatchExecution = 'claimed';
  productionClaim.release.productionAtomicGroupCommit = 'claimed';
  productionClaim.release.liveTopology = 'claimed';
  productionClaim.release.credentials = 'claimed';
  productionClaim.release.finalReleaseStatus = 'GO';
  productionClaim.release.integrationRecommendation = 'GO';

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingReceipt: resolveChunkReplayVariant4Proof(missingReceipt),
    duplicateReplayWork: resolveChunkReplayVariant4Proof(duplicateReplayWork),
    unstableReplayDecisionHashes: resolveChunkReplayVariant4Proof(unstableReplayDecisionHashes),
    overBudget: resolveChunkReplayVariant4Proof(overBudget),
    productionClaim: resolveChunkReplayVariant4Proof(productionClaim),
    prematurePassStatus: resolveChunkReplayVariant4Proof(prematurePassStatus),
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
    gates: report.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
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

function supportOnlyReleasePosture(report) {
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
    'wp-content/uploads/2026/05/rpp-0769-large.bin',
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
