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
  assert.equal(report.claims.productionThroughputDetails.wordpressGraphIdentityPostmetaReferencesMatch, true);
  assert.equal(report.evidence.journal.allJournalsIntegrityOk, true);
  assert.equal(report.evidence.journal.successReceiptKindsGrouped, true);
  assert.equal(report.evidence.journal.successReceiptKindLedger.length, report.evidence.journal.successRecords);
  assert.equal(report.evidence.journal.successReceiptKindLedger[0].kind, 'chunk');
  assert.ok(report.evidence.journal.successReceiptKindLedger.some((entry) => entry.kind === 'other'));
  assert.equal(report.evidence.journal.successReceiptKindLedgerComplete, true);
  assert.equal(report.evidence.redaction.durableJournalsContainNoRawValues, true);
  assert.equal(report.resourceLimits.memoryCeilingBytes, 32 * 1024 * 1024);
  assert.equal(report.evidence.resourceLimits.chunkWindowWithinMemoryCeiling, true);
  assert.equal(report.evidence.backpressure.producerQueueBounded, true);
  assert.equal(report.evidence.backpressure.queueBudgetMatchesResourceCeiling, true);
  assert.equal(report.evidence.backpressure.queueBudgetVisible, true);
  assert.equal(report.evidence.backpressure.queueHeadroomVisible, true);
  assert.equal(report.evidence.backpressure.queuePausedBeforeOverflow, true);
  assert.equal(report.evidence.backpressure.receiptCursorWithinQueueBudget, true);
  assert.equal(report.evidence.backpressure.backpressureEvidenceComplete, true);
  assert.equal(report.evidence.backpressure.receiptCursorPauseFootprintComplete, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorPauseFootprintVisible, true);
  assert.equal(report.evidence.backpressure.receiptCursorQueueSlackBytes, 31.5 * 1024 * 1024);
  assert.equal(report.evidence.backpressure.receiptCursorMemoryHeadroomBytes, 31.5 * 1024 * 1024);
  assert.equal(report.evidence.backpressure.queueHeadroomBytes, 31.5 * 1024 * 1024);
  assert.deepEqual(report.claims.productionThroughputDetails.receiptCursorPauseFootprint, {
    receiptCursorBytes: 512 * 1024,
    queueBudgetBytes: 32 * 1024 * 1024,
    queueHeadroomBytes: 31.5 * 1024 * 1024,
    queueSlackBytes: 31.5 * 1024 * 1024,
    memoryCeilingBytes: 32 * 1024 * 1024,
    memoryHeadroomBytes: 31.5 * 1024 * 1024,
  });
  assert.equal(report.claims.productionThroughputDetails.backpressureAlignment.aligned, true);
  assert.equal(
    report.claims.productionThroughputDetails.backpressureAlignment.receiptCursorQueueSlackBytes,
    31.5 * 1024 * 1024,
  );
  assert.equal(report.evidence.parallelism.parallelismLimitsMeasured, true);
  assert.equal(report.evidence.parallelism.parallelismLimitsVisible, false);
  assert.equal(report.claims.productionThroughputDetails.parallelismLimitsVisible, false);
  assert.equal(report.claims.productionThroughputDetails.parallelismLimitsVisibleAndMeasured, false);
  assert.equal(report.evidence.recovery.successInspectionStatus, 'fully-updated-remote');
  assert.equal(report.evidence.recovery.preCommitFailureInspectionStatus, 'old-remote');
  assert.equal(report.evidence.recovery.partialCommitInspectionStatus, 'blocked-recovery');
  assert.equal(report.evidence.atomicGroup.requireAtomic, true);
  assert.equal(report.evidence.atomicGroup.preCommitFailureLeavesRemoteUnchanged, true);
  assert.equal(report.evidence.atomicGroup.productionAtomicCommitMeasured, false);
  assert.equal(report.evidence.atomicGroup.productionAtomicCommitVisible, false);
  assert.equal(report.evidence.atomicGroup.productionStorageReceiptsMeasured, false);
  assert.equal(report.evidence.atomicGroup.productionAtomicGroupMetadataVisible, false);
  assert.equal(report.evidence.atomicGroup.productionStorageReceiptsVisible, false);
  assert.equal(
    report.claims.productionThroughputDetails.atomicGroup.productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
    false,
  );
  assert.equal(report.claims.productionThroughputDetails.productionStorageReceiptsVisibleAndAtomicCommitVisible, false);
  assert.equal(
    report.claims.productionThroughputDetails.atomicGroup.productionStorageReceiptsVisibleAndAtomicCommitVisible,
    false,
  );
  assert.equal(report.evidence.atomicGroup.productionRowBatchExecutorVisible, false);
  assert.equal(report.claims.productionThroughputDetails.productionStorageReceiptsVisible, false);
  assert.equal(
    report.evidence.atomicGroup.productionStorageReceiptsMeasured,
    report.claims.productionThroughputDetails.atomicGroup.productionStorageReceiptsMeasured,
  );
  assert.equal(
    report.claims.productionThroughputDetails.atomicGroup.productionAtomicGroupMetadataProven,
    true,
  );
  assert.equal(
    report.claims.productionThroughputDetails.atomicGroup.productionAtomicGroupMetadataVisible,
    false,
  );
  assert.equal(
    report.evidence.atomicGroup.productionRowBatchExecutorMeasured,
    report.claims.productionThroughputDetails.atomicGroup.productionRowBatchExecutorMeasured,
  );
  assert.equal(report.claims.productionThroughputDetails.atomicGroup.productionRowBatchExecutorVisible, false);
  assert.equal(
    report.claims.productionThroughputDetails.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisible,
    false,
  );
  assert.equal(report.throughput.productionThroughput, 'not-claimed');
});

test('guarded benchmark blocks row-batch executor claims when the measured surface is not visible', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = false;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('production-row-batch-executor-not-visible'), true);
  assert.equal(blockers.includes('production-row-batch-executor-measured-not-proven'), false);
});

test('guarded benchmark blocks forged row-batch visibility without a measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = false;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('production-row-batch-executor-visible-without-measurement'), true);
  assert.equal(blockers.includes('production-row-batch-executor-not-visible'), false);
});

test('guarded benchmark blocks row-batch executor visibility when storage-receipts measurement is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisible, false);
  assert.equal(blockers.includes('production-row-batch-executor-visible-without-storage-receipts-measurement'), true);
  assert.equal(blockers.includes('production-row-batch-executor-without-storage-receipts'), true);
});

test('guarded benchmark blocks row-batch executor and storage-receipts paired visibility when atomic-commit visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = false;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(
    blockers.includes('production-row-batch-executor-visible-and-storage-receipts-visible-without-atomic-commit'),
    true,
  );
  assert.equal(blockers.includes('production-row-batch-executor-without-atomic-commit'), true);
});

test('guarded benchmark blocks forged atomic-group metadata visibility without a measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = false;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('production-atomic-group-metadata-visible-without-measurement'), true);
  assert.equal(blockers.includes('production-atomic-group-metadata-not-visible'), false);
});

test('guarded benchmark blocks forged queue-budget visibility without memory-ceiling visibility', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueBudgetVisible = true;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('queue-budget-visible-without-memory-ceiling-visibility'), true);
  assert.equal(blockers.includes('queue-budget-not-visible'), false);
});

test('guarded benchmark blocks forged memory-ceiling visibility without queue-budget visibility', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  tampered.evidence.backpressure.queueBudgetVisible = false;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('memory-ceiling-visible-without-queue-budget-visibility'), true);
  assert.equal(blockers.includes('queue-budget-visible-without-memory-ceiling-visibility'), false);
});

test('guarded benchmark blocks memory-ceiling visibility when queue-headroom visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  tampered.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(blockers.includes('memory-ceiling-visible-without-queue-headroom-visible'), true);
  assert.equal(blockers.includes('queue-headroom-visible-without-queue-budget-visibility'), false);
});

test('guarded benchmark blocks atomic-group metadata visibility when the atomic commit is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionAtomicCommitVisible = false;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('production-atomic-group-metadata-visible-without-atomic-commit'), true);
  assert.equal(blockers.includes('production-atomic-group-metadata-not-visible'), false);
});

test('guarded benchmark blocks forged storage-receipts and atomic-commit paired visibility without measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = false;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(
    blockers.includes('production-storage-receipts-visible-and-atomic-commit-visible-without-measurement'),
    true,
  );
  assert.equal(blockers.includes('production-storage-receipts-without-atomic-commit'), false);
});

test('guarded benchmark blocks storage-receipts and atomic-commit paired visibility when metadata is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(
    blockers.includes('production-storage-receipts-visible-and-atomic-commit-visible-without-metadata'),
    true,
  );
  assert.equal(blockers.includes('production-storage-receipts-without-atomic-group-metadata'), true);
});

test('guarded benchmark blocks storage-receipts and atomic-commit paired visibility when atomic-commit measurement is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = false;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(
    blockers.includes('production-storage-receipts-visible-and-atomic-commit-visible-without-atomic-commit-measurement'),
    true,
  );
  assert.equal(blockers.includes('production-storage-receipts-visible-and-atomic-commit-visible-without-measurement'), false);
});

test('guarded benchmark blocks forged atomic-commit visibility without a measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = false;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('production-atomic-group-commit-visible-without-measurement'), true);
  assert.equal(blockers.includes('production-atomic-group-commit-not-visible'), false);
});

test('guarded benchmark blocks non-blocked success inspection claims that still carry a reason', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.results.successInspection.claim.status = 'active';
  tampered.results.successInspection.claim.reason = 'still in progress';

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.successInspectionClaimReasonCanonical, false);
  assert.equal(blockers.includes('success-inspection-claim-reason-not-empty'), true);
  assert.equal(blockers.includes('success-inspection-claim-reason-not-canonical'), false);
});

test('guarded benchmark blocks parallelism visibility without a measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.parallelismLimitsVisibleAndMeasured, false);
  assert.equal(blockers.includes('production-parallelism-limits-visible-without-measurement'), true);
  assert.equal(blockers.includes('production-parallelism-limits-not-visible'), true);
});

test('guarded benchmark blocks parallelism visibility when the canonical limit surface is broken', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimits.chunkUpload = 3;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.parallelismLimitsVisible, false);
  assert.equal(details.parallelismLimitsCanonical, false);
  assert.equal(blockers.includes('production-parallelism-limits-visible-without-canonical'), true);
  assert.equal(blockers.includes('production-parallelism-limits-not-canonical'), true);
});

test('guarded benchmark blocks atomic-commit visibility when the metadata surface is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('production-atomic-group-commit-visible-without-metadata'), true);
  assert.equal(blockers.includes('production-atomic-group-commit-visible-without-measurement'), false);
});

test('guarded benchmark blocks row-batch executor visibility without atomic-commit visibility', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.atomicGroup.productionRowBatchExecutorVisibleAndAtomicCommitVisible, false);
  assert.equal(
    details.backpressureConsistency.productionRowBatchExecutorVisibleAndAtomicCommitVisible,
    false,
  );
  assert.equal(blockers.includes('production-row-batch-executor-without-atomic-commit'), true);
  assert.equal(blockers.includes('production-row-batch-executor-not-visible'), false);
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
  assert.equal(report.claims.productionThroughputDetails.queueHeadroomMeasured, true);
  assert.equal(report.claims.productionThroughputDetails.queueBudgetBytes, 32 * 1024 * 1024);
  assert.equal(report.claims.productionThroughputDetails.queueBudgetMatchesResourceCeiling, true);
  assert.equal(report.claims.productionThroughputDetails.queueBudgetVisible, true);
  assert.equal(report.claims.productionThroughputDetails.queueHeadroomVisible, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMemoryCeilingVisible, true);
  assert.equal(report.claims.productionThroughputDetails.queueHeadroomMatchesResourceHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.queueHeadroomMatchesMemoryHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.queueHeadroomWithinResourceCeiling, true);
  assert.equal(report.claims.productionThroughputDetails.queueHeadroomPositive, true);
  assert.equal(report.claims.productionThroughputDetails.queueBudgetPositive, true);
  assert.equal(report.claims.productionThroughputDetails.productionStorageReceiptsVisible, false);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMemoryCeilingMatchesQueueBudget, true);
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency
      .receiptCursorMemoryCeilingMatchesQueueBudgetVisible,
    true,
  );
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMemoryHeadroomPositive, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorQueueHeadroomPositive, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.queueBudgetMatchesResourceCeiling, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.queueBudgetVisible, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.queueHeadroomMatchesResourceHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.queueHeadroomMatchesMemoryHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.queueHeadroomWithinResourceCeiling, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.queueHeadroomPositive, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.queueBudgetPositive, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.queuePausedBeforeOverflow, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.productionAtomicGroupMetadataVisible, false);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.productionStorageReceiptsVisible, false);
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.queuePauseHasMeasuredReceiptCursorBackpressure,
    true,
  );
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.queuePauseHasMeasuredReceiptCursorQueueSlack,
    true,
  );
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
    true,
  );
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack,
    true,
  );
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure,
    true,
  );
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorWithinQueueBudget, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorMatchesBackpressure, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorHeadroomWithinQueueBudget, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorHeadroomMatchesQueueHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorHeadroomCoveredByQueueBudget, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorBackpressureBytes, 512 * 1024);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorBackpressureMeasured, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackBytes, 31.5 * 1024 * 1024);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackPositive, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackMatchesBackpressure, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackMatchesMemoryHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackMatchesResourceHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackWithinResourceHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackWithinQueueHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackWithinMemoryCeiling, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackMeasured, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackWithinQueueBudget, true);
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackWithinResourceHeadroom,
    true,
  );
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMemoryHeadroomWithinQueueBudget, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorBackpressureWithinQueueBudget, true);
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorBackpressureWithinResourceHeadroom,
    true,
  );
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.backpressureEvidenceComplete, true);
  assert.equal(report.claims.productionThroughputDetails.blockers.includes('backpressure-evidence-incomplete'), false);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorBackpressureWithinQueueHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.backpressure.producerQueueBounded, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorWindowBytes, 512 * 1024);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorIsTerminalChunk, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMatchesChunkWindow, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorWithinMemoryCeiling, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMemoryHeadroomBytes, 31.5 * 1024 * 1024);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMemoryCeilingBytes, 32 * 1024 * 1024);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMemoryCeilingVisible, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorMemoryHeadroomPositive, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorHeadroomMatchesResourceHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMemoryHeadroomWithinResourceHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorHeadroomCoveredByQueueBudget, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorMemoryHeadroomWithinResourceHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorHeadroomBytes, 31.5 * 1024 * 1024);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorHeadroomMatchesQueueHeadroom, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorWithinQueueBudget, true);
  assert.equal(report.claims.productionThroughputDetails.productionAtomicCommitMeasured, false);
  assert.equal(report.claims.productionThroughputDetails.productionStorageReceiptsMeasured, false);
  assert.equal(report.claims.productionThroughputDetails.productionRowBatchExecutorMeasured, false);
  assert.equal(report.claims.productionThroughputDetails.atomicGroup.productionAtomicGroupMetadataProven, true);
  assert.equal(report.claims.productionThroughputDetails.journalSuccessReceiptKindsGrouped, true);
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
    report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorMemoryCeilingBytes,
    32 * 1024 * 1024,
  );
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueBudgetBytes,
    32 * 1024 * 1024,
  );
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueHeadroomBytes,
    31.5 * 1024 * 1024,
  );
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorPauseFootprintComplete, true);
  assert.equal(
    report.claims.productionThroughputDetails.recovery.partialCommitInspectionStatus,
    'blocked-recovery',
  );
  assert.equal(report.claims.productionThroughputDetails.atomicGroup.productionAtomicCommitMeasured, false);
  assert.deepEqual(report.claims.productionThroughputDetails.parallelismLimits, {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  });
  assert.equal(report.claims.productionThroughputDetails.parallelismLimitsMeasured, true);
  assert.equal(report.claims.productionThroughputDetails.parallelismLimitsIntegral, true);
  assert.equal(report.claims.productionThroughputDetails.parallelismLimitsCanonical, true);
  assert.equal(report.claims.productionThroughputDetails.parallelismLimitsVisible, false);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorPauseFootprintComplete, true);
  assert.equal(
    report.claims.productionThroughputDetails.blockers.includes('production-memory-ceiling-not-measured'),
    false,
  );
  assert.equal(
    report.claims.productionThroughputDetails.blockers.includes('production-parallelism-limits-not-measured'),
    false,
  );
  assert.equal(
    report.claims.productionThroughputDetails.blockers.includes('production-parallelism-limits-not-integral'),
    false,
  );
  assert.equal(
    report.claims.productionThroughputDetails.blockers.includes('production-row-batch-executor-measured-not-proven'),
    true,
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
    !report.claims.productionThroughput.blockers.includes('production-atomic-group-metadata-not-proven'),
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-storage-receipts-not-measured'),
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-row-batch-executor-not-measured'),
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-capability-measurement-not-aligned'),
  );
  assert.ok(
    !report.claims.productionThroughput.blockers.includes('receipt-flushes-not-kind-scoped'),
  );
  assert.ok(
    !report.claims.productionThroughput.blockers.includes(
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    ),
  );
  assert.equal(
    report.claims.productionThroughput.blockers.filter(
      (blocker) => blocker === 'production-atomic-group-commit-not-measured',
    ).length,
    1,
  );
  assert.ok(
    !report.claims.productionThroughput.blockers.includes('chunk-window-exceeds-memory-ceiling'),
  );
  assert.ok(
    !report.claims.productionThroughput.blockers.includes('missing-valid-receipt-cursor'),
  );
  assert.ok(!report.claims.productionThroughput.blockers.includes('queue-budget-does-not-match-resource-ceiling'));
  const tamperedLedger = clone(report);
  tamperedLedger.evidence.journal.successReceiptKindLedgerComplete = false;
  assert.ok(productionThroughputBlockers(tamperedLedger).includes('receipt-ledger-kind-summary-not-proven'));

  const mismatchedLedger = clone(report);
  mismatchedLedger.evidence.journal.successReceiptKindLedger.pop();
  assert.ok(productionThroughputBlockers(mismatchedLedger).includes('receipt-ledger-kind-summary-mismatch'));

  const mismatchedAtomicGroupMetadata = clone(report);
  mismatchedAtomicGroupMetadata.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mismatchedAtomicGroupMetadata.evidence.atomicGroup.groupStatus = 'staged';
  assert.ok(
    productionThroughputBlockers(mismatchedAtomicGroupMetadata).includes(
      'production-atomic-group-metadata-not-proven',
    ),
  );

  const hiddenAtomicGroupMetadata = clone(report);
  hiddenAtomicGroupMetadata.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  hiddenAtomicGroupMetadata.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;
  assert.ok(
    productionThroughputBlockers(hiddenAtomicGroupMetadata).includes(
      'production-atomic-group-metadata-not-visible',
    ),
  );

  const hiddenStorageReceipts = clone(report);
  hiddenStorageReceipts.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  hiddenStorageReceipts.evidence.atomicGroup.productionStorageReceiptsVisible = false;
  assert.ok(
    productionThroughputBlockers(hiddenStorageReceipts).includes(
      'production-row-batch-executor-without-storage-receipts',
    ),
  );

  const tamperedQueueSlackSummary = clone(report);
  tamperedQueueSlackSummary.evidence.backpressure.receiptCursorQueueSlackBytes = null;
  assert.ok(
    productionThroughputBlockers(tamperedQueueSlackSummary).includes(
      'queue-pause-without-measured-receipt-cursor-queue-slack',
    ),
  );
  assert.equal(
    productionThroughputDetails(tamperedQueueSlackSummary).receiptCursorPauseFootprintComplete,
    false,
  );

  const tamperedQueueSlackAlignment = clone(report);
  tamperedQueueSlackAlignment.evidence.backpressure.receiptCursorQueueSlackBytes -= 1;
  assert.ok(
    productionThroughputBlockers(tamperedQueueSlackAlignment).includes(
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    ),
  );

  const missingAlignedBackpressureProof = clone(report);
  missingAlignedBackpressureProof.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure = false;
  assert.ok(
    productionThroughputBlockers(missingAlignedBackpressureProof).includes(
      'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
    ),
  );

  const fractionalParallelismLimits = clone(report);
  fractionalParallelismLimits.evidence.parallelism.parallelismLimits.chunkUpload = 3.5;
  assert.ok(
    productionThroughputBlockers(fractionalParallelismLimits).includes(
      'production-parallelism-limits-not-integral',
    ),
  );
  const fractionalParallelismDetails = clone(report);
  fractionalParallelismDetails.evidence.parallelism.parallelismLimits.chunkUpload = 3.5;
  assert.equal(
    productionThroughputDetails(fractionalParallelismDetails).parallelismLimitsIntegral,
    false,
  );

  const nonCanonicalParallelismLimits = clone(report);
  nonCanonicalParallelismLimits.evidence.parallelism.parallelismLimits.dbBatchPerTable = 3;
  assert.equal(
    productionThroughputDetails(nonCanonicalParallelismLimits).parallelismLimitsCanonical,
    false,
  );
  assert.ok(
    productionThroughputBlockers(nonCanonicalParallelismLimits).includes(
      'production-parallelism-limits-not-canonical',
    ),
  );

  const mismatchedCeilingAndBudget = clone(report);
  mismatchedCeilingAndBudget.evidence.backpressure.queueBudgetBytes = 31 * 1024 * 1024;
  assert.ok(
    productionThroughputBlockers(mismatchedCeilingAndBudget).includes(
      'queue-memory-ceiling-does-not-match-queue-budget',
    ),
  );

  const incompletePauseFootprint = clone(report);
  incompletePauseFootprint.evidence.backpressure.receiptCursorPauseFootprintComplete = false;
  assert.ok(
    productionThroughputBlockers(incompletePauseFootprint).includes(
      'queue-pause-footprint-not-proven',
    ),
  );
  assert.equal(report.results.preCommitFailure.remoteUnchanged, true);
  assert.equal(report.results.partialFailure.remoteUnchanged, false);
  assert.equal(report.results.successInspection.status, 'fully-updated-remote');
  assert.equal(report.results.successInspection.reason, 'Every planned target currently matches its journaled after hash.');
  assert.equal(report.results.successInspection.counts.new, report.shape.mutations);
  assert.equal(report.claims.productionThroughputDetails.successInspectionCountsNewMatchesMutations, true);
  assert.equal(report.claims.productionThroughputDetails.successInspectionClaimStatus, 'none');
  assert.equal(report.claims.productionThroughputDetails.successInspectionClaimReason, null);
  assert.equal(report.claims.productionThroughputDetails.successInspectionClaimReasonTrimmed, null);
  assert.equal(report.claims.productionThroughputDetails.successInspectionClaimReasonProven, true);
  assert.equal(report.claims.productionThroughputDetails.successInspectionClaimMatchesInspectionStatus, true);
  assert.equal(report.claims.productionThroughputDetails.successInspectionClaimCanonical, true);
  assert.equal(report.claims.productionThroughputDetails.successInspectionClaimReasonCanonical, true);
  assert.equal(report.results.preCommitFailure.inspectionStatus, 'old-remote');
  assert.equal(report.results.partialFailure.inspectionStatus, 'blocked-recovery');
  assert.ok(Array.isArray(report.results.preCommitFailure.journalRecordTypes));
  assert.ok(report.results.preCommitFailure.journalRecordTypes.length > 0);
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-durable-chunk-receipts'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-live-remote-preconditions'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-partial-commit-recovery-evidence'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('wordpress-graph-identity-evidence-not-proven'));

  const interleavedJournalKinds = clone(report);
  interleavedJournalKinds.evidence.journal.successRecordTypes = [
    'apply-staged',
    'chunk-receipt',
    'journal-opened',
    'target-planned',
    'dependencies-validated',
    'recovery-state',
  ];
  assert.equal(
    productionThroughputDetails(interleavedJournalKinds).journalSuccessReceiptKindsGrouped,
    false,
  );
  assert.ok(
    productionThroughputBlockers(interleavedJournalKinds).includes('receipt-flushes-not-kind-scoped'),
  );

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
      && error.details.productionThroughputDetails.productionStorageReceiptsMeasured === false
      && error.details.productionThroughputDetails.parallelismLimits.chunkUpload === 4
      && error.details.productionThroughputDetails.parallelismLimits.fileHashing === 2
      && error.details.productionThroughputDetails.parallelismLimits.dbBatchPerTable === 2
      && error.details.receiptCursor.chunkIndex === report.shape.chunkCount - 1
      && error.details.productionThroughputDetails.blockers.includes('production-storage-receipts-not-measured')
      && error.details.productionThroughputDetails.executorCapabilities.rowApply === 'per-row-apply-model'
      && error.details.productionThroughputDetails.blockers.includes('production-capability-measurement-not-aligned')
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

  const mismatchedAtomicCommitCapability = clone(report);
  mismatchedAtomicCommitCapability.executorCapabilities.productionAtomicCommit =
    'unsupported-atomic-commit';
  assert.ok(
    productionThroughputBlockers(mismatchedAtomicCommitCapability).includes(
      'production-atomic-group-commit-not-measured',
    ),
  );

  const mismatchedStorageReceiptEvidence = clone(report);
  mismatchedStorageReceiptEvidence.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  assert.ok(
    productionThroughputBlockers(mismatchedStorageReceiptEvidence).includes(
      'production-storage-receipts-evidence-not-aligned',
    ),
  );

  const hiddenStorageReceiptEvidence = clone(report);
  hiddenStorageReceiptEvidence.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  hiddenStorageReceiptEvidence.evidence.atomicGroup.productionStorageReceiptsVisible = false;
  assert.ok(
    productionThroughputBlockers(hiddenStorageReceiptEvidence).includes(
      'production-storage-receipts-not-visible',
    ),
  );

  const visibleStorageReceiptWithoutMeasurement = clone(report);
  visibleStorageReceiptWithoutMeasurement.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  assert.ok(
    productionThroughputBlockers(visibleStorageReceiptWithoutMeasurement).includes(
      'production-storage-receipts-visible-without-measurement',
    ),
  );

  const visibleStorageReceiptWithoutAtomicGroupMetadata = clone(report);
  visibleStorageReceiptWithoutAtomicGroupMetadata.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  visibleStorageReceiptWithoutAtomicGroupMetadata.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;
  visibleStorageReceiptWithoutAtomicGroupMetadata.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  visibleStorageReceiptWithoutAtomicGroupMetadata.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  assert.equal(
    productionThroughputDetails(visibleStorageReceiptWithoutAtomicGroupMetadata).atomicGroup
      .productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
    false,
  );
  assert.ok(
    productionThroughputBlockers(visibleStorageReceiptWithoutAtomicGroupMetadata).includes(
      'production-storage-receipts-without-atomic-group-metadata',
    ),
  );

  const visibleStorageReceiptWithoutAtomicCommit = clone(report);
  visibleStorageReceiptWithoutAtomicCommit.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  visibleStorageReceiptWithoutAtomicCommit.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  visibleStorageReceiptWithoutAtomicCommit.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  visibleStorageReceiptWithoutAtomicCommit.evidence.atomicGroup.productionAtomicCommitVisible = false;
  assert.equal(
    productionThroughputDetails(visibleStorageReceiptWithoutAtomicCommit).atomicGroup
      .productionStorageReceiptsVisibleAndAtomicCommitVisible,
    false,
  );
  assert.ok(
    productionThroughputBlockers(visibleStorageReceiptWithoutAtomicCommit).includes(
      'production-storage-receipts-without-atomic-commit',
    ),
  );

  const visibleAtomicCommitWithoutMeasurement = clone(report);
  visibleAtomicCommitWithoutMeasurement.evidence.atomicGroup.productionAtomicCommitVisible = true;
  assert.ok(
    productionThroughputBlockers(visibleAtomicCommitWithoutMeasurement).includes(
      'production-atomic-group-commit-visible-without-measurement',
    ),
  );

  const visibleRowBatchWithoutAtomicGroupMetadata = clone(report);
  visibleRowBatchWithoutAtomicGroupMetadata.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  visibleRowBatchWithoutAtomicGroupMetadata.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;
  visibleRowBatchWithoutAtomicGroupMetadata.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  visibleRowBatchWithoutAtomicGroupMetadata.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  assert.ok(
    productionThroughputBlockers(visibleRowBatchWithoutAtomicGroupMetadata).includes(
      'production-row-batch-executor-without-atomic-group-metadata',
    ),
  );

  const mismatchedRowBatchExecutorEvidence = clone(report);
  mismatchedRowBatchExecutorEvidence.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  assert.ok(
    productionThroughputBlockers(mismatchedRowBatchExecutorEvidence).includes(
      'production-row-batch-executor-evidence-not-aligned',
    ),
  );

  const mismatchedSuccessRecoveryStatus = clone(report);
  mismatchedSuccessRecoveryStatus.evidence.recovery.successInspectionStatus = 'blocked-recovery';
  assert.ok(
    productionThroughputBlockers(mismatchedSuccessRecoveryStatus).includes(
      'success-recovery-status-mismatch',
    ),
  );

  const mismatchedPreCommitRecoveryStatus = clone(report);
  mismatchedPreCommitRecoveryStatus.evidence.recovery.preCommitFailureInspectionStatus = 'blocked-recovery';
  assert.ok(
    productionThroughputBlockers(mismatchedPreCommitRecoveryStatus).includes(
      'pre-commit-recovery-status-mismatch',
    ),
  );

  const mismatchedPartialRecoveryStatus = clone(report);
  mismatchedPartialRecoveryStatus.evidence.recovery.partialCommitInspectionStatus = 'old-remote';
  assert.ok(
    productionThroughputBlockers(mismatchedPartialRecoveryStatus).includes(
      'partial-commit-recovery-status-mismatch',
    ),
  );

  const mismatchedSuccessInspectionCounts = clone(report);
  mismatchedSuccessInspectionCounts.results.successInspection.counts.new -= 1;
  assert.ok(
    productionThroughputBlockers(mismatchedSuccessInspectionCounts).includes(
      'success-inspection-counts-not-aligned',
    ),
  );
  assert.equal(
    productionThroughputDetails(mismatchedSuccessInspectionCounts).successInspectionCountsNewMatchesMutations,
    false,
  );

  const blockedSuccessClaimWithoutReason = clone(report);
  blockedSuccessClaimWithoutReason.results.successInspection.claim = {
    ...blockedSuccessClaimWithoutReason.results.successInspection.claim,
    status: 'blocked',
    reason: '',
  };
  assert.ok(
    productionThroughputBlockers(blockedSuccessClaimWithoutReason).includes(
      'success-inspection-claim-reason-not-proven',
    ),
  );
  assert.equal(
    productionThroughputDetails(blockedSuccessClaimWithoutReason).successInspectionClaimReasonProven,
    false,
  );

  const blockedSuccessClaimWithWhitespaceReason = clone(report);
  blockedSuccessClaimWithWhitespaceReason.results.successInspection.claim = {
    ...blockedSuccessClaimWithWhitespaceReason.results.successInspection.claim,
    status: 'blocked',
    reason: '   ',
  };
  assert.ok(
    productionThroughputBlockers(blockedSuccessClaimWithWhitespaceReason).includes(
      'success-inspection-claim-reason-not-proven',
    ),
  );
  assert.equal(
    productionThroughputDetails(blockedSuccessClaimWithWhitespaceReason).successInspectionClaimReasonProven,
    false,
  );

  const contradictoryBlockedSuccessClaim = clone(report);
  contradictoryBlockedSuccessClaim.results.successInspection.claim = {
    ...contradictoryBlockedSuccessClaim.results.successInspection.claim,
    status: 'blocked',
    reason: 'blocked by local override',
  };
  assert.ok(
    productionThroughputBlockers(contradictoryBlockedSuccessClaim).includes(
      'success-inspection-claim-status-mismatch',
    ),
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

  const missingParallelismLimits = clone(report);
  delete missingParallelismLimits.evidence.parallelism.parallelismLimits.chunkUpload;
  assert.ok(
    productionThroughputBlockers(missingParallelismLimits).includes('production-parallelism-limits-not-measured'),
  );

  const removedParallelismLimits = clone(report);
  delete removedParallelismLimits.evidence.parallelism.parallelismLimits;
  assert.ok(
    productionThroughputBlockers(removedParallelismLimits).includes('production-parallelism-limits-not-measured'),
  );

  const invalidParallelismLimits = clone(report);
  invalidParallelismLimits.evidence.parallelism.parallelismLimits.dbBatchPerTable = 0;
  assert.ok(
    productionThroughputBlockers(invalidParallelismLimits).includes('production-parallelism-limits-not-measured'),
  );

  const hiddenParallelismLimits = clone(report);
  hiddenParallelismLimits.evidence.parallelism.parallelismLimitsVisible = false;
  assert.equal(
    productionThroughputDetails(hiddenParallelismLimits).parallelismLimitsVisible,
    false,
  );
  assert.equal(
    productionThroughputDetails(hiddenParallelismLimits).atomicGroup.parallelismLimitsVisible,
    false,
  );

  const visibleParallelismLimitsWithoutMeasurement = clone(report);
  visibleParallelismLimitsWithoutMeasurement.claims.productionThroughputDetails.parallelismLimitsVisible = true;
  visibleParallelismLimitsWithoutMeasurement.evidence.parallelism.parallelismLimitsVisible = true;
  visibleParallelismLimitsWithoutMeasurement.evidence.parallelism.parallelismLimitsMeasured = false;
  assert.ok(
    productionThroughputBlockers(visibleParallelismLimitsWithoutMeasurement).includes(
      'production-parallelism-limits-visible-without-measurement',
    ),
  );

  const queueHeadroomVisibleWithoutQueueBudget = clone(report);
  queueHeadroomVisibleWithoutQueueBudget.evidence.backpressure.queueHeadroomVisible = true;
  queueHeadroomVisibleWithoutQueueBudget.evidence.backpressure.queueBudgetVisible = false;
  assert.ok(
    productionThroughputBlockers(queueHeadroomVisibleWithoutQueueBudget).includes(
      'queue-headroom-visible-without-queue-budget-visibility',
    ),
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

  const oversizedBackpressureHeadroom = clone(report);
  oversizedBackpressureHeadroom.evidence.backpressure.receiptCursorBytes =
    oversizedBackpressureHeadroom.evidence.backpressure.queueHeadroomBytes + 1;
  assert.ok(
    productionThroughputBlockers(oversizedBackpressureHeadroom).includes(
      'receipt-cursor-exceeds-queue-headroom',
    ),
  );
  assert.equal(
    productionThroughputDetails(oversizedBackpressureHeadroom).backpressureConsistency.receiptCursorBackpressureWithinQueueHeadroom,
    false,
  );

  const missingQueueBudget = clone(report);
  missingQueueBudget.evidence.backpressure.queueBudgetBytes = 0;
  assert.ok(
    productionThroughputBlockers(missingQueueBudget).includes('missing-queue-budget-evidence'),
  );
  assert.equal(
    productionThroughputDetails(missingQueueBudget).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingQueueBudget).backpressureConsistency.receiptCursorMemoryCeilingMatchesQueueBudget,
    false,
  );

  const missingVisibleMemoryCeiling = clone(report);
  missingVisibleMemoryCeiling.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;
  assert.ok(
    productionThroughputBlockers(missingVisibleMemoryCeiling).includes(
      'queue-pause-without-visible-memory-ceiling',
    ),
  );
  assert.equal(
    productionThroughputDetails(missingVisibleMemoryCeiling).receiptCursorMemoryCeilingVisible,
    false,
  );

  const memoryHeadroomOutsideQueueBudget = clone(report);
  memoryHeadroomOutsideQueueBudget.evidence.backpressure.receiptCursorMemoryHeadroomBytes =
    memoryHeadroomOutsideQueueBudget.evidence.backpressure.queueBudgetBytes + 1;
  assert.ok(
    productionThroughputBlockers(memoryHeadroomOutsideQueueBudget).includes(
      'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
    ),
  );
  assert.equal(
    productionThroughputDetails(memoryHeadroomOutsideQueueBudget).receiptCursorMemoryHeadroomWithinQueueBudget,
    false,
  );

  const missingQueuePause = clone(report);
  missingQueuePause.evidence.backpressure.queuePausedBeforeOverflow = false;
  assert.ok(
    productionThroughputBlockers(missingQueuePause).includes(
      'queue-did-not-pause-before-overflow',
    ),
  );
  assert.equal(
    productionThroughputDetails(missingQueuePause).backpressureConsistency.queuePausedBeforeOverflow,
    false,
  );

  const slackWithoutQueuePause = clone(report);
  slackWithoutQueuePause.evidence.backpressure.queuePausedBeforeOverflow = false;
  assert.ok(
    productionThroughputBlockers(slackWithoutQueuePause).includes(
      'receipt-cursor-queue-slack-without-queue-pause',
    ),
  );
  assert.equal(
    productionThroughputDetails(slackWithoutQueuePause).backpressureConsistency.receiptCursorQueueSlackMeasured,
    true,
  );

  const backpressureWithoutQueuePause = clone(report);
  backpressureWithoutQueuePause.evidence.backpressure.queuePausedBeforeOverflow = false;
  delete backpressureWithoutQueuePause.evidence.backpressure.receiptCursorQueueSlackBytes;
  assert.ok(
    productionThroughputBlockers(backpressureWithoutQueuePause).includes(
      'receipt-cursor-backpressure-without-queue-pause',
    ),
  );
  assert.equal(
    productionThroughputDetails(backpressureWithoutQueuePause).backpressureConsistency.queuePausedBeforeOverflow,
    false,
  );

  const brokenBackpressureAlignment = clone(report);
  brokenBackpressureAlignment.evidence.backpressure.receiptCursorQueueSlackBytes -= 1024;
  assert.ok(
    productionThroughputBlockers(brokenBackpressureAlignment).includes(
      'backpressure-alignment-not-proven',
    ),
  );
  assert.equal(
    productionThroughputDetails(brokenBackpressureAlignment).backpressureAlignment.aligned,
    false,
  );

  const unmeasuredQueueHeadroom = clone(report);
  unmeasuredQueueHeadroom.evidence.backpressure.queueHeadroomMeasured = false;
  assert.ok(
    productionThroughputBlockers(unmeasuredQueueHeadroom).includes(
      'queue-pause-without-measured-queue-headroom-proof',
    ),
  );
  assert.equal(
    productionThroughputDetails(unmeasuredQueueHeadroom).backpressureConsistency.queueHeadroomMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(unmeasuredQueueHeadroom).backpressureConsistency.queuePauseHasMeasuredReceiptCursorQueueSlack,
    false,
  );

  const pausedWithoutMeasuredBackpressure = clone(report);
  pausedWithoutMeasuredBackpressure.evidence.backpressure.queuePausedBeforeOverflow = true;
  delete pausedWithoutMeasuredBackpressure.evidence.backpressure.queuePauseHasMeasuredReceiptCursorBackpressure;
  assert.ok(
    productionThroughputBlockers(pausedWithoutMeasuredBackpressure).includes(
      'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure',
    ),
  );
  assert.equal(
    productionThroughputDetails(pausedWithoutMeasuredBackpressure).backpressureConsistency.queuePauseHasMeasuredReceiptCursorBackpressure,
    false,
  );
  assert.equal(
    productionThroughputDetails(pausedWithoutMeasuredBackpressure).backpressureConsistency.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure,
    false,
  );
  assert.ok(
    productionThroughputBlockers(pausedWithoutMeasuredBackpressure).includes(
      'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure',
    ),
  );

  const mismatchedQueueBudget = clone(report);
  mismatchedQueueBudget.evidence.backpressure.queueBudgetBytes -= 1024;
  assert.ok(
    productionThroughputBlockers(mismatchedQueueBudget).includes(
      'queue-budget-does-not-match-resource-ceiling',
    ),
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueBudget).queueBudgetMatchesResourceCeiling,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueBudget).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const tamperedSuccessInspectionClaim = clone(report);
  tamperedSuccessInspectionClaim.results.successInspection.claim = {
    status: 'blocked',
    reason: 'tampered',
    counts: tamperedSuccessInspectionClaim.results.successInspection.counts,
    claim: null,
  };
  assert.equal(
    productionThroughputDetails(tamperedSuccessInspectionClaim).successInspectionClaimMatchesInspectionStatus,
    false,
  );
  assert.equal(
    productionThroughputDetails(tamperedSuccessInspectionClaim).successInspectionClaimStatus,
    'blocked',
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
  assert.equal(
    productionThroughputDetails(mismatchedQueueCursor).backpressureConsistency.receiptCursorBackpressureBytes,
    0,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueCursor).backpressureConsistency.receiptCursorBackpressureWithinQueueHeadroom,
    true,
  );

  const missingQueueCursor = clone(report);
  missingQueueCursor.evidence.backpressure.receiptCursorBytes = null;
  assert.ok(
    productionThroughputBlockers(missingQueueCursor).includes(
      'receipt-cursor-backpressure-not-measured',
    ),
  );
  assert.equal(
    productionThroughputDetails(missingQueueCursor).backpressureConsistency.receiptCursorMatchesBackpressure,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingQueueCursor).backpressureConsistency.receiptCursorBackpressureMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingQueueCursor).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );
  assert.ok(productionThroughputBlockers(missingQueueCursor).includes('backpressure-evidence-incomplete'));

  const mismatchedQueueSlack = clone(report);
  mismatchedQueueSlack.evidence.backpressure.receiptCursorQueueSlackBytes =
    mismatchedQueueSlack.resourceLimits.memoryCeilingBytes
    - mismatchedQueueSlack.evidence.chunkReceipts.resumeCursor.sizeBytes
    + 1;
  assert.ok(
    productionThroughputBlockers(mismatchedQueueSlack).includes('backpressure-evidence-incomplete'),
  );
  assert.ok(
    productionThroughputBlockers(mismatchedQueueSlack).includes(
      'queue-pause-without-consistent-receipt-cursor-slack',
    ),
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlack).backpressureConsistency.receiptCursorQueueSlackMatchesBackpressure,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlack).backpressureConsistency.receiptCursorQueueSlackMatchesMemoryHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlack).backpressureConsistency.receiptCursorQueueSlackMatchesQueueHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlack).backpressureConsistency.receiptCursorQueueSlackMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlack).backpressureConsistency.receiptCursorQueueSlackWithinResourceHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlack).backpressureConsistency.receiptCursorQueueSlackWithinQueueHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlack).backpressureConsistency.receiptCursorQueueSlackWithinMemoryCeiling,
    true,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlack).backpressureConsistency.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlack).backpressureConsistency.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
    false,
  );
  assert.ok(
    productionThroughputBlockers(mismatchedQueueSlack).includes(
      'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack',
    ),
  );

  const zeroQueueSlack = clone(report);
  zeroQueueSlack.evidence.backpressure.receiptCursorQueueSlackBytes = 0;
  zeroQueueSlack.evidence.backpressure.queuePausedBeforeOverflow = true;
  assert.ok(
    productionThroughputBlockers(zeroQueueSlack).includes(
      'receipt-cursor-queue-slack-not-positive',
    ),
  );
  assert.equal(
    productionThroughputDetails(zeroQueueSlack).backpressureConsistency.receiptCursorQueueSlackPositive,
    false,
  );
  assert.equal(
    productionThroughputDetails(zeroQueueSlack).backpressureConsistency.queuePauseHasMeasuredReceiptCursorQueueSlack,
    false,
  );

  const oversizedQueueHeadroomSlack = clone(report);
  oversizedQueueHeadroomSlack.evidence.backpressure.receiptCursorQueueSlackBytes =
    oversizedQueueHeadroomSlack.evidence.backpressure.queueHeadroomBytes + 1;
  assert.ok(
    productionThroughputBlockers(oversizedQueueHeadroomSlack).includes(
      'queue-pause-without-queue-headroom-safe-receipt-cursor-slack',
    ),
  );
  assert.equal(
    productionThroughputDetails(oversizedQueueHeadroomSlack).backpressureConsistency.receiptCursorQueueSlackWithinQueueHeadroom,
    false,
  );

  const missingQueueSlack = clone(report);
  delete missingQueueSlack.evidence.backpressure.receiptCursorQueueSlackBytes;
  assert.ok(
    productionThroughputBlockers(missingQueueSlack).includes(
      'receipt-cursor-queue-slack-not-measured',
    ),
  );
  assert.equal(
    productionThroughputDetails(missingQueueSlack).backpressureConsistency.receiptCursorQueueSlackMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingQueueSlack).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const pausedWithoutMeasuredQueueSlack = clone(report);
  pausedWithoutMeasuredQueueSlack.evidence.backpressure.receiptCursorQueueSlackBytes = null;
  pausedWithoutMeasuredQueueSlack.evidence.backpressure.queuePausedBeforeOverflow = true;
  assert.ok(
    productionThroughputBlockers(pausedWithoutMeasuredQueueSlack).includes(
      'receipt-cursor-queue-slack-not-measured',
    ),
  );
  assert.ok(
    productionThroughputBlockers(pausedWithoutMeasuredQueueSlack).includes(
      'queue-pause-without-consistent-receipt-cursor-slack',
    ),
  );
  assert.equal(
    productionThroughputDetails(pausedWithoutMeasuredQueueSlack).backpressureConsistency.receiptCursorQueueSlackMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(pausedWithoutMeasuredQueueSlack).backpressureConsistency.queuePauseHasMeasuredReceiptCursorQueueSlack,
    false,
  );
  assert.equal(
    productionThroughputDetails(pausedWithoutMeasuredQueueSlack).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );
  assert.equal(
    productionThroughputDetails(pausedWithoutMeasuredQueueSlack).backpressureConsistency.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack,
    false,
  );
  assert.equal(
    productionThroughputDetails(pausedWithoutMeasuredQueueSlack).backpressureConsistency.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
    false,
  );

  const missingMeasuredQueueSlackProof = clone(report);
  delete missingMeasuredQueueSlackProof.evidence.backpressure.queuePauseHasMeasuredReceiptCursorQueueSlack;
  assert.ok(
    productionThroughputBlockers(missingMeasuredQueueSlackProof).includes(
      'queue-pause-without-measured-receipt-cursor-queue-slack-proof',
    ),
  );

  const missingMemoryCeilingProof = clone(report);
  missingMemoryCeilingProof.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudget = false;
  assert.equal(
    productionThroughputDetails(missingMemoryCeilingProof).backpressureConsistency
      .receiptCursorMemoryCeilingMatchesQueueBudget,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingMemoryCeilingProof).backpressureConsistency
      .receiptCursorMemoryCeilingMatchesQueueBudgetVisible,
    false,
  );
  assert.ok(
    productionThroughputBlockers(missingMemoryCeilingProof).includes(
      'queue-pause-without-memory-ceiling-matching-queue-budget-proof',
    ),
  );

  const spoofedQueueSlackProof = clone(report);
  spoofedQueueSlackProof.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;
  assert.ok(
    productionThroughputBlockers(spoofedQueueSlackProof).includes(
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
    ),
  );

  const spoofedQueueSlackAlignment = clone(report);
  spoofedQueueSlackAlignment.evidence.backpressure.receiptCursorQueueSlackBytes = null;
  spoofedQueueSlackAlignment.evidence.backpressure.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack = false;
  assert.ok(
    productionThroughputBlockers(spoofedQueueSlackAlignment).includes(
      'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack-proof',
    ),
  );
  assert.equal(
    productionThroughputDetails(spoofedQueueSlackAlignment).backpressureConsistency.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
    false,
  );
  assert.equal(
    productionThroughputDetails(spoofedQueueSlackAlignment).backpressureConsistency.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack,
    false,
  );
  const spoofedMeasuredAndAlignedQueueSlack = clone(report);
  spoofedMeasuredAndAlignedQueueSlack.evidence.backpressure.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack = false;
  assert.equal(
    productionThroughputDetails(spoofedMeasuredAndAlignedQueueSlack).backpressureConsistency.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
    false,
  );
  assert.ok(
    productionThroughputBlockers(spoofedMeasuredAndAlignedQueueSlack).includes(
      'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack-proof',
    ),
  );
  assert.equal(
    productionThroughputDetails(spoofedMeasuredAndAlignedQueueSlack).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const inconsistentMeasuredAndAlignedQueueSlack = clone(report);
  inconsistentMeasuredAndAlignedQueueSlack.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = true;
  inconsistentMeasuredAndAlignedQueueSlack.evidence.backpressure.queueHeadroomMeasured = false;
  assert.ok(
    productionThroughputBlockers(inconsistentMeasuredAndAlignedQueueSlack).includes(
      'queue-pause-without-consistent-measured-and-aligned-receipt-cursor-queue-slack',
    ),
  );
  assert.equal(
    productionThroughputDetails(inconsistentMeasuredAndAlignedQueueSlack).backpressureConsistency
      .queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
    false,
  );

  const spoofedBackpressureAlignment = clone(report);
  spoofedBackpressureAlignment.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure = false;
  assert.ok(
    productionThroughputBlockers(spoofedBackpressureAlignment).includes(
      'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
    ),
  );
  assert.equal(
    productionThroughputDetails(spoofedBackpressureAlignment).backpressureConsistency.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure,
    false,
  );
  assert.equal(
    productionThroughputDetails(spoofedBackpressureAlignment).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const spoofedMeasuredAndAlignedBackpressure = clone(report);
  delete spoofedMeasuredAndAlignedBackpressure.evidence.backpressure.queuePauseHasMeasuredReceiptCursorQueueSlack;
  spoofedMeasuredAndAlignedBackpressure.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure = true;
  assert.ok(
    productionThroughputBlockers(spoofedMeasuredAndAlignedBackpressure).includes(
      'queue-pause-without-consistent-measured-and-aligned-receipt-cursor-backpressure',
    ),
  );
  assert.equal(
    productionThroughputDetails(spoofedMeasuredAndAlignedBackpressure).backpressureConsistency
      .queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure,
    true,
  );

  const missingMeasuredBackpressureBit = clone(report);
  delete missingMeasuredBackpressureBit.evidence.backpressure.queuePauseHasMeasuredReceiptCursorBackpressure;
  assert.ok(
    productionThroughputBlockers(missingMeasuredBackpressureBit).includes(
      'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure',
    ),
  );
  assert.equal(
    productionThroughputDetails(missingMeasuredBackpressureBit).backpressureConsistency
      .queuePauseHasMeasuredReceiptCursorBackpressure,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingMeasuredBackpressureBit).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const unsafePausedQueueSlack = clone(report);
  unsafePausedQueueSlack.evidence.backpressure.receiptCursorQueueSlackBytes =
    unsafePausedQueueSlack.resourceLimits.memoryCeilingBytes + 1;
  unsafePausedQueueSlack.evidence.backpressure.queuePausedBeforeOverflow = true;
  assert.ok(
    productionThroughputBlockers(unsafePausedQueueSlack).includes(
      'queue-pause-without-memory-safe-receipt-cursor-slack',
    ),
  );
  assert.equal(
    productionThroughputDetails(unsafePausedQueueSlack).backpressureConsistency.receiptCursorQueueSlackWithinMemoryCeiling,
    false,
  );
  assert.equal(
    productionThroughputBlockers(unsafePausedQueueSlack).includes(
      'queue-pause-without-backpressure-aligned-receipt-cursor-slack',
    ),
    true,
  );

  const unpausedWithoutMeasuredQueueSlack = clone(report);
  unpausedWithoutMeasuredQueueSlack.evidence.backpressure.receiptCursorQueueSlackBytes = null;
  unpausedWithoutMeasuredQueueSlack.evidence.backpressure.queuePausedBeforeOverflow = false;
  assert.ok(
    productionThroughputBlockers(unpausedWithoutMeasuredQueueSlack).includes(
      'receipt-cursor-queue-slack-not-measured',
    ),
  );
  assert.equal(
    productionThroughputBlockers(unpausedWithoutMeasuredQueueSlack).includes(
      'queue-pause-without-consistent-receipt-cursor-slack',
    ),
    false,
  );
  assert.equal(
    productionThroughputDetails(unpausedWithoutMeasuredQueueSlack).backpressureConsistency.queuePauseHasMeasuredReceiptCursorQueueSlack,
    true,
  );
  assert.ok(
    productionThroughputBlockers(mismatchedQueueSlack).includes(
      'receipt-cursor-queue-slack-resource-headroom-mismatch',
    ),
  );

  const mismatchedQueueSlackHeadroom = clone(report);
  mismatchedQueueSlackHeadroom.evidence.backpressure.queueHeadroomBytes = 0;
  assert.ok(
    productionThroughputBlockers(mismatchedQueueSlackHeadroom).includes(
      'receipt-cursor-queue-slack-headroom-mismatch',
    ),
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlackHeadroom).backpressureConsistency.receiptCursorQueueSlackMatchesQueueHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueSlackHeadroom).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const mismatchedMemorySlack = clone(report);
  mismatchedMemorySlack.evidence.backpressure.receiptCursorMemoryHeadroomBytes = 0;
  assert.ok(
    productionThroughputBlockers(mismatchedMemorySlack).includes('receipt-cursor-queue-slack-mismatch'),
  );
  assert.equal(
    productionThroughputDetails(mismatchedMemorySlack).backpressureConsistency.receiptCursorQueueSlackMatchesMemoryHeadroom,
    false,
  );
  assert.equal(
    productionThroughputBlockers(mismatchedMemorySlack).includes(
      'queue-headroom-memory-headroom-mismatch',
    ),
    true,
  );
  assert.equal(
    productionThroughputDetails(mismatchedMemorySlack).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const zeroQueueCursor = clone(report);
  zeroQueueCursor.evidence.backpressure.receiptCursorBytes = 0;
  assert.ok(
    productionThroughputBlockers(zeroQueueCursor).includes(
      'receipt-cursor-backpressure-not-measured',
    ),
  );
  assert.equal(
    productionThroughputDetails(zeroQueueCursor).backpressureConsistency.receiptCursorBackpressureMeasured,
    false,
  );

  const mismatchedQueueHeadroom = clone(report);
  mismatchedQueueHeadroom.evidence.backpressure.queueHeadroomBytes = 0;
  assert.ok(
    productionThroughputBlockers(mismatchedQueueHeadroom).includes(
      'queue-headroom-not-positive',
    ),
  );
  assert.ok(
    productionThroughputBlockers(mismatchedQueueHeadroom).includes(
      'queue-headroom-backpressure-mismatch',
    ),
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueHeadroom).queueHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueHeadroom).backpressureConsistency.receiptCursorHeadroomMatchesQueueHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueHeadroom).backpressureConsistency.queueHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueHeadroom).backpressureConsistency.queueHeadroomMatchesMemoryHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueHeadroom).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueHeadroom).backpressureConsistency.queuePausedBeforeOverflow,
    true,
  );
  assert.equal(
    productionThroughputDetails(mismatchedQueueHeadroom).backpressureConsistency.receiptCursorWithinQueueBudget,
    true,
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
    productionThroughputDetails(mismatchedReceiptCursorHeadroom).backpressureConsistency.queuePausedBeforeOverflow,
    true,
  );
  assert.equal(
    productionThroughputDetails(mismatchedReceiptCursorHeadroom).receiptCursorHeadroomMatchesResourceHeadroom,
    true,
  );
  assert.equal(
    productionThroughputDetails(mismatchedReceiptCursorHeadroom).backpressureConsistency.receiptCursorHeadroomMatchesQueueHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedReceiptCursorHeadroom).receiptCursorMemoryHeadroomWithinQueueBudget,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedReceiptCursorHeadroom).backpressureConsistency.queueHeadroomMatchesMemoryHeadroom,
    false,
  );

  const missingQueueHeadroom = clone(report);
  delete missingQueueHeadroom.evidence.backpressure.queueHeadroomBytes;
  assert.ok(
    productionThroughputBlockers(missingQueueHeadroom).includes(
      'missing-queue-headroom-evidence',
    ),
  );
  assert.equal(
    productionThroughputDetails(missingQueueHeadroom).backpressureConsistency.queueHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingQueueHeadroom).queueHeadroomWithinResourceCeiling,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingQueueHeadroom).backpressureConsistency.queueHeadroomWithinResourceCeiling,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingQueueHeadroom).receiptCursorHeadroomCoveredByQueueBudget,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingQueueHeadroom).receiptCursorHeadroomWithinQueueBudget,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingQueueHeadroom).backpressureConsistency.receiptCursorHeadroomCoveredByQueueBudget,
    false,
  );

  const missingQueueHeadroomProof = clone(report);
  delete missingQueueHeadroomProof.evidence.backpressure.queueHeadroomMeasured;
  assert.ok(
    productionThroughputBlockers(missingQueueHeadroomProof).includes(
      'queue-pause-without-measured-queue-headroom-proof',
    ),
  );
  assert.equal(
    productionThroughputDetails(missingQueueHeadroomProof).backpressureConsistency.queueHeadroomMeasured,
    false,
  );

  const missingQueueMemoryHeadroomProof = clone(report);
  delete missingQueueMemoryHeadroomProof.evidence.backpressure.receiptCursorMemoryHeadroomBytes;
  assert.ok(
    productionThroughputBlockers(missingQueueMemoryHeadroomProof).includes(
      'queue-pause-without-measured-receipt-cursor-memory-headroom',
    ),
  );
  assert.equal(
    productionThroughputDetails(missingQueueMemoryHeadroomProof).backpressureConsistency.receiptCursorMemoryHeadroomPositive,
    false,
  );

  const queueHeadroomBeyondResourceCeiling = clone(report);
  queueHeadroomBeyondResourceCeiling.evidence.backpressure.queueHeadroomBytes =
    queueHeadroomBeyondResourceCeiling.resourceLimits.maxBufferedUploadBytes + 1;
  assert.ok(
    productionThroughputBlockers(queueHeadroomBeyondResourceCeiling).includes(
      'queue-headroom-exceeds-resource-ceiling',
    ),
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).backpressureConsistency.queueHeadroomWithinResourceCeiling,
    false,
  );

  const hiddenQueueHeadroom = clone(report);
  hiddenQueueHeadroom.evidence.backpressure.queueHeadroomVisible = false;
  assert.ok(
    productionThroughputBlockers(hiddenQueueHeadroom).includes('queue-headroom-not-visible'),
  );

  const visibleQueueHeadroomWithoutMeasurement = clone(report);
  visibleQueueHeadroomWithoutMeasurement.evidence.backpressure.queueHeadroomMeasured = false;
  visibleQueueHeadroomWithoutMeasurement.evidence.backpressure.queueHeadroomVisible = true;
  assert.ok(
    productionThroughputBlockers(visibleQueueHeadroomWithoutMeasurement).includes(
      'queue-headroom-visible-without-measurement',
    ),
  );
  assert.equal(
    productionThroughputDetails(visibleQueueHeadroomWithoutMeasurement).backpressureConsistency.queueHeadroomMeasured,
    false,
  );

  const headroomNotCoveredByBudget = clone(report);
  headroomNotCoveredByBudget.evidence.backpressure.queueBudgetBytes -= 1024 * 1024;
  headroomNotCoveredByBudget.evidence.backpressure.queueHeadroomBytes =
    headroomNotCoveredByBudget.evidence.backpressure.queueBudgetBytes - report.shape.chunkSizeBytes;
  assert.ok(
    productionThroughputBlockers(headroomNotCoveredByBudget).includes(
      'receipt-cursor-headroom-not-covered-by-queue-budget',
    ),
  );
  assert.equal(
    productionThroughputDetails(headroomNotCoveredByBudget).receiptCursorHeadroomWithinQueueBudget,
    false,
  );
  assert.equal(
    productionThroughputDetails(headroomNotCoveredByBudget).backpressureConsistency.receiptCursorHeadroomWithinQueueBudget,
    false,
  );

  const oversizedBackpressureCursor = clone(report);
  oversizedBackpressureCursor.evidence.backpressure.receiptCursorBytes =
    oversizedBackpressureCursor.evidence.backpressure.queueHeadroomBytes + 1;
  assert.equal(
    productionThroughputDetails(oversizedBackpressureCursor).backpressureConsistency.receiptCursorMatchesBackpressure,
    false,
  );
  assert.equal(
    productionThroughputDetails(oversizedBackpressureCursor).backpressureConsistency.receiptCursorBackpressureWithinQueueHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(oversizedBackpressureCursor).backpressureConsistency.receiptCursorBackpressureWithinQueueBudget,
    true,
  );
  assert.equal(
    productionThroughputBlockers(oversizedBackpressureCursor).includes('receipt-cursor-backpressure-mismatch'),
    true,
  );
  assert.ok(
    productionThroughputBlockers(oversizedBackpressureCursor).includes('receipt-cursor-exceeds-queue-headroom'),
  );

  const backpressureExceedsQueueBudget = clone(report);
  backpressureExceedsQueueBudget.evidence.backpressure.receiptCursorBytes =
    backpressureExceedsQueueBudget.evidence.backpressure.queueBudgetBytes + 1;
  assert.ok(
    productionThroughputBlockers(backpressureExceedsQueueBudget).includes(
      'receipt-cursor-backpressure-exceeds-queue-budget',
    ),
  );
  assert.equal(
    productionThroughputDetails(backpressureExceedsQueueBudget).backpressureConsistency.receiptCursorBackpressureWithinQueueBudget,
    false,
  );
  assert.equal(
    productionThroughputDetails(backpressureExceedsQueueBudget).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const backpressureExceedsResourceHeadroom = clone(report);
  backpressureExceedsResourceHeadroom.evidence.backpressure.receiptCursorBytes =
    backpressureExceedsResourceHeadroom.resourceLimits.memoryCeilingBytes
      - backpressureExceedsResourceHeadroom.evidence.chunkReceipts.resumeCursor.sizeBytes
      + 1;
  assert.ok(
    productionThroughputBlockers(backpressureExceedsResourceHeadroom).includes(
      'receipt-cursor-backpressure-exceeds-resource-headroom',
    ),
  );
  assert.equal(
    productionThroughputDetails(backpressureExceedsResourceHeadroom).backpressureConsistency.receiptCursorBackpressureWithinResourceHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(backpressureExceedsResourceHeadroom).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const zeroQueueSlackEvidence = clone(report);
  zeroQueueSlackEvidence.evidence.backpressure.receiptCursorQueueSlackBytes = 0;
  assert.equal(
    productionThroughputDetails(zeroQueueSlackEvidence).backpressureConsistency.receiptCursorQueueSlackWithinQueueBudget,
    false,
  );
  assert.equal(
    productionThroughputDetails(zeroQueueSlackEvidence).backpressureConsistency.queuePauseHasMeasuredReceiptCursorQueueSlack,
    false,
  );
  assert.equal(
    productionThroughputDetails(zeroQueueSlackEvidence).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );
  assert.ok(
    productionThroughputBlockers(zeroQueueSlackEvidence).includes('receipt-cursor-queue-slack-not-positive'),
  );
  assert.ok(
    productionThroughputBlockers(zeroQueueSlackEvidence).includes(
      'queue-pause-without-consistent-receipt-cursor-slack',
    ),
  );

  const missingQueueSlackMeasurement = clone(report);
  delete missingQueueSlackMeasurement.evidence.backpressure.receiptCursorQueueSlackBytes;
  assert.equal(
    productionThroughputDetails(missingQueueSlackMeasurement).backpressureConsistency
      .receiptCursorQueueSlackMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(missingQueueSlackMeasurement).backpressureConsistency
      .backpressureEvidenceComplete,
    false,
  );
  assert.ok(
    productionThroughputBlockers(missingQueueSlackMeasurement).includes(
      'receipt-cursor-queue-slack-not-measured',
    ),
  );

  const overBudgetQueueSlack = clone(report);
  overBudgetQueueSlack.evidence.backpressure.receiptCursorQueueSlackBytes =
    overBudgetQueueSlack.evidence.backpressure.queueBudgetBytes + 1;
  assert.ok(
    productionThroughputBlockers(overBudgetQueueSlack).includes(
      'receipt-cursor-queue-slack-exceeds-queue-budget',
    ),
  );
  assert.equal(
    productionThroughputDetails(overBudgetQueueSlack).backpressureConsistency.receiptCursorQueueSlackWithinQueueBudget,
    false,
  );

  const zeroBackpressure = clone(report);
  zeroBackpressure.evidence.backpressure.receiptCursorBytes = 0;
  assert.ok(
    productionThroughputBlockers(zeroBackpressure).includes('receipt-cursor-backpressure-not-positive'),
  );
  assert.equal(
    productionThroughputDetails(zeroBackpressure).backpressureConsistency.receiptCursorBackpressureMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(zeroBackpressure).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const zeroQueueHeadroom = clone(report);
  zeroQueueHeadroom.evidence.backpressure.queueHeadroomBytes = 0;
  assert.ok(
    productionThroughputBlockers(zeroQueueHeadroom).includes('queue-headroom-not-positive'),
  );
  assert.equal(
    productionThroughputBlockers(zeroQueueHeadroom).includes(
      'queue-pause-without-positive-queue-headroom',
    ),
    true,
  );
  assert.equal(
    productionThroughputDetails(zeroQueueHeadroom).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const pausedWithZeroQueueHeadroom = clone(report);
  pausedWithZeroQueueHeadroom.evidence.backpressure.queueHeadroomBytes = 0;
  pausedWithZeroQueueHeadroom.evidence.backpressure.queuePausedBeforeOverflow = true;
  assert.ok(
    productionThroughputBlockers(pausedWithZeroQueueHeadroom).includes(
      'queue-pause-without-positive-queue-headroom',
    ),
  );
  assert.equal(
    productionThroughputDetails(pausedWithZeroQueueHeadroom).backpressureConsistency.queueHeadroomPositive,
    false,
  );

  const zeroMemoryHeadroom = clone(report);
  zeroMemoryHeadroom.evidence.backpressure.receiptCursorMemoryHeadroomBytes = 0;
  assert.ok(
    productionThroughputBlockers(zeroMemoryHeadroom).includes(
      'receipt-cursor-memory-headroom-not-positive',
    ),
  );
  assert.equal(
    productionThroughputDetails(zeroMemoryHeadroom).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const negativeQueueHeadroom = clone(report);
  negativeQueueHeadroom.evidence.backpressure.queueHeadroomBytes = -1;
  assert.ok(
    productionThroughputBlockers(negativeQueueHeadroom).includes('missing-queue-headroom-evidence'),
  );
  assert.equal(
    productionThroughputDetails(negativeQueueHeadroom).backpressureConsistency.queueHeadroomPositive,
    false,
  );
  assert.equal(
    productionThroughputDetails(negativeQueueHeadroom).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const tamperedResourceHeadroom = clone(report);
  tamperedResourceHeadroom.evidence.backpressure.receiptCursorBytes =
    tamperedResourceHeadroom.resourceLimits.memoryCeilingBytes
      - tamperedResourceHeadroom.evidence.chunkReceipts.resumeCursor.sizeBytes
      + 1;
  tamperedResourceHeadroom.evidence.backpressure.receiptCursorMemoryHeadroomBytes = 0;
  assert.equal(
    productionThroughputDetails(tamperedResourceHeadroom).receiptCursorBackpressureWithinResourceHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(tamperedResourceHeadroom).receiptCursorMemoryHeadroomBytes,
    0,
  );
  assert.equal(
    productionThroughputDetails(tamperedResourceHeadroom).backpressureConsistency.receiptCursorBackpressureWithinResourceHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(tamperedResourceHeadroom).backpressureConsistency.backpressureEvidenceComplete,
    false,
  );
  assert.equal(
    productionThroughputDetails(tamperedResourceHeadroom).backpressureEvidenceComplete,
    false,
  );

  const tamperedBackpressureHeadroom = clone(report);
  tamperedBackpressureHeadroom.evidence.backpressure.receiptCursorBytes =
    tamperedBackpressureHeadroom.resourceLimits.memoryCeilingBytes
      - tamperedBackpressureHeadroom.evidence.chunkReceipts.resumeCursor.sizeBytes
      + 1;
  tamperedBackpressureHeadroom.evidence.backpressure.receiptCursorMemoryHeadroomBytes =
    tamperedBackpressureHeadroom.resourceLimits.memoryCeilingBytes
      - tamperedBackpressureHeadroom.evidence.chunkReceipts.resumeCursor.sizeBytes;
  assert.ok(
    productionThroughputBlockers(tamperedBackpressureHeadroom).includes(
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    ),
  );
  assert.equal(
    productionThroughputDetails(tamperedBackpressureHeadroom).backpressureConsistency
      .receiptCursorBackpressureWithinResourceHeadroom,
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

  const mismatchedGraphIdentityPostmeta = clone(report);
  mismatchedGraphIdentityPostmeta.evidence.wordpressGraphIdentity.postmetaReferences -= 1;
  assert.ok(
    productionThroughputBlockers(mismatchedGraphIdentityPostmeta).includes(
      'wordpress-graph-identity-postmeta-count-mismatch',
    ),
  );
  assert.equal(
    productionThroughputDetails(mismatchedGraphIdentityPostmeta).wordpressGraphIdentityPostmetaReferencesMatch,
    false,
  );

  const nonTerminalPausedQueue = clone(report);
  nonTerminalPausedQueue.evidence.backpressure.queuePausedBeforeOverflow = true;
  nonTerminalPausedQueue.evidence.chunkReceipts.cursorConsistency.canResumeFromCursor = false;
  assert.ok(
    productionThroughputBlockers(nonTerminalPausedQueue).includes(
      'queue-pause-without-terminal-receipt-cursor',
    ),
  );
  assert.ok(
    productionThroughputBlockers(nonTerminalPausedQueue).includes('receipt-cursor-not-terminal'),
  );
  assert.equal(
    productionThroughputDetails(nonTerminalPausedQueue).receiptCursorIsTerminalChunk,
    false,
  );

  const unrecognizedSuccessClaim = clone(report);
  unrecognizedSuccessClaim.results.successInspection.claim.status = 'mystery';
  assert.ok(
    productionThroughputBlockers(unrecognizedSuccessClaim).includes(
      'success-inspection-claim-status-not-recognized',
    ),
  );
  assert.equal(
    productionThroughputDetails(unrecognizedSuccessClaim).successInspectionClaimRecognized,
    false,
  );

  const nonCanonicalSuccessClaim = clone(report);
  nonCanonicalSuccessClaim.results.successInspection.claim.status = 'active';
  assert.ok(
    productionThroughputBlockers(nonCanonicalSuccessClaim).includes(
      'success-inspection-claim-status-not-canonical',
    ),
  );
  assert.equal(
    productionThroughputDetails(nonCanonicalSuccessClaim).successInspectionClaimCanonical,
    false,
  );

  const noneStatusWithReason = clone(report);
  noneStatusWithReason.results.successInspection.claim.reason = 'unexpected reason';
  assert.ok(
    productionThroughputBlockers(noneStatusWithReason).includes(
      'success-inspection-claim-reason-not-canonical',
    ),
  );
  assert.equal(
    productionThroughputDetails(noneStatusWithReason).successInspectionClaimReasonCanonical,
    false,
  );

  const blockedReasonWithWhitespace = clone(report);
  blockedReasonWithWhitespace.results.successInspection.claim.status = 'blocked';
  blockedReasonWithWhitespace.results.successInspection.claim.reason = '   ';
  assert.ok(
    productionThroughputBlockers(blockedReasonWithWhitespace).includes(
      'success-inspection-claim-reason-not-proven',
    ),
  );
  assert.equal(
    productionThroughputDetails(blockedReasonWithWhitespace).successInspectionClaimReasonTrimmed,
    '',
  );
});

test('guarded benchmark fails closed when the buffered queue budget drifts from the default ceiling', () => {
  const report = smallBenchmark({ maxBufferedUploadBytes: 16 * 1024 * 1024 });

  assert.equal(report.resourceLimits.maxBufferedUploadBytes, 16 * 1024 * 1024);
  assert.equal(report.evidence.backpressure.queueBudgetBytes, 16 * 1024 * 1024);
  assert.equal(report.evidence.backpressure.queueBudgetMatchesResourceCeiling, false);
  assert.equal(report.evidence.backpressure.receiptCursorMemoryCeilingVisible, false);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorMemoryCeilingVisible, false);
  assert.ok(
    report.claims.productionThroughput.blockers.includes('queue-budget-does-not-match-resource-ceiling'),
  );
});

test('guarded benchmark treats queue-budget visibility without memory-ceiling visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;
  mutated.evidence.backpressure.queueBudgetVisible = true;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.ok(blockers.includes('queue-budget-visible-without-memory-ceiling-visibility'));
});

test('guarded benchmark treats queue-budget visibility without queue-headroom visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomVisible = false;
  mutated.evidence.backpressure.queueBudgetVisible = true;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.ok(blockers.includes('queue-budget-visible-without-queue-headroom-visible'));
});

test('guarded benchmark treats memory-ceiling visibility without queue-budget visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible, false);
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-budget-visible'));
});

test('guarded benchmark treats missing measured queue-slack proof as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('queue-pause-without-measured-receipt-cursor-queue-slack-proof'));
});

test('guarded benchmark treats missing measured backpressure proof as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredReceiptCursorBackpressure = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('queue-pause-without-measured-receipt-cursor-backpressure-proof'));
});

test('guarded benchmark keeps pause detail flags false when the chunk exceeds the queue budget', () => {
  const report = smallBenchmark({
    fileBytes: 64 * 1024 * 1024,
    chunkSizeBytes: 64 * 1024 * 1024,
  });

  assert.equal(report.evidence.backpressure.queuePausedBeforeOverflow, false);
  assert.equal(report.evidence.backpressure.queuePauseHasMeasuredReceiptCursorQueueSlack, false);
  assert.equal(report.evidence.backpressure.queuePauseHasMeasuredReceiptCursorBackpressure, false);
  assert.equal(report.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack, false);
  assert.equal(report.evidence.backpressure.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack, false);
  assert.equal(report.claims.productionThroughput.status, 'blocked');
});

test('guarded benchmark blocks when queue headroom measurement is missing', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.backpressureConsistency.queueHeadroomMeasured, false);
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('queue-headroom-not-measured'));
});

test('guarded benchmark treats missing measured queue-headroom proof as incomplete paused backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePausedBeforeOverflow = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.backpressureConsistency.queueHeadroomMeasured, false);
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('queue-pause-without-measured-queue-headroom-proof'));
});
