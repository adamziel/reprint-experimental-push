import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BenchmarkClaimError,
  productionThroughputBlockers,
  productionThroughputDetails,
  runGuardedExecutorBenchmark,
} from '../scripts/bench/guarded-executor-benchmark.js';

const fixedNow = new Date('2026-05-24T00:00:00.000Z');

function tempBenchmarkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-guarded-executor-benchmark-test-'));
}

function smallBenchmark(overrides = {}) {
  return runGuardedExecutorBenchmark({
    profile: 'unit',
    fileBytes: 3 * 1024 * 1024,
    chunkSizeBytes: 512 * 1024,
    rowCount: 16,
    rowPayloadBytes: 192,
    now: fixedNow,
    tempDir: tempBenchmarkDir(),
    ...overrides,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('guarded executor benchmark moves buffers and row payloads through durable evidence', () => {
  const report = smallBenchmark();

  assert.equal(report.claims.labGuardedExecutorEvidence, true);
  assert.equal(report.shape.bytesMovedThroughStaging, report.shape.fileBytes);
  assert.equal(report.evidence.chunkReceipts.recorded, report.shape.chunkCount);
  assert.equal(report.evidence.chunkReceipts.resumeCursor.chunkCount, report.shape.chunkCount);
  assert.equal(report.evidence.chunkReceipts.resumeCursor.chunkIndex, report.shape.chunkCount - 1);
  assert.equal(report.evidence.chunkReceipts.resumeCursor.resourceKey, 'file:wp-content/uploads/2026/05/catalog-export.bin');
  assert.equal(report.evidence.chunkReceipts.cursorConsistency.matchesRecordedReceiptCount, true);
  assert.equal(report.evidence.chunkReceipts.cursorConsistency.canResumeFromCursor, true);
  assert.equal(report.evidence.chunkReceipts.finalStagingRecord, true);
  assert.equal(report.evidence.chunkReceipts.canonicalVisibleBeforePublish, false);
  assert.equal(report.evidence.preconditions.liveRemoteMutationPreconditions, report.shape.mutations);
  assert.equal(report.evidence.preconditions.everyMutationHasLiveRemotePrecondition, true);
  assert.ok(report.shape.graphIdentityTargetCount > 0);
  assert.equal(report.evidence.wordpressGraphIdentity.postmetaReferences, report.shape.rowCount);
  assert.equal(
    report.evidence.wordpressGraphIdentity.stableRemotePostTargets,
    report.shape.graphIdentityTargetCount,
  );
  assert.equal(report.evidence.wordpressGraphIdentity.allPostmetaReferencesUseStableRemoteIdentity, true);
  assert.equal(report.evidence.wordpressGraphIdentity.graphIdentityBlockers, 0);
  assert.equal(report.evidence.journal.allJournalsIntegrityOk, true);
  assert.equal(report.evidence.redaction.durableJournalsContainNoRawValues, true);
  assert.equal(report.resourceLimits.memoryCeilingBytes, 32 * 1024 * 1024);
  assert.equal(report.evidence.resourceLimits.chunkWindowWithinMemoryCeiling, true);
  assert.equal(report.evidence.backpressure.producerQueueBounded, true);
  assert.equal(report.evidence.backpressure.queuePausedBeforeOverflow, true);
  assert.equal(report.evidence.backpressure.receiptCursorWithinQueueBudget, true);
  assert.equal(report.evidence.backpressure.queueHeadroomBytes, 31.5 * 1024 * 1024);
  assert.equal(report.evidence.recovery.successInspectionStatus, 'fully-updated-remote');
  assert.equal(report.evidence.recovery.preCommitFailureInspectionStatus, 'old-remote');
  assert.equal(report.evidence.recovery.partialCommitInspectionStatus, 'blocked-recovery');
  assert.equal(report.evidence.atomicGroup.requireAtomic, true);
  assert.equal(report.evidence.atomicGroup.preCommitFailureLeavesRemoteUnchanged, true);
  assert.equal(report.throughput.productionThroughput, 'not-claimed');
});

test('guarded benchmark refuses production throughput claims until production gaps are measured', () => {
  const report = smallBenchmark();

  assert.notEqual(report.executorCapabilities.fileReceipts, 'production-storage-receipts');
  assert.notEqual(report.executorCapabilities.productionAtomicCommit, 'production-atomic-group-commit');
  assert.equal(report.executorCapabilities.rowApply, 'per-row-apply-model');
  assert.equal(report.throughput.fastPathModeEnabled, false);
  assert.equal(report.throughput.productionThroughput, 'not-claimed');
  assert.equal(report.claims.productionThroughput.allowed, false);
  assert.equal(report.claims.productionThroughput.status, 'blocked');
  assert.equal(report.claims.productionThroughputDetails.throughput.productionThroughput, 'not-claimed');
  assert.equal(report.claims.productionThroughputDetails.shape.fileBytes, 3 * 1024 * 1024);
  assert.equal(report.claims.productionThroughputDetails.shape.chunkSizeBytes, 512 * 1024);
  assert.equal(report.claims.productionThroughputDetails.shape.rowCount, 16);
  assert.equal(
    report.claims.productionThroughputDetails.executorCapabilities.fileReceipts,
    'lab-file-journal-receipts',
  );
  assert.equal(
    report.claims.productionThroughputDetails.resourceLimits.memoryCeilingBytes,
    32 * 1024 * 1024,
  );
  assert.equal(
    report.claims.productionThroughputDetails.resourceLimits.maxBufferedUploadBytes,
    32 * 1024 * 1024,
  );
  assert.equal(report.claims.productionThroughputDetails.chunkWindowWithinMemoryCeiling, true);
  assert.equal(report.claims.productionThroughputDetails.queuePausedBeforeOverflow, true);
  assert.equal(report.claims.productionThroughputDetails.queueHeadroomBytes, 31.5 * 1024 * 1024);
  assert.equal(report.claims.productionThroughputDetails.queueBudgetBytes, 32 * 1024 * 1024);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.queueBudgetMatchesResourceCeiling, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorMatchesBackpressure, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorHeadroomMatchesQueueHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.backpressure.producerQueueBounded, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorWindowBytes, 512 * 1024);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorIsTerminalChunk, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMatchesChunkWindow, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorWithinMemoryCeiling, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMemoryHeadroomBytes, 31.5 * 1024 * 1024);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorHeadroomBytes, 31.5 * 1024 * 1024);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorHeadroomMatchesQueueHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorWithinQueueBudget, true);
  assert.equal(
    report.claims.productionThroughputDetails.receiptCursor.resourceKey,
    'file:wp-content/uploads/2026/05/catalog-export.bin',
  );
  assert.equal(
    report.claims.productionThroughputDetails.receiptCursorConsistency.matchesRecordedReceiptCount,
    true,
  );
  assert.equal(
    report.claims.productionThroughputDetails.receiptCursorConsistency.canResumeFromCursor,
    true,
  );
  assert.equal(
    report.claims.productionThroughputDetails.recovery.partialCommitInspectionStatus,
    'blocked-recovery',
  );
  assert.equal(
    report.claims.productionThroughputDetails.blockers.includes('production-memory-ceiling-not-measured'),
    false,
  );
  assert.equal(
    report.claims.productionThroughputDetails.atomicGroup.preCommitFailureLeavesRemoteUnchanged,
    true,
  );
  assert.ok(
    report.claims.productionThroughputDetails.blockers.includes(
      'production-atomic-group-commit-not-measured',
    ),
  );
  assert.equal(
    report.claims.productionThroughput.status === 'allowed' &&
      report.executorCapabilities.fileReceipts === 'production-storage-receipts' &&
      report.executorCapabilities.rowApply === 'production-batched-compare-and-swap',
    false,
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-atomic-group-commit-not-measured'),
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-storage-receipts-not-measured'),
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-row-batch-executor-not-measured'),
  );
  assert.ok(
    !report.claims.productionThroughput.blockers.includes('chunk-window-exceeds-memory-ceiling'),
  );
  assert.ok(
    !report.claims.productionThroughput.blockers.includes('missing-valid-receipt-cursor'),
  );
  assert.equal(report.results.preCommitFailure.remoteUnchanged, true);
  assert.equal(report.results.partialFailure.remoteUnchanged, false);
  assert.equal(report.results.successInspection.status, 'fully-updated-remote');
  assert.equal(report.results.successInspection.reason, 'Every planned target currently matches its journaled after hash.');
  assert.equal(report.results.successInspection.counts.new, report.shape.mutations);
  assert.equal(report.results.preCommitFailure.inspectionStatus, 'old-remote');
  assert.equal(report.results.partialFailure.inspectionStatus, 'blocked-recovery');
  assert.ok(Array.isArray(report.results.preCommitFailure.journalRecordTypes));
  assert.ok(report.results.preCommitFailure.journalRecordTypes.length > 0);
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-durable-chunk-receipts'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-live-remote-preconditions'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-partial-commit-recovery-evidence'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('wordpress-graph-identity-evidence-not-proven'));

  assert.throws(
    () => smallBenchmark({ claimProductionThroughput: true }),
    (error) =>
      error instanceof BenchmarkClaimError
      && error.code === 'PRODUCTION_THROUGHPUT_CLAIM_BLOCKED'
      && error.details.claim.status === 'blocked'
      && error.details.throughput.productionThroughput === 'not-claimed'
      && error.details.executorCapabilities.fileReceipts === 'lab-file-journal-receipts'
      && error.details.resourceLimits.memoryCeilingBytes === 32 * 1024 * 1024
      && error.details.productionThroughputDetails.receiptCursorWithinMemoryCeiling === true
      && error.details.productionThroughputDetails.receiptCursorMatchesChunkWindow === true
      && error.details.receiptCursor.chunkIndex === report.shape.chunkCount - 1
      && error.details.productionThroughputDetails.blockers.includes('production-storage-receipts-not-measured')
      && error.details.productionThroughputDetails.executorCapabilities.rowApply === 'per-row-apply-model'
      && error.details.blockers.includes('production-atomic-group-commit-not-measured'),
  );
});

test('production claim gate fails closed if benchmark evidence is tampered', () => {
  const report = smallBenchmark();

  const missingReceipt = clone(report);
  missingReceipt.evidence.chunkReceipts.recorded -= 1;
  assert.ok(productionThroughputBlockers(missingReceipt).includes('missing-durable-chunk-receipts'));
  assert.ok(missingReceipt.evidence.chunkReceipts.resumeCursor);

  const missingPrecondition = clone(report);
  missingPrecondition.evidence.preconditions.everyMutationHasLiveRemotePrecondition = false;
  assert.ok(productionThroughputBlockers(missingPrecondition).includes('missing-live-remote-preconditions'));

  const missingRecovery = clone(report);
  missingRecovery.evidence.recovery.partialCommitBlocksRecovery = false;
  assert.ok(
    productionThroughputBlockers(missingRecovery).includes('missing-partial-commit-recovery-evidence'),
  );

  const missingCursorHeadroom = clone(report);
  missingCursorHeadroom.evidence.chunkReceipts.resumeCursor.sizeBytes =
    missingCursorHeadroom.resourceLimits.memoryCeilingBytes + 1;
  assert.ok(
    productionThroughputBlockers(missingCursorHeadroom).includes(
      'receipt-cursor-memory-headroom-not-measured',
    ),
  );

  const missingReceiptCursor = clone(report);
  missingReceiptCursor.evidence.chunkReceipts.resumeCursor = {
    ...missingReceiptCursor.evidence.chunkReceipts.resumeCursor,
    chunkIndex: 0,
  };
  assert.ok(
    productionThroughputBlockers(missingReceiptCursor).includes('missing-valid-receipt-cursor'),
  );

  const wrongPlanReceiptCursor = clone(report);
  wrongPlanReceiptCursor.evidence.chunkReceipts.resumeCursor = {
    ...wrongPlanReceiptCursor.evidence.chunkReceipts.resumeCursor,
    planId: 'plan-other-benchmark',
  };
  assert.ok(
    productionThroughputBlockers(wrongPlanReceiptCursor).includes('missing-valid-receipt-cursor'),
  );

  const wrongResourceReceiptCursor = clone(report);
  wrongResourceReceiptCursor.evidence.chunkReceipts.resumeCursor = {
    ...wrongResourceReceiptCursor.evidence.chunkReceipts.resumeCursor,
    resourceKey: 'file:wp-content/uploads/2026/05/other.bin',
  };
  assert.ok(
    productionThroughputBlockers(wrongResourceReceiptCursor).includes('missing-valid-receipt-cursor'),
  );

  const wrongOffsetReceiptCursor = clone(report);
  wrongOffsetReceiptCursor.evidence.chunkReceipts.resumeCursor = {
    ...wrongOffsetReceiptCursor.evidence.chunkReceipts.resumeCursor,
    offsetBytes: 0,
  };
  assert.ok(
    productionThroughputBlockers(wrongOffsetReceiptCursor).includes('missing-valid-receipt-cursor'),
  );

  const missingReceiptKeyCursor = clone(report);
  delete missingReceiptKeyCursor.evidence.chunkReceipts.resumeCursor.receiptKey;
  assert.ok(
    productionThroughputBlockers(missingReceiptKeyCursor).includes('missing-valid-receipt-cursor'),
  );

  const invalidSizeReceiptCursor = clone(report);
  invalidSizeReceiptCursor.evidence.chunkReceipts.resumeCursor = {
    ...invalidSizeReceiptCursor.evidence.chunkReceipts.resumeCursor,
    sizeBytes: 0,
  };
  assert.ok(
    productionThroughputBlockers(invalidSizeReceiptCursor).includes('missing-valid-receipt-cursor'),
  );

  const oversizedReceiptCursor = clone(report);
  oversizedReceiptCursor.evidence.chunkReceipts.resumeCursor = {
    ...oversizedReceiptCursor.evidence.chunkReceipts.resumeCursor,
    sizeBytes: oversizedReceiptCursor.shape.chunkSizeBytes + 1,
  };
  assert.ok(
    productionThroughputBlockers(oversizedReceiptCursor).includes('missing-valid-receipt-cursor'),
  );

  const nonResumableReceiptCursor = clone(report);
  nonResumableReceiptCursor.evidence.chunkReceipts.cursorConsistency.canResumeFromCursor = false;
  assert.ok(
    productionThroughputBlockers(nonResumableReceiptCursor).includes('missing-valid-receipt-cursor'),
  );

  const mismatchedReceiptCountCursor = clone(report);
  mismatchedReceiptCountCursor.evidence.chunkReceipts.cursorConsistency.matchesRecordedReceiptCount = false;
  assert.ok(
    productionThroughputBlockers(mismatchedReceiptCountCursor).includes('missing-valid-receipt-cursor'),
  );

  const missingMemoryCeiling = clone(report);
  delete missingMemoryCeiling.resourceLimits.memoryCeilingBytes;
  assert.ok(
    productionThroughputBlockers(missingMemoryCeiling).includes('production-memory-ceiling-not-measured'),
  );

  const brokenWindowEvidence = clone(report);
  brokenWindowEvidence.evidence.resourceLimits.chunkWindowWithinMemoryCeiling = false;
  assert.ok(
    productionThroughputBlockers(brokenWindowEvidence).includes('chunk-window-exceeds-memory-ceiling'),
  );

  const oversizedQueueCursor = clone(report);
  oversizedQueueCursor.evidence.backpressure.receiptCursorWithinQueueBudget = false;
  assert.ok(
    productionThroughputBlockers(oversizedQueueCursor).includes(
      'receipt-cursor-exceeds-queue-budget',
    ),
  );

  const missingQueueBudget = clone(report);
  missingQueueBudget.evidence.backpressure.queueBudgetBytes = 0;
  assert.ok(
    productionThroughputBlockers(missingQueueBudget).includes('missing-queue-budget-evidence'),
  );

  const missingQueuePause = clone(report);
  missingQueuePause.evidence.backpressure.queuePausedBeforeOverflow = false;
  assert.ok(
    productionThroughputBlockers(missingQueuePause).includes(
      'queue-did-not-pause-before-overflow',
    ),
  );

  const mismatchedQueueBudget = clone(report);
  mismatchedQueueBudget.evidence.backpressure.queueBudgetBytes -= 1024;
  assert.ok(
    productionThroughputBlockers(mismatchedQueueBudget).includes(
      'queue-budget-does-not-match-resource-ceiling',
    ),
  );

  const mismatchedQueueCursor = clone(report);
  mismatchedQueueCursor.evidence.backpressure.receiptCursorBytes = 0;
  assert.ok(
    productionThroughputBlockers(mismatchedQueueCursor).includes(
      'receipt-cursor-backpressure-mismatch',
    ),
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueCursor).backpressureConsistency.receiptCursorMatchesBackpressure,
    false,
  );

  const mismatchedQueueHeadroom = clone(report);
  mismatchedQueueHeadroom.evidence.backpressure.queueHeadroomBytes = 0;
  assert.ok(
    productionThroughputBlockers(mismatchedQueueHeadroom).includes(
      'queue-headroom-backpressure-mismatch',
    ),
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueHeadroom).backpressureConsistency.receiptCursorHeadroomMatchesQueueHeadroom,
    false,
  );

  const mismatchedReceiptCursorHeadroom = clone(report);
  mismatchedReceiptCursorHeadroom.evidence.backpressure.queueHeadroomBytes = 0;
  assert.ok(
    productionThroughputBlockers(mismatchedReceiptCursorHeadroom).includes(
      'receipt-cursor-headroom-mismatch',
    ),
  );
  assert.equal(
    productionThroughputDetails(mismatchedReceiptCursorHeadroom).receiptCursorHeadroomMatchesQueueHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedReceiptCursorHeadroom).backpressureConsistency.receiptCursorHeadroomMatchesQueueHeadroom,
    false,
  );

  const oversizedChunkWindow = clone(report);
  oversizedChunkWindow.shape.chunkSizeBytes = oversizedChunkWindow.resourceLimits.maxBufferedUploadBytes + 1;
  assert.ok(
    productionThroughputBlockers(oversizedChunkWindow).includes('chunk-window-exceeds-memory-ceiling'),
  );

  const missingGraphIdentity = clone(report);
  missingGraphIdentity.evidence.wordpressGraphIdentity.allPostmetaReferencesUseStableRemoteIdentity = false;
  assert.ok(
    productionThroughputBlockers(missingGraphIdentity).includes('wordpress-graph-identity-evidence-not-proven'),
  );
});
