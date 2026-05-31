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

const proofId = 'rpp-0729-chunk-replay-idempotency-v2';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const scope = {
  planId: 'plan-rpp-0729',
  resourceKey: 'file:wp-content/uploads/2026/05/rpp-0729-large.bin',
};

test('RPP-0729 variant 2 proves guardedLarge chunk replay idempotency inside documented budgets', { concurrency: false }, () => {
  const report = runLargeReplayBenchmark();
  const proof = buildVariant2Proof(report);

  assert.equal(proof.rppId, 'RPP-0729');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0709');
  assert.equal(proof.builtOn.benchmark, 'rpp-0709-chunk-replay-idempotency');
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(proof.largeSite.profile, 'guardedLarge');
  assert.equal(proof.largeSite.fileBytes, 402_653_184);
  assert.equal(proof.largeSite.chunkSizeBytes, 8_388_608);
  assert.equal(proof.largeSite.chunkCount, 48);
  assert.equal(proof.replay.replayAttemptsPerChunk, 2);
  assert.equal(proof.replay.attemptedReplayCount, 96);
  assert.equal(proof.replay.existingReceiptReturns, 96);
  assert.equal(proof.replay.duplicateChunkBytes, 0);
  assert.equal(proof.replay.duplicateReceiptRecordsWritten, 0);
  assert.equal(proof.replay.duplicateMutationWork, 0);
  assert.equal(proof.replay.applyBoundaryOpenedDuringReplay, false);
  assert.deepEqual(proof.failClosed, {
    missingReceiptRequiresUpload: true,
    mismatchedDigestRejected: true,
    wrongPlanRejected: true,
    wrongResourceRejected: true,
    wrongRangeRejected: true,
  });
  assert.equal(proof.runtime.largeSiteRunFinishesInsideDocumentedBudgets, true);
  assert.equal(proof.runtime.durationWithinBudget, true);
  assert.equal(proof.runtime.heapWithinBudget, true);
  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertProjectionHasNoRawReplayValues(proof);
});

test('RPP-0729 variant 2 fails stale or mismatched replay closed with hash-only evidence', () => {
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
  const replay = resolveChunkReplayAttempt({
    ...scope,
    manifestEntry: entries[0],
    chunkReceiptRecords: receipts,
  });
  const duplicateReplay = resolveChunkReplayAttempt({
    ...scope,
    manifestEntry: entries[0],
    chunkReceiptRecords: receipts,
  });
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
  const wrongPlan = resolveChunkReplayAttempt({
    planId: `${scope.planId}:stale`,
    resourceKey: scope.resourceKey,
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
    replayAttemptsPerChunk: 2,
    timings: {
      totalMs: 120,
      chunkReplayDecisionMs: 3,
    },
  });

  assert.equal(replay.status, 'receipt-returned');
  assert.equal(duplicateReplay.status, 'receipt-returned');
  assert.equal(duplicateReplay.receiptKey, replay.receiptKey);
  assert.equal(duplicateReplay.bytesWritten, 0);
  assert.equal(duplicateReplay.receiptRecordsCreated, 0);
  assert.equal(duplicateReplay.mutationWork, 0);
  assert.equal(staleVisibleReceipt.status, 'blocked');
  assert.equal(staleVisibleReceipt.reason, 'canonical-visible-receipt-conflict');
  assert.equal(staleVisibleReceipt.canSkipUpload, false);
  assert.equal(mismatchedRange.status, 'blocked');
  assert.equal(mismatchedRange.reason, 'idempotency-key-conflict');
  assert.equal(mismatchedRange.canSkipUpload, false);
  assert.equal(wrongPlan.status, 'upload-required');
  assert.equal(wrongPlan.canSkipUpload, false);
  assert.equal(missingReceipt.status, 'upload-required');
  assert.equal(missingReceipt.canSkipUpload, false);
  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.attempts.attemptedReplays, 4);
  assert.equal(evidence.attempts.exactReceiptReplays, 4);
  assert.equal(evidence.attempts.duplicateChunkBytes, 0);
  assert.equal(evidence.attempts.duplicateReceiptRecordsCreated, 0);
  assert.equal(evidence.attempts.duplicateMutationWork, 0);
  assert.equal(evidence.probes.missingReceipt.status, 'upload-required');
  assert.equal(evidence.probes.mismatchedReplay.status, 'blocked');
  assert.equal(evidence.budgets.largeSiteRunFinishesInsideDocumentedBudgets, true);
  assert.match(evidence.evidenceHash, /^[a-f0-9]{64}$/);
  assertEvidenceHasNoRawReplayValues(evidence, entries);
});

function runLargeReplayBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0729-replay-'));
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

function buildVariant2Proof(report) {
  const replay = report.evidence.replayIdempotency;
  const gateVector = report.gates.map((gate) => ({
    id: gate.id,
    status: gate.status,
  }));
  const supportOnlyRelease = {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: report.claims.productionThroughput,
    speedClaimsAllowed: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'release-verifier-carry-through-not-claimed',
    ],
  };
  const gates = [
    proofGate(
      'existing-receipts-returned',
      replay.idempotentReplaySafe
        && replay.idempotentSkips === replay.attemptedReplayCount
        && report.evidence.receipts.recorded === report.evidence.receipts.expected
        && report.evidence.receipts.receiptKeysUnique === true,
      {
        attemptedReplayCount: replay.attemptedReplayCount,
        idempotentSkips: replay.idempotentSkips,
        receiptKeysUnique: report.evidence.receipts.receiptKeysUnique,
      },
    ),
    proofGate(
      'duplicate-free-replay-work',
      replay.bytes.bytesRewrittenDuringReplay === 0
        && replay.receipts.duplicateReceiptRecordsWritten === 0
        && replay.mutationWork.duplicateMutationWork === 0
        && replay.mutationWork.applyBoundaryOpenedDuringReplay === false,
      {
        bytesRewrittenDuringReplay: replay.bytes.bytesRewrittenDuringReplay,
        duplicateReceiptRecordsWritten: replay.receipts.duplicateReceiptRecordsWritten,
        duplicateMutationWork: replay.mutationWork.duplicateMutationWork,
        applyBoundaryOpenedDuringReplay: replay.mutationWork.applyBoundaryOpenedDuringReplay,
      },
    ),
    proofGate(
      'stale-or-mismatched-replay-fails-closed',
      Object.values(replay.failClosed).every((value) => value === true),
      replay.failClosed,
    ),
    proofGate(
      'large-site-runtime-budget',
      report.runtime.budgetStatus === 'passed'
        && report.runtime.durationMs <= report.runtime.budgets.maxDurationMs
        && report.resources.process.heapUsedBytes <= report.runtime.budgets.maxHeapUsedBytes,
      {
        durationMs: report.runtime.durationMs,
        maxDurationMs: report.runtime.budgets.maxDurationMs,
        heapUsedBytes: report.resources.process.heapUsedBytes,
        maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      },
    ),
    proofGate(
      'hash-only-redacted-evidence',
      report.evidence.redaction.durableJournalHasNoRawValues === true,
      {
        durableJournalHasNoRawValues: report.evidence.redaction.durableJournalHasNoRawValues,
        sampleReplayDecisionHashes: replay.sampleReplayDecisions.map((decision) => digest(decision)),
      },
    ),
    proofGate(
      'support-only-release-no-go',
      supportOnlyRelease.supportOnly === true
        && supportOnlyRelease.productionBacked === false
        && supportOnlyRelease.productionThroughput === 'not-claimed'
        && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
        && supportOnlyRelease.integrationRecommendation === 'NO-GO',
      {
        productionThroughput: supportOnlyRelease.productionThroughput,
        finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
        integrationRecommendation: supportOnlyRelease.integrationRecommendation,
      },
    ),
  ];
  const publicEvidence = {
    rppId: 'RPP-0729',
    proofId,
    variant: 2,
    status: gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: report.rppId,
      benchmark: report.benchmark,
      evidenceHash: digest(publicBenchmarkProjection(report)),
    },
    largeSite: {
      profile: report.profile,
      fileBytes: report.resources.transfer.fileBytes,
      chunkSizeBytes: report.resources.transfer.chunkSizeBytes,
      chunkCount: report.resources.transfer.chunkCount,
      manifestDigest: report.resources.transfer.chunkManifestDigest,
      finalizedHash: report.resources.transfer.finalizedHash,
    },
    replay: {
      replayScope: replay.replayScope,
      planIdHash: digest(replay.planId),
      resourceKeyHash: digest(replay.resourceKey),
      replayAttemptsPerChunk: replay.replayAttemptsPerChunk,
      attemptedReplayCount: replay.attemptedReplayCount,
      existingReceiptReturns: replay.idempotentSkips,
      exactReceiptMatches: replay.exactReceiptMatches,
      duplicateChunkBytes: replay.bytes.duplicateChunkBytes,
      duplicateReceiptRecordsWritten: replay.receipts.duplicateReceiptRecordsWritten,
      duplicateMutationWork: replay.mutationWork.duplicateMutationWork,
      applyBoundaryOpenedDuringReplay: replay.mutationWork.applyBoundaryOpenedDuringReplay,
      replayCursorFields: replay.replayCursorFields,
      sampleReplayDecisionHashes: replay.sampleReplayDecisions.map((decision) => digest(decision)),
    },
    failClosed: replay.failClosed,
    runtime: {
      profile: report.runtime.profile,
      durationMs: report.runtime.durationMs,
      maxDurationMs: report.runtime.budgets.maxDurationMs,
      durationWithinBudget: report.runtime.durationMs <= report.runtime.budgets.maxDurationMs,
      heapUsedBytes: report.resources.process.heapUsedBytes,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      heapWithinBudget: report.resources.process.heapUsedBytes <= report.runtime.budgets.maxHeapUsedBytes,
      budgetStatus: report.runtime.budgetStatus,
      largeSiteRunFinishesInsideDocumentedBudgets: report.runtime.budgetStatus === 'passed',
    },
    benchmarkGates: gateVector,
    gates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-and-count-only',
      durableJournalHasNoRawValues: report.evidence.redaction.durableJournalHasNoRawValues,
      manifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
      replayEvidenceHash: replay.evidenceHash,
      sampleReplayDecisionHashes: replay.sampleReplayDecisions.map((decision) => digest(decision)),
    },
  };

  return {
    ...publicEvidence,
    evidenceHash: digest(publicEvidence),
  };
}

function publicBenchmarkProjection(report) {
  return {
    rppId: report.rppId,
    benchmark: report.benchmark,
    profile: report.profile,
    transfer: {
      fileBytes: report.resources.transfer.fileBytes,
      chunkSizeBytes: report.resources.transfer.chunkSizeBytes,
      chunkCount: report.resources.transfer.chunkCount,
      chunkManifestDigest: report.resources.transfer.chunkManifestDigest,
      finalizedHash: report.resources.transfer.finalizedHash,
    },
    replay: {
      attemptedReplayCount: report.resources.replay.attemptedReplayCount,
      idempotentSkips: report.resources.replay.idempotentSkips,
      duplicateReceiptRecordsWritten: report.resources.replay.duplicateReceiptRecordsWritten,
      bytesRewrittenDuringReplay: report.resources.replay.bytesRewrittenDuringReplay,
      duplicateMutationWork: report.resources.replay.duplicateMutationWork,
      failClosed: report.evidence.replayIdempotency.failClosed,
    },
    gates: report.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
  };
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function assertEvidenceHasNoRawReplayValues(evidence, entries) {
  const serialized = JSON.stringify(evidence);
  for (const token of rawReplayTokens(entries)) {
    assert.equal(serialized.includes(token), false, `evidence leaked raw replay token ${token}`);
  }
}

function assertProjectionHasNoRawReplayValues(proof) {
  const serialized = JSON.stringify(proof);
  for (const token of rawReplayTokens()) {
    assert.equal(serialized.includes(token), false, `proof leaked raw replay token ${token}`);
  }
}

function rawReplayTokens(entries = []) {
  return [
    scope.planId,
    scope.resourceKey,
    'plan-guarded-executor-benchmark',
    'file:wp-content/uploads/2026/05/catalog-export.bin',
    'wp-content/uploads/2026/05/catalog-export.bin',
    'wp-content/uploads/2026/05/rpp-0729-large.bin',
    'catalog-export.bin',
    ...entries.flatMap((entry) => [entry.receiptKey, entry.idempotencyKey]),
  ];
}
