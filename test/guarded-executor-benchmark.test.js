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
import {
  buildFastPathFixture,
  findRejectedFastPathById,
  findSafeFastPathByShortcut,
} from '../scripts/bench/performance-model.js';

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

function largeBenchmark(overrides = {}) {
  return runGuardedExecutorBenchmark({
    profile: 'guardedLarge',
    now: fixedNow,
    tempDir: tempBenchmarkDir(),
    ...overrides,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS = Object.freeze([
  'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
  'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
  'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
  'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
  'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
]);
const INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS = Object.freeze([
  'queue-pause-footprint-not-proven',
  'queue-pause-without-complete-receipt-cursor-pause-footprint',
  'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
]);
const HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'queue-budget-not-visible',
  'memory-ceiling-match-visible-without-queue-budget-visibility',
  'memory-ceiling-visible-without-queue-budget-visibility',
  'queue-headroom-visible-without-queue-budget-visibility',
  'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
  'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
]);
const HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'queue-budget-visible-without-memory-ceiling-visibility',
  'queue-pause-without-visible-memory-ceiling',
  'memory-ceiling-match-visible-without-memory-ceiling-visibility',
  'queue-headroom-visible-without-memory-ceiling-visibility',
  'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
  'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
]);
const HIDDEN_STAGING_DISK_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'staging-disk-headroom-not-visible',
]);
const POST_PAUSE_STAGING_DISK_FOOTPRINT_BLOCKER_REFS = Object.freeze([
  'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
]);
const POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
  ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
]);
const POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
  ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
]);
const POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
  'queue-budget-visible-without-queue-headroom-visible',
  'memory-ceiling-match-visible-without-queue-headroom-visibility',
  'memory-ceiling-visible-without-queue-headroom-visible',
  'queue-headroom-not-visible',
  'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
  'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
]);
const HIDDEN_MEMORY_HEADROOM_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'memory-ceiling-match-visible-without-memory-headroom-visibility',
  'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
  'queue-pause-without-visible-receipt-cursor-memory-headroom',
  'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
]);
const POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS = Object.freeze([
  'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
  ...HIDDEN_MEMORY_HEADROOM_VISIBILITY_BLOCKER_REFS,
]);

function summarizeRejectedGates(entries) {
  return [...entries.reduce((map, entry) => {
    map.set(entry.rejectedGate, (map.get(entry.rejectedGate) || 0) + 1);
    return map;
  }, new Map()).entries()]
    .map(([rejectedGate, count]) => ({ rejectedGate, count }))
    .sort((left, right) => left.rejectedGate.localeCompare(right.rejectedGate));
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
  assert.equal(report.resourceLimits.maxStagingDiskBytes, 4 * 1024 * 1024 * 1024);
  assert.equal(report.evidence.resourceLimits.chunkWindowWithinMemoryCeiling, true);
  assert.equal(report.evidence.resourceLimits.bytesMovedWithinStagingDiskCeiling, true);
  assert.equal(report.evidence.backpressure.producerQueueBounded, true);
  assert.equal(report.evidence.backpressure.queueBudgetMatchesResourceCeiling, true);
  assert.equal(report.evidence.backpressure.queueBudgetVisible, true);
  assert.equal(report.claims.productionThroughputDetails.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, true);
  assert.equal(report.evidence.backpressure.queueHeadroomVisible, true);
  assert.equal(report.evidence.backpressure.queuePausedBeforeOverflow, true);
  assert.equal(report.evidence.backpressure.receiptCursorWithinQueueBudget, true);
  assert.equal(report.evidence.backpressure.backpressureEvidenceComplete, true);
  assert.equal(report.evidence.backpressure.receiptCursorPauseFootprintComplete, true);
  assert.equal(report.claims.productionThroughputDetails.receiptCursorPauseFootprintVisible, true);
  assert.equal(report.evidence.backpressure.receiptCursorQueueSlackBytes, 31.5 * 1024 * 1024);
  assert.equal(report.evidence.backpressure.receiptCursorQueueSlackVisible, true);
  assert.equal(report.evidence.backpressure.receiptCursorMemoryHeadroomBytes, 31.5 * 1024 * 1024);
  assert.equal(report.evidence.backpressure.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(report.evidence.backpressure.queueHeadroomBytes, 31.5 * 1024 * 1024);
  assert.equal(
    report.evidence.backpressure.stagingDiskHeadroomBytes,
    report.resourceLimits.maxStagingDiskBytes - report.shape.bytesMovedThroughStaging,
  );
  assert.equal(report.evidence.backpressure.stagingDiskReserveBytes, 512 * 1024);
  assert.equal(report.claims.productionThroughputDetails.stagingDiskReservePositive, true);
  assert.equal(report.claims.productionThroughputDetails.stagingDiskReserveMatchesChunkWindow, true);
  assert.equal(report.evidence.backpressure.stagingDiskHeadroomMeasured, true);
  assert.equal(report.evidence.backpressure.stagingDiskHeadroomVisible, true);
  assert.equal(report.evidence.backpressure.stagingDiskHeadroomWithinPlanReserve, true);
  assert.equal(report.claims.productionThroughputDetails.stagingDiskHeadroomVisibleAndMeasured, true);
  assert.equal(
    report.claims.productionThroughputDetails.stagingDiskHeadroomVisibleAndMeasuredAfterPause,
    true,
  );
  assert.deepEqual(report.claims.productionThroughputDetails.receiptCursorPauseFootprint, {
    receiptCursorBytes: 512 * 1024,
    queueBudgetBytes: 32 * 1024 * 1024,
    queueHeadroomBytes: 31.5 * 1024 * 1024,
    queueSlackBytes: 31.5 * 1024 * 1024,
    memoryCeilingBytes: 32 * 1024 * 1024,
    memoryHeadroomBytes: 31.5 * 1024 * 1024,
  });
  assert.equal(report.claims.productionThroughputDetails.backpressureAlignment.aligned, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.stagingDiskHeadroomPositive, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.stagingDiskHeadroomVisible, true);
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.stagingDiskHeadroomMeasured, true);
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.stagingDiskHeadroomWithinPlanReserve,
    true,
  );
  assert.equal(report.claims.productionThroughputDetails.queueHeadroomVisibleAndMemoryHeadroomVisible, true);
  assert.equal(
    report.claims.productionThroughputDetails.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible,
    true,
  );
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
  assert.equal(report.claims.productionThroughputDetails.atomicGroup.productionStorageReceiptsMeasured, false);
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
  assert.equal(
    report.claims.productionThroughputDetails.atomicGroup
      .productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
  assert.equal(report.throughput.productionThroughput, 'not-claimed');
});

test('guarded executor benchmark keeps the published throughput details in sync with computed details', () => {
  const report = smallBenchmark();
  const computed = productionThroughputDetails(report);

  assert.deepEqual(report.claims.productionThroughputDetails, computed);
});

test('guarded executor benchmark keeps large-site rollout proof bounded and names explicit remaining blockers', () => {
  const report = largeBenchmark();
  const expectedBlockers = [
    'backpressure-evidence-incomplete',
    'production-atomic-group-commit-not-measured',
    'production-capability-measurement-not-aligned',
    'production-parallelism-limits-not-visible',
    'production-row-batch-executor-measured-not-proven',
    'production-row-batch-executor-not-measured',
    'production-storage-receipts-not-measured',
    'queue-memory-ceiling-does-not-match-queue-budget',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
  ];
  const expectedRejectedFastPaths = [
    {
      id: 'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-parallelism-limits-not-visible',
        'production-storage-receipts-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks',
      rejectedGate: 'live',
      blockerRefs: ['production-capability-measurement-not-aligned'],
    },
    {
      id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        ...ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-commit',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-planning',
      rejectedGate: 'skip',
      blockerRefs: ['production-capability-measurement-not-aligned'],
    },
    {
      id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
      rejectedGate: 'skip',
      blockerRefs: ['production-capability-measurement-not-aligned'],
    },
    {
      id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-batched-row-receipts-skips-release-bundle-commit',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-compressed-db-batches-skips-release-bundle-commit',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
      rejectedGate: 'recovery',
      blockerRefs: [
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-writeback',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-activation',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-activation',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    {
      id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-activation',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
      rejectedGate: 'recovery',
      blockerRefs: [
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
  ].sort((left, right) => left.id.localeCompare(right.id));
  const expectedProductionCapabilityRolloutSummary = [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-visible',
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-visible',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'production-parallelism-limits-not-visible',
      ],
    },
  ];

  assert.equal(report.shape.fileBytes, 32 * 1024 * 1024);
  assert.equal(report.shape.chunkSizeBytes, 8 * 1024 * 1024);
  assert.equal(report.shape.chunkCount, 4);
  assert.equal(report.shape.rowCount, 256);
  assert.equal(report.evidence.chunkReceipts.recorded, 4);
  assert.equal(report.evidence.chunkReceipts.resumeCursor.chunkIndex, 3);
  assert.equal(report.evidence.backpressure.queuePausedBeforeOverflow, true);
  assert.equal(report.evidence.backpressure.queueBudgetBytes, report.resourceLimits.maxBufferedUploadBytes);
  assert.equal(
    report.evidence.backpressure.queueHeadroomBytes,
    report.resourceLimits.maxBufferedUploadBytes - report.shape.chunkSizeBytes,
  );
  assert.equal(
    report.evidence.backpressure.receiptCursorQueueSlackBytes,
    report.resourceLimits.memoryCeilingBytes - report.shape.chunkSizeBytes,
  );
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.equal(report.claims.productionThroughputDetails.parallelismLimitsCanonical, true);
  assert.equal(report.claims.productionThroughput.status, 'blocked');
  assert.deepEqual([...report.claims.productionThroughput.blockers].sort(), expectedBlockers);
  assert.deepEqual(
    report.claims.productionThroughputDetails.rejectedFastPathGateSummary,
    [
      { rejectedGate: 'group', count: 57 },
      { rejectedGate: 'live', count: 1 },
      { rejectedGate: 'recovery', count: 13 },
      { rejectedGate: 'skip', count: 2 },
    ],
  );
  assert.deepEqual(
    report.claims.productionThroughputDetails.rejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    expectedRejectedFastPaths,
  );
  assert.deepEqual(
    report.claims.productionThroughput.rejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    expectedRejectedFastPaths,
  );
  assert.deepEqual(
    report.claims.productionThroughputDetails.productionCapabilityRolloutSummary,
    expectedProductionCapabilityRolloutSummary,
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('backpressure-evidence-incomplete'),
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes(
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    ),
  );
});

test('guarded benchmark keeps rollout capability summary blocked when row-batch visibility bits appear without measurements', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-atomic-group-commit-visible-without-measurement',
        'production-atomic-group-metadata-visible-without-measurement',
        'production-storage-receipts-not-measured',
        'production-storage-receipts-visible-without-measurement',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-measurement',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-atomic-commit-measurement',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'ready',
      measured: true,
      visible: true,
      blockerRefs: [],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-atomic-group-commit-visible-without-measurement',
        'production-atomic-group-metadata-visible-without-measurement',
        'production-atomic-group-metadata-visible-without-storage-receipts-measurement',
        'production-storage-receipts-not-measured',
        'production-storage-receipts-visible-without-measurement',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-measurement',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-atomic-commit-measurement',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
        'production-row-batch-executor-visible-without-measurement',
        'production-row-batch-executor-visible-without-storage-receipts-measurement',
      ],
    },
  ]);
});

test('guarded benchmark keeps chunk-upload rollout summary pinned to forged storage-receipts visibility blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.fileReceipts = 'unsupported-file-receipts';
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = false;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-not-measured',
        'production-storage-receipts-visible-without-measurement',
        'production-storage-receipts-without-atomic-group-metadata',
        'production-storage-receipts-without-atomic-commit',
      ],
    },
  );
});

test('guarded benchmark keeps chunk-upload rollout summary pinned to atomic visibility blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = false;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = false;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'production-atomic-group-commit-not-measured',
        'production-storage-receipts-without-atomic-group-metadata',
        'production-storage-receipts-without-atomic-commit',
      ],
    },
  );
});

test('guarded benchmark keeps chunk-upload rollout summary pinned to hidden atomic-commit blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = false;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'production-atomic-group-commit-not-visible',
        'production-atomic-group-metadata-visible-without-atomic-commit',
        'production-storage-receipts-without-atomic-commit',
      ],
    },
  );
});

test('guarded benchmark keeps chunk-upload rollout summary pinned to atomic-group metadata blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'production-atomic-group-metadata-not-visible',
        'production-storage-receipts-without-atomic-group-metadata',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-metadata',
      ],
    },
  );
});

test('guarded benchmark keeps chunk-upload rollout visibility hidden when backpressure proof is incomplete', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.backpressure.receiptCursorBytes = null;

  const details = productionThroughputDetails(tampered);
  const chunkUploadSummary = details.productionCapabilityRolloutSummary.find(
    (entry) => entry.surface === 'chunk-upload-concurrency',
  );
  const blockers = productionThroughputBlockers(tampered);

  assert.deepEqual(chunkUploadSummary, {
    surface: 'chunk-upload-concurrency',
    status: 'blocked',
    measured: false,
    visible: false,
    blockerRefs: [
      'backpressure-evidence-incomplete',
      'queue-memory-ceiling-does-not-match-queue-budget',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
      'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
      'queue-pause-without-consistent-receipt-cursor-slack',
      'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-memory-safe-receipt-cursor-slack',
      'receipt-cursor-backpressure-not-measured',
    ],
  });
  assert.equal(details.parallelismLimitsVisibleAndMeasured, true);
  assert.equal(blockers.includes('backpressure-evidence-incomplete'), true);
  assert.equal(blockers.includes('receipt-cursor-backpressure-not-measured'), true);
});

test('guarded benchmark carries direct receipt-cursor queue-slack measurement blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackBytes = null;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-measured-receipt-cursor-queue-slack',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack',
        'receipt-cursor-queue-slack-not-measured',
        'receipt-cursor-queue-slack-visible-without-measurement',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-measured-receipt-cursor-queue-slack',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack',
        'receipt-cursor-queue-slack-not-measured',
        'receipt-cursor-queue-slack-visible-without-measurement',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-measured-receipt-cursor-queue-slack',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack',
        'receipt-cursor-queue-slack-not-measured',
        'receipt-cursor-queue-slack-visible-without-measurement',
      ],
    },
  ]);
  assert.ok(blockers.includes('queue-pause-without-measured-receipt-cursor-queue-slack'));
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure'));
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-not-measured'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-measurement'));
});

test('guarded benchmark carries direct receipt-cursor queue-slack measurement blockers into rejected fast-path summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackBytes = null;

  const details = productionThroughputDetails(mutated);
  const queueSlackCommit = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-queue-slack-authorizes-commit-after-pause',
  );

  assert.deepEqual(queueSlackCommit?.blockerRefs, [
    'queue-pause-without-measured-receipt-cursor-queue-slack',
    'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack',
    'receipt-cursor-queue-slack-not-measured',
    'receipt-cursor-queue-slack-visible-without-measurement',
  ]);
});

test('guarded benchmark carries direct receipt-cursor memory-headroom measurement blockers into rejected fast-path summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomBytes = null;

  const details = productionThroughputDetails(mutated);
  const memoryHeadroomCommit = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'cached-receipt-cursor-memory-headroom-skips-release-bundle-commit-after-pause',
  );

  assert.deepEqual(memoryHeadroomCommit?.blockerRefs, [
    'queue-pause-without-measured-receipt-cursor-memory-headroom',
    'receipt-cursor-memory-headroom-visible-without-measurement',
    'receipt-cursor-headroom-not-covered-by-queue-budget',
    'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
  ]);
});

test('guarded benchmark carries direct plugin-update commit-after-pause blockers into rejected fast-path summaries', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const pluginUpdateCommitAfterPause = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
  );

  assert.deepEqual(pluginUpdateCommitAfterPause?.blockerRefs, [
    'production-atomic-group-commit-not-measured',
    'production-row-batch-executor-not-measured',
    'production-row-batch-executor-measured-not-proven',
  ]);
});

test('guarded benchmark surfaces plugin-update recovery blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const pluginUpdateRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-row-preconditions',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize-variant-b',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
    'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
  ].includes(entry.id));

  assert.deepEqual(
    pluginUpdateRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
    {
      id: 'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing',
        rejectedGate: 'live',
        blockerRefs: ['production-capability-measurement-not-aligned'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks',
        rejectedGate: 'live',
        blockerRefs: ['production-capability-measurement-not-aligned'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-row-preconditions',
        rejectedGate: 'live',
        blockerRefs: ['production-capability-measurement-not-aligned'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    {
      id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize-variant-b',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
      rejectedGate: 'group',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
    {
      id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
      rejectedGate: 'recovery',
      blockerRefs: [
        'production-atomic-group-commit-not-measured',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-not-measured',
        'production-row-batch-executor-measured-not-proven',
      ],
    },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(pluginUpdateRejectedFastPaths), [
    { rejectedGate: 'group', count: 16 },
    { rejectedGate: 'live', count: 3 },
    { rejectedGate: 'recovery', count: 7 },
  ]);

  assert.equal(
    details.rejectedFastPaths.filter((entry) => entry.id.includes('plugin-update')).length,
    26,
  );
});

test('guarded benchmark surfaces plugin-update blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const pluginUpdateRejectedFastPaths = details.rejectedFastPaths
    .filter((entry) => entry.id.includes('plugin-update'))
    .sort((left, right) => left.id.localeCompare(right.id));

  assert.deepEqual(
    pluginUpdateRejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing',
        rejectedGate: 'live',
        blockerRefs: ['production-capability-measurement-not-aligned'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks',
        rejectedGate: 'live',
        blockerRefs: ['production-capability-measurement-not-aligned'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-row-preconditions',
        rejectedGate: 'live',
        blockerRefs: ['production-capability-measurement-not-aligned'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize-variant-b',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ],
  );
});

test('guarded benchmark surfaces plugin-install finalize and commit-after-pause blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const pluginInstallFinalizeRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
  ].includes(entry.id));

  assert.deepEqual(
    pluginInstallFinalizeRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(pluginInstallFinalizeRejectedFastPaths), [
    { rejectedGate: 'group', count: 8 },
    { rejectedGate: 'recovery', count: 1 },
  ]);
});

test('guarded benchmark surfaces package-hash plugin-install blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const packageHashPluginInstallRejectedFastPaths = details.rejectedFastPaths.filter((entry) =>
    [
      'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation',
      'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
      'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
      'compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks',
      'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize',
      'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
      'compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback',
    ].includes(entry.id),
  );

  assert.deepEqual(
    packageHashPluginInstallRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(packageHashPluginInstallRejectedFastPaths), [
    { rejectedGate: 'group', count: 7 },
  ]);
});

test('guarded benchmark surfaces package-cache plugin-install blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const packageCachePluginInstallRejectedFastPaths = details.rejectedFastPaths.filter((entry) =>
    [
      'compressed-remote-index-and-cached-package-cache-skips-plugin-install-activation',
      'compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks',
      'compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize',
    ].includes(entry.id),
  );

  assert.deepEqual(
    packageCachePluginInstallRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(packageCachePluginInstallRejectedFastPaths), [
    { rejectedGate: 'group', count: 3 },
  ]);

  assert.equal(
    details.rejectedFastPaths.filter((entry) => entry.id.includes('plugin-install')).length,
    40,
  );
});

test('guarded benchmark surfaces manifest-hash plugin-install blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const manifestHashPluginInstallRejectedFastPaths = details.rejectedFastPaths.filter((entry) =>
    [
      'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize',
      'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback',
    ].includes(entry.id),
  );

  assert.deepEqual(
    manifestHashPluginInstallRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(manifestHashPluginInstallRejectedFastPaths), [
    { rejectedGate: 'group', count: 2 },
  ]);
});

test('guarded benchmark surfaces file-hash plugin-install blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const fileHashPluginInstallRejectedFastPaths = details.rejectedFastPaths.filter((entry) =>
    [
      'compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation',
      'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize',
      'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback',
    ].includes(entry.id),
  );

  assert.deepEqual(
    fileHashPluginInstallRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(fileHashPluginInstallRejectedFastPaths), [
    { rejectedGate: 'group', count: 4 },
  ]);
});

test('guarded benchmark surfaces dependency-graph plugin-install blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const dependencyGraphPluginInstallRejectedFastPaths = details.rejectedFastPaths.filter((entry) =>
    [
      'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation',
      'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
      'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
      'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks',
      'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize',
    ].includes(entry.id),
  );

  assert.deepEqual(
    dependencyGraphPluginInstallRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(dependencyGraphPluginInstallRejectedFastPaths), [
    { rejectedGate: 'group', count: 5 },
  ]);
});

test('guarded benchmark surfaces chunk-receipts plugin-install blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const chunkReceiptsPluginInstallRejectedFastPaths = details.rejectedFastPaths.filter((entry) =>
    [
      'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-activation',
      'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize',
      'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback',
      'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
    ].includes(entry.id),
  );

  assert.deepEqual(
    chunkReceiptsPluginInstallRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(chunkReceiptsPluginInstallRejectedFastPaths), [
    { rejectedGate: 'group', count: 5 },
  ]);
});

test('guarded benchmark surfaces row-receipts plugin-install blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const rowReceiptsPluginInstallRejectedFastPaths = details.rejectedFastPaths.filter((entry) =>
    [
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-activation',
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-writeback',
    ].includes(entry.id),
  );

  assert.deepEqual(
    rowReceiptsPluginInstallRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(rowReceiptsPluginInstallRejectedFastPaths), [
    { rejectedGate: 'group', count: 3 },
    { rejectedGate: 'recovery', count: 1 },
  ]);
});

test('guarded benchmark surfaces row-batch-receipts plugin-install blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const rowBatchReceiptsPluginInstallRejectedFastPaths = details.rejectedFastPaths.filter((entry) =>
    [
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback',
    ].includes(entry.id),
  );

  assert.deepEqual(
    rowBatchReceiptsPluginInstallRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(rowBatchReceiptsPluginInstallRejectedFastPaths), [
    { rejectedGate: 'group', count: 3 },
    { rejectedGate: 'recovery', count: 1 },
  ]);
});

test('guarded benchmark surfaces row-batch-receipts blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const rowBatchReceiptsRejectedFastPaths = details.rejectedFastPaths
    .filter((entry) => entry.id.includes('row-batch-receipts'))
    .sort((left, right) => left.id.localeCompare(right.id));

  assert.deepEqual(rowBatchReceiptsRejectedFastPaths.map(({ id }) => id), [
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize-variant-b',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
  ]);

  assert.deepEqual(summarizeRejectedGates(rowBatchReceiptsRejectedFastPaths), [
    { rejectedGate: 'group', count: 10 },
    { rejectedGate: 'recovery', count: 3 },
  ]);
});

test('guarded benchmark surfaces row-receipts blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const rowReceiptsRejectedFastPaths = details.rejectedFastPaths
    .filter((entry) => entry.id.includes('row-receipts'))
    .sort((left, right) => left.id.localeCompare(right.id));

  assert.deepEqual(rowReceiptsRejectedFastPaths.map(({ id }) => id), [
    'compressed-remote-index-and-batched-row-receipts-skips-release-bundle-commit',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-activation',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-writeback',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
  ]);

  assert.deepEqual(summarizeRejectedGates(rowReceiptsRejectedFastPaths), [
    { rejectedGate: 'group', count: 9 },
    { rejectedGate: 'recovery', count: 3 },
  ]);
});

test('guarded benchmark surfaces plugin-install backpressure blockers at runtime', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);
  const pluginInstallBackpressureRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
  ].includes(entry.id));

  assert.deepEqual(
    pluginInstallBackpressureRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      })),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(pluginInstallBackpressureRejectedFastPaths), [
    { rejectedGate: 'recovery', count: 3 },
  ]);
});

test('guarded benchmark keeps rollout summaries pinned to hidden storage-receipts visibility blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = false;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'production-storage-receipts-not-visible',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: true,
      visible: false,
      blockerRefs: [
        'production-storage-receipts-not-visible',
        'production-row-batch-executor-without-storage-receipts',
      ],
    },
  );
  assert.equal(details.atomicGroup.productionStorageReceiptsVisible, false);
  assert.equal(details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisible, false);
});

test('guarded benchmark blocks staging-disk headroom claims when the reserve no longer matches the chunk window', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.stagingDiskReserveBytes = report.shape.chunkSizeBytes / 2;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.stagingDiskReservePositive, true);
  assert.equal(details.stagingDiskReserveMatchesChunkWindow, false);
  assert.equal(details.stagingDiskHeadroomWithinPlanReserve, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.stagingDiskReserveMatchesChunkWindow, false);
  assert.equal(blockers.includes('staging-disk-reserve-not-aligned-to-chunk-window'), true);
  assert.equal(blockers.includes('backpressure-evidence-incomplete'), true);
});

test('guarded benchmark fails closed when staging-disk reserve evidence disappears', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.stagingDiskReserveBytes = null;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.stagingDiskReservePositive, false);
  assert.equal(details.stagingDiskReserveMatchesChunkWindow, false);
  assert.equal(details.stagingDiskHeadroomWithinPlanReserve, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.stagingDiskReservePositive, false);
  assert.equal(blockers.includes('missing-staging-disk-reserve-evidence'), true);
  assert.equal(blockers.includes('staging-disk-reserve-not-aligned-to-chunk-window'), false);
  assert.equal(blockers.includes('backpressure-evidence-incomplete'), true);
});

test('guarded benchmark exposes the bounded release-bundle retry-window fast path as planning-only', () => {
  const fastPath = findSafeFastPathByShortcut(
    'compress-canonical-per-kind-budget-summaries-to-size-bounded-release-bundle-retry-windows',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.area, 'compression');
  assert.equal(fastPath.visibilityBoundary, 'planning-only-budget-summary');
  assert.equal(fastPath.bypassesLivePreconditions, false);
  assert.equal(fastPath.splitsAtomicGroup, false);
  assert.equal(fastPath.publishesStagedDataEarly, false);
  assert.match(fastPath.gateProofs.skip, /compressed per-kind budget summaries/);
  assert.match(fastPath.gateProofs.live, /rechecks its own live resource precondition/);
  assert.match(fastPath.gateProofs.recovery, /durable receipts/);
});

test('guarded benchmark exposes plan-scoped chunk-receipt resume as recovery-only', () => {
  const fastPath = findSafeFastPathByShortcut(
    'reuse-plan-scoped-chunk-receipts-to-resume-bounded-windowing',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.area, 'chunk-upload');
  assert.equal(fastPath.visibilityBoundary, 'plan-staging-window-resume-only');
  assert.equal(fastPath.bypassesLivePreconditions, false);
  assert.equal(fastPath.splitsAtomicGroup, false);
  assert.equal(fastPath.publishesStagedDataEarly, false);
  assert.match(fastPath.gateProofs.skip, /plan-scoped chunk receipt set/);
  assert.match(fastPath.gateProofs.live, /live remote resource hash/);
  assert.match(fastPath.gateProofs.recovery, /durable chunk receipts/);
});

test('guarded benchmark exposes recorded remote-index chunk-window sizing as planning-only', () => {
  const fastPath = findSafeFastPathByShortcut(
    'reuse-recorded-remote-index-cursor-to-size-bounded-chunk-windows',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.area, 'chunk-upload');
  assert.equal(fastPath.visibilityBoundary, 'plan-staging-window-only');
  assert.equal(fastPath.bypassesLivePreconditions, false);
  assert.equal(fastPath.splitsAtomicGroup, false);
  assert.equal(fastPath.publishesStagedDataEarly, false);
  assert.match(fastPath.gateProofs.skip, /recorded remote-index cursor/);
  assert.match(fastPath.gateProofs.live, /live publish precondition/);
  assert.match(fastPath.gateProofs.recovery, /chunk receipts/);
});

test('guarded benchmark exposes bounded post-pause journal batching as advisory backpressure planning only', () => {
  const fastPath = findSafeFastPathByShortcut(
    'reuse-receipt-cursor-and-staging-disk-headroom-to-size-bounded-journal-batches-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.area, 'backpressure');
  assert.equal(fastPath.visibilityBoundary, 'kind-scoped-memory-and-journal-planning-only');
  assert.equal(fastPath.bypassesLivePreconditions, false);
  assert.equal(fastPath.splitsAtomicGroup, false);
  assert.equal(fastPath.publishesStagedDataEarly, false);
  assert.match(fastPath.gateProofs.skip, /receipt cursor can size the next bounded journal batch after a pause/);
  assert.match(fastPath.gateProofs.live, /same live preconditions/);
  assert.match(fastPath.gateProofs.recovery, /staging-disk headroom, and journal records/);
});

test('guarded benchmark exposes measured queue headroom and canonical budgets as bounded replay planning only', () => {
  const fastPath = findSafeFastPathByShortcut(
    'reuse-measured-queue-headroom-and-canonical-per-kind-budgets-to-size-bounded-plugin-update-replay-windows',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.area, 'backpressure');
  assert.equal(fastPath.visibilityBoundary, 'planning-only-budget-resume');
  assert.equal(fastPath.bypassesLivePreconditions, false);
  assert.equal(fastPath.splitsAtomicGroup, false);
  assert.equal(fastPath.publishesStagedDataEarly, false);
  assert.match(fastPath.gateProofs.skip, /measured queue headroom together with canonical per-kind budgets/);
  assert.match(fastPath.gateProofs.group, /never merges coupled plugin owners/);
  assert.match(fastPath.gateProofs.recovery, /durable receipts and the group staging record/);
});

test('guarded benchmark exposes queue budget, memory ceiling, and queue headroom retry shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-queue-budget-memory-ceiling-and-queue-headroom-skips-backpressure-pause-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /queue budget, memory ceiling, and queue headroom/);
  assert.match(fastPath.rejectedBecause, /ordered raw receipts/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes receipt-cursor-only pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-skips-backpressure-pause-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /cached receipt cursor/);
  assert.match(fastPath.rejectedBecause, /queue stayed bounded/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes queue-headroom and memory-headroom pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-queue-headroom-and-memory-headroom-skips-backpressure-pause-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /queue headroom and memory headroom/);
  assert.match(fastPath.rejectedBecause, /ordered raw receipts survived the retry/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'chunk-receipts', 'durable-progress', 'atomic-groups'],
  );
});

test('guarded benchmark exposes queue-budget-match pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /queue-budget match/);
  assert.match(fastPath.rejectedBecause, /journal trail is durable enough to recover/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes queue-budget, memory-ceiling, and queue-slack pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-queue-budget-memory-ceiling-and-queue-slack-skips-backpressure-pause-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /queue budget, memory ceiling, and queue slack/);
  assert.match(fastPath.rejectedBecause, /durable ordered receipt trail/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes queue-budget-match replay shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-replay-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /skip backpressure replay after a retry/);
  assert.match(fastPath.rejectedBecause, /raw receipt order/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes queue-slack and journal-lag pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-queue-slack-and-journal-lag-skips-backpressure-pause-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /queue slack and journal lag/);
  assert.match(fastPath.rejectedBecause, /ordered raw receipts survived the retry/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes journal-lag pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-and-journal-lag-skips-backpressure-pause-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /journal lag/);
  assert.match(fastPath.rejectedBecause, /raw receipt order survived the retry/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes canonical budget pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'canonical-per-kind-budgets-and-cached-receipt-cursor-skips-backpressure-pause-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /canonical per-kind budgets/);
  assert.match(fastPath.rejectedBecause, /durable receipt trail survived the retry/);
  assert.deepEqual(
    fastPath.violates,
    ['parallelism-limits', 'backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes queue-headroom pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /queue headroom/);
  assert.match(fastPath.rejectedBecause, /pause happened before overflow/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes staging-disk headroom and journal lag replay shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /staging-disk headroom and journal lag/);
  assert.match(fastPath.rejectedBecause, /durable replay evidence/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes staging-disk commit shortcuts across atomic groups as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-and-staging-disk-headroom-skips-atomic-group-commit-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /staging-disk headroom/);
  assert.match(fastPath.rejectedBecause, /atomic-group barrier/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'atomic-groups', 'row-preconditions', 'durable-progress', 'live-preconditions'],
  );
});

test('guarded benchmark exposes staging-disk release-bundle commit shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /release-bundle commit/);
  assert.match(fastPath.rejectedBecause, /atomic-group barrier/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'atomic-groups', 'durable-progress', 'live-preconditions'],
  );
});

test('guarded benchmark exposes staging-disk and journal-lag release-bundle commit shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /journal lag/);
  assert.match(fastPath.rejectedBecause, /durable journal trail/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'atomic-groups', 'durable-progress', 'live-preconditions'],
  );
});

test('guarded benchmark exposes memory-headroom commit shortcuts across atomic groups as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-memory-headroom-skips-atomic-group-commit-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /memory headroom/);
  assert.match(fastPath.rejectedBecause, /atomic-group barrier/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'atomic-groups', 'row-preconditions', 'durable-progress'],
  );
});

test('guarded benchmark exposes memory-headroom release-bundle commit shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-memory-headroom-skips-release-bundle-commit-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /release-bundle commit/);
  assert.match(fastPath.rejectedBecause, /durable journal trail/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes memory-headroom commit authorization shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'receipt-cursor-memory-headroom-authorizes-commit',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /memory headroom/);
  assert.match(fastPath.rejectedBecause, /live compares survived the pause/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'atomic-groups', 'durable-progress', 'live-preconditions'],
  );
});

test('guarded benchmark exposes queue-headroom commit authorization shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /queue headroom/);
  assert.match(fastPath.rejectedBecause, /survived the retry well enough to authorize commit/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'atomic-groups', 'durable-progress', 'live-preconditions'],
  );
});

test('guarded benchmark exposes queue-slack commit authorization shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'cached-receipt-cursor-queue-slack-authorizes-commit-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /queue slack/);
  assert.match(fastPath.rejectedBecause, /survived the pause well enough to authorize commit/);
  assert.deepEqual(
    fastPath.violates,
    ['backpressure', 'atomic-groups', 'durable-progress', 'live-preconditions'],
  );
});

test('guarded benchmark exposes parallel atomic-group commit shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'parallelize-atomic-group-commit',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /atomic group commits in parallel/);
  assert.match(fastPath.rejectedBecause, /single visibility point/);
  assert.deepEqual(
    fastPath.violates,
    ['atomic-groups', 'visibility-boundary'],
  );
});

test('guarded benchmark exposes parallel db-batch visibility shortcuts across groups as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'parallelize-db-batch-visibility-across-groups',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /database batches from different atomic groups in parallel/);
  assert.match(fastPath.rejectedBecause, /group-owned commit barrier/);
  assert.deepEqual(
    fastPath.violates,
    ['atomic-groups', 'row-preconditions', 'visibility-boundary'],
  );
});

test('guarded benchmark exposes parallel chunk visibility shortcuts across groups as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'parallelize-chunk-visibility-across-groups',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /chunk uploads from different atomic groups become visible/);
  assert.match(fastPath.rejectedBecause, /owning group barrier/);
  assert.deepEqual(
    fastPath.violates,
    ['atomic-groups', 'chunk-receipts', 'visibility-boundary'],
  );
});

test('guarded benchmark exposes unbounded plugin-install finalize shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'unbounded-parallel-plugin-install-finalize',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /plugin install finalize work/i);
  assert.match(fastPath.rejectedBecause, /backpressure and commit ordering/i);
  assert.deepEqual(
    fastPath.violates,
    ['atomic-groups', 'backpressure', 'durable-progress'],
  );
});

test('guarded benchmark exposes unbounded upload parallelism shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-unbounded-upload-parallelism-skips-backpressure',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /compressed remote index/i);
  assert.match(fastPath.rejectedBecause, /receipt and journal order/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes parallel chunk-send backpressure shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-parallel-chunk-sends-skips-backpressure',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /parallel chunk sends/i);
  assert.match(fastPath.rejectedBecause, /bounded queue order, complete chunk receipts, and journal evidence/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached file-hash windowing shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-file-hash-skips-large-upload-windowing',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /compressed remote index plus a cached file hash/i);
  assert.match(fastPath.rejectedBecause, /live compare, chunk receipts, or the guarded publish barrier/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'live-preconditions', 'atomic-file-publish', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached file-hash pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-file-hash-skips-large-upload-chunk-upload-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /skip large-upload chunk upload after a pause/i);
  assert.match(fastPath.rejectedBecause, /chunk acknowledgements survived the pause/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'file-hashing', 'chunk-receipts', 'backpressure', 'atomic-file-publish', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached receipt-cursor publish shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-receipt-cursor-skips-large-upload-chunk-publish-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /cached receipt cursor/i);
  assert.match(fastPath.rejectedBecause, /guarded publish boundary/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'chunk-receipts', 'backpressure', 'atomic-file-publish', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and parallel chunk-send large-upload pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /extra chunk parallelism/i);
  assert.match(fastPath.rejectedBecause, /bounded queue order/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached chunk-receipt backpressure shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-backpressure',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /cached chunk receipts/i);
  assert.match(fastPath.rejectedBecause, /queue stayed bounded or that the durable receipts survived/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'chunk-receipts', 'backpressure', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached chunk-receipt chunk-send shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-chunk-send-backpressure',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /skip backpressure during large-upload chunk sends/i);
  assert.match(fastPath.rejectedBecause, /bounded chunk fanout, complete receipt order, and durable journal evidence/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'chunk-receipts', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached chunk-receipt publish shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-publish-backpressure',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /skip backpressure before the large-upload publish step/i);
  assert.match(fastPath.rejectedBecause, /guarded publish barrier is still intact/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'atomic-file-publish', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached chunk-receipt windowing shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-chunk-receipts-skips-large-upload-windowing',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /skip large-upload window sizing after a pause/i);
  assert.match(fastPath.rejectedBecause, /next bounded window still matches the live queue order/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'backpressure', 'chunk-receipts', 'durable-progress', 'atomic-file-publish'],
  );
});

test('guarded benchmark exposes mixed large-upload and plugin-update recovery shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-parallel-chunk-and-row-fanout-skips-large-upload-and-plugin-update-recovery-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /large upload and a plugin update after a pause/i);
  assert.match(fastPath.rejectedBecause, /chunk acknowledgements, row receipts, live compares, or atomic-group barriers survived the pause/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'chunk-receipts', 'row-preconditions', 'live-preconditions', 'atomic-file-publish', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and parallel row-batch pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /skip plugin-update backpressure after pause/i);
  assert.match(fastPath.rejectedBecause, /paused row receipts, idempotency keys, or atomic-group commit record survived failure/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'parallelism-limits', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and parallel row-batch commit shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /skip the plugin-update commit barrier/i);
  assert.match(fastPath.rejectedBecause, /live compares, staged metadata writes, or atomic-group barrier survived failure/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'parallelism-limits', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes cached dependency-graph plugin-update finalize shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'index-and-cached-dependency-graph-skips-plugin-update-finalize',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /cached dependency graph/i);
  assert.match(fastPath.rejectedBecause, /atomic-group finalize survived failure/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed cached dependency-graph plugin-update finalize shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /compressed remote index plus a cached dependency graph/i);
  assert.match(fastPath.rejectedBecause, /member metadata writes, or the atomic-group finalize survived failure/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed cached dependency-graph plugin-update activation pause shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /skip plugin-update activation after pause and backpressure/i);
  assert.match(fastPath.rejectedBecause, /activation change, live row compares, or atomic-group barrier survived the pause/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'backpressure', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed cached dependency-graph plugin-update dependency shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-dependency-checks',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'live');
  assert.match(fastPath.proposal, /skip plugin-update dependency checks/i);
  assert.match(fastPath.rejectedBecause, /live dependency checks, row preconditions, or the atomic-group barrier survived failure/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed cached dependency-graph plugin-update row-precondition shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-row-preconditions',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'live');
  assert.match(fastPath.proposal, /skip row preconditions in a plugin update/i);
  assert.match(fastPath.rejectedBecause, /cannot replace the live per-row compares or the atomic-group barrier/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'row-preconditions', 'atomic-groups', 'plugin-preconditions'],
  );
});

test('guarded benchmark exposes compressed cached dependency-graph plugin-update batch-sizing shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-batch-sizing',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'live');
  assert.match(fastPath.proposal, /skip bounded plugin-update batch sizing/i);
  assert.match(fastPath.rejectedBecause, /cannot prove the live row preconditions, batch receipts, or atomic-group boundary survived failure/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed cached dependency-graph plugin-update writeback shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /skip plugin update writeback/i);
  assert.match(
    fastPath.rejectedBecause,
    /live row compares, metadata writes, or the atomic-group barrier survived failure/i,
  );
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'plugin-preconditions', 'row-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached row-batch receipt commit shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /cached row batch receipts/i);
  assert.match(fastPath.rejectedBecause, /paused group still has its live compares, staged metadata writes, or atomic-group commit record intact/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'backpressure', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached row-batch receipt dependency shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /cached row-batch receipts/i);
  assert.match(fastPath.rejectedBecause, /dependency checks, live row compares, or the atomic-group barrier survived failure/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached row-batch receipt activation shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /cached row-batch receipts/i);
  assert.match(fastPath.rejectedBecause, /activation change, dependency checks, or the atomic-group commit survived failure/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached row-batch receipt finalize shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'group');
  assert.match(fastPath.proposal, /cached row-batch receipts/i);
  assert.match(fastPath.rejectedBecause, /dependency checks, per-row preconditions, or the atomic-group finalize survived failure/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'row-preconditions', 'plugin-preconditions', 'atomic-groups', 'durable-progress'],
  );
});

test('guarded benchmark exposes compressed remote-index and cached row-receipt row-batching shortcuts as rejected', () => {
  const fastPath = findRejectedFastPathById(
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
  );

  assert.ok(fastPath);
  assert.equal(fastPath.rejectedGate, 'recovery');
  assert.match(fastPath.proposal, /skip plugin-update row-batch recovery after a pause/i);
  assert.match(fastPath.rejectedBecause, /live row compares, batch ordering, or the atomic-group barrier survived failure/i);
  assert.deepEqual(
    fastPath.violates,
    ['remote-index-planning-only', 'compression', 'row-preconditions', 'backpressure', 'atomic-groups', 'durable-progress'],
  );
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

test('guarded benchmark keeps paired row-batch and storage detail hidden when atomic-group metadata is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisible,
    false,
  );
  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
  assert.equal(
    blockers.includes('production-storage-receipts-and-row-batch-visible-without-atomic-group-metadata'),
    true,
  );
});

test('guarded benchmark blocks paired storage-receipts and row-batch visibility when atomic-group metadata is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(
    blockers.includes('production-storage-receipts-and-row-batch-visible-without-atomic-group-metadata'),
    true,
  );
  assert.equal(blockers.includes('production-storage-receipts-without-atomic-group-metadata'), true);
  assert.equal(blockers.includes('production-row-batch-executor-without-atomic-group-metadata'), true);
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

test('guarded benchmark keeps paired row-batch and storage detail hidden when atomic-commit visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = false;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisible,
    false,
  );
  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
  assert.equal(
    blockers.includes('production-row-batch-executor-visible-and-storage-receipts-visible-without-atomic-commit'),
    true,
  );
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
  tampered.evidence.backpressure.queueHeadroomMeasured = false;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('queue-budget-visible-without-memory-ceiling-visibility'), true);
  assert.equal(blockers.includes('queue-budget-not-visible'), false);
  assert.equal(
    productionThroughputDetails(tampered).queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
});

test('guarded benchmark blocks forged queue-budget and queue-headroom visibility without a measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueBudgetVisible = true;
  tampered.evidence.backpressure.queueHeadroomVisible = true;
  tampered.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured, false);
  assert.equal(blockers.includes('queue-budget-visible-without-queue-headroom-measurement'), true);
});

test('guarded benchmark blocks forged memory-ceiling visibility without queue-budget visibility', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  tampered.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorMemoryCeilingVisibleAndMeasured, false);
  assert.equal(blockers.includes('memory-ceiling-visible-without-queue-budget-visibility'), true);
  assert.equal(blockers.includes('queue-budget-visible-without-memory-ceiling-visibility'), false);
});

test('guarded benchmark blocks paired queue-budget and memory-ceiling detail when queue-headroom visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueBudgetVisible = true;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  tampered.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.queueBudgetVisible, true);
  assert.equal(details.receiptCursorMemoryCeilingVisible, true);
  assert.equal(details.queueHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.equal(blockers.includes('memory-ceiling-visible-without-queue-headroom-visible'), true);
});

test('guarded benchmark blocks forged memory-ceiling match visibility without a matching queue-budget surface', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueBudgetVisible = true;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorMemoryCeilingMatchesQueueBudgetVisible, false);
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.equal(blockers.includes('queue-budget-visible-without-memory-ceiling-match-visibility'), true);
});

test('guarded benchmark keeps paired queue-budget and memory-headroom details false when memory-ceiling-match visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = false;

  const details = productionThroughputDetails(tampered);

  assert.equal(details.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
});

test('guarded benchmark blocks memory-ceiling match visibility without queue-budget visibility', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueBudgetVisible = false;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = true;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('memory-ceiling-match-visible-without-queue-budget-visibility'), true);
  assert.equal(blockers.includes('queue-budget-visible-without-memory-ceiling-match-visibility'), false);
});

test('guarded benchmark blocks memory-ceiling match visibility without memory-ceiling visibility', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueBudgetVisible = true;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorMemoryCeilingVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingMatchesQueueBudgetVisible,
    false,
  );
  assert.equal(blockers.includes('memory-ceiling-match-visible-without-memory-ceiling-visibility'), true);
  assert.equal(blockers.includes('memory-ceiling-match-visible-without-queue-budget-visibility'), false);
});

test('guarded benchmark blocks memory-ceiling match visibility without queue-headroom visibility', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueHeadroomVisible = false;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.queueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingMatchesQueueBudgetVisible,
    false,
  );
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.equal(
    blockers.includes('memory-ceiling-match-visible-without-queue-headroom-visibility'),
    true,
  );
});

test('guarded benchmark blocks memory-ceiling match visibility without queue-headroom measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueHeadroomMeasured = false;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingMatchesQueueBudgetVisible,
    false,
  );
  assert.equal(
    blockers.includes('memory-ceiling-match-visible-without-queue-headroom-measurement'),
    true,
  );
});

test('guarded benchmark keeps queue-budget and queue-headroom paired details hidden when memory-ceiling-match visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.queueBudgetVisible, true);
  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.equal(blockers.includes('queue-budget-visible-without-memory-ceiling-match-visibility'), true);
});

test('guarded benchmark keeps memory-ceiling and queue-headroom paired details hidden when memory-ceiling-match visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorMemoryCeilingVisible, true);
  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
    false,
  );
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.equal(blockers.includes('queue-budget-visible-without-memory-ceiling-match-visibility'), true);
});

test('guarded benchmark blocks memory-ceiling match visibility without receipt-cursor memory-headroom visibility', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryHeadroomVisible = false;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingMatchesQueueBudgetVisible,
    false,
  );
  assert.equal(
    blockers.includes('memory-ceiling-match-visible-without-memory-headroom-visibility'),
    true,
  );
});

test('guarded benchmark blocks memory-ceiling match visibility without receipt-cursor queue-slack visibility', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorQueueSlackVisible = false;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorQueueSlackVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingMatchesQueueBudgetVisible,
    false,
  );
  assert.equal(
    blockers.includes('memory-ceiling-match-visible-without-queue-slack-visibility'),
    true,
  );
});

test('guarded benchmark blocks memory-ceiling visibility when queue-headroom visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  tampered.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe, false);
  assert.equal(blockers.includes('memory-ceiling-visible-without-queue-headroom-visible'), true);
  assert.equal(blockers.includes('queue-headroom-visible-without-queue-budget-visibility'), false);
});

test('guarded benchmark blocks queue-headroom visibility when memory-ceiling visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueHeadroomVisible = true;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe, false);
  assert.equal(blockers.includes('queue-headroom-visible-without-memory-ceiling-visibility'), true);
  assert.equal(blockers.includes('memory-ceiling-visible-without-queue-headroom-visible'), false);
});

test('guarded benchmark blocks queue-headroom visibility when receipt-cursor memory headroom visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueHeadroomVisible = true;
  tampered.evidence.backpressure.receiptCursorMemoryHeadroomVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.equal(
    blockers.includes('queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility'),
    true,
  );
  assert.equal(
    blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility'),
    false,
  );
});

test('guarded benchmark blocks forged memory-ceiling visibility without queue-headroom measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  tampered.evidence.backpressure.queueHeadroomMeasured = false;
  tampered.evidence.backpressure.queueHeadroomVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorMemoryCeilingVisibleAndMeasured, false);
  assert.equal(blockers.includes('memory-ceiling-visible-without-queue-headroom-measurement'), true);
});

test('guarded benchmark treats queue-headroom visibility as incomplete without a measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueHeadroomVisible = true;
  tampered.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(tampered);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasured, false);
});

test('guarded benchmark blocks staged-disk headroom visibility without a measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.stagingDiskHeadroomVisible = true;
  tampered.evidence.backpressure.stagingDiskHeadroomMeasured = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.stagingDiskHeadroomVisible, true);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.stagingDiskHeadroomVisibleAndMeasured, false);
  assert.equal(blockers.includes('staging-disk-headroom-visible-without-measurement'), true);
});

test('guarded benchmark blocks when the production staging-disk ceiling is not measured', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.resourceLimits.maxStagingDiskBytes = 0;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('production-staging-disk-ceiling-not-measured'), true);
});

test('guarded benchmark blocks when staging-disk headroom evidence is missing', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.stagingDiskHeadroomBytes = null;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.stagingDiskHeadroomPositive, false);
  assert.equal(details.backpressureConsistency.stagingDiskHeadroomPositive, false);
  assert.equal(blockers.includes('missing-staging-disk-headroom-evidence'), true);
});

test('guarded benchmark blocks when staging-disk headroom is not positive', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.stagingDiskHeadroomBytes = 0;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.stagingDiskHeadroomPositive, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasured, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasuredAfterPause, false);
  assert.equal(details.backpressureConsistency.stagingDiskHeadroomPositive, false);
  assert.equal(details.backpressureConsistency.stagingDiskHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.stagingDiskHeadroomVisibleAndMeasuredAfterPause,
    false,
  );
  assert.equal(blockers.includes('staging-disk-headroom-not-positive'), true);
});

test('guarded benchmark blocks queue-headroom visibility when the aligned slack proof is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueHeadroomVisible = true;
  tampered.evidence.backpressure.queueHeadroomMeasured = true;
  tampered.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMeasuredAndAligned,
    false,
  );
  assert.equal(
    blockers.includes('queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'),
    true,
  );
});

test('guarded benchmark blocks staged-disk headroom visibility when the aligned pause proof is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.stagingDiskHeadroomVisible = true;
  tampered.evidence.backpressure.stagingDiskHeadroomMeasured = true;
  tampered.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.stagingDiskHeadroomVisibleAndMeasured, true);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasuredAfterPause, false);
  assert.equal(
    details.backpressureConsistency.stagingDiskHeadroomVisibleAndMeasuredAfterPause,
    false,
  );
  assert.equal(
    blockers.includes('staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'),
    true,
  );
});

test('guarded benchmark fails closed when staged-disk headroom visibility disappears after a pause', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.stagingDiskHeadroomVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.stagingDiskHeadroomVisible, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasured, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasuredAfterPause, false);
  assert.equal(
    details.backpressureConsistency.stagingDiskHeadroomVisibleAndMeasuredAfterPause,
    false,
  );
  assert.equal(blockers.includes('staging-disk-headroom-not-visible'), true);
  assert.equal(blockers.includes('backpressure-evidence-incomplete'), true);
});

test('guarded benchmark keeps staged-disk post-pause visibility fail closed when queue-budget visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.stagingDiskHeadroomVisibleAndMeasured, true);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasuredAfterPause, false);
  assert.equal(
    details.backpressureConsistency.stagingDiskHeadroomVisibleAndMeasuredAfterPause,
    false,
  );
  assert.equal(
    blockers.includes('staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'),
    true,
  );
});

test('guarded benchmark blocks staged-disk headroom visibility when memory-ceiling-match visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.stagingDiskHeadroomVisibleAndMeasured, true);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasuredAfterPause, false);
  assert.equal(
    details.backpressureConsistency.stagingDiskHeadroomVisibleAndMeasuredAfterPause,
    false,
  );
  assert.equal(
    blockers.includes('staging-disk-headroom-visible-without-memory-ceiling-match-visibility'),
    true,
  );
  assert.equal(
    blockers.includes('staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'),
    true,
  );
});

test('guarded benchmark keeps pause-footprint and staged-disk-after-pause details hidden when the queue never paused', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queuePausedBeforeOverflow = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasuredAfterPause, false);
  assert.equal(details.backpressureConsistency.queuePausedBeforeOverflow, false);
  assert.equal(blockers.includes('queue-did-not-pause-before-overflow'), true);
});

test('guarded benchmark blocks staged-disk headroom evidence outside the plan reserve', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.stagingDiskHeadroomWithinPlanReserve = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.stagingDiskHeadroomWithinPlanReserve, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.stagingDiskHeadroomVisibleAndMeasured, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasuredAfterPause, false);
  assert.equal(
    details.backpressureConsistency.stagingDiskHeadroomWithinPlanReserve,
    false,
  );
  assert.equal(blockers.includes('staging-disk-headroom-outside-plan-reserve'), true);
});

test('guarded benchmark blocks paired queue-budget and memory-ceiling detail when the aligned slack proof is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueBudgetVisible = true;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  tampered.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(
    blockers.includes('queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof'),
    true,
  );
});

test('guarded benchmark blocks paired queue-budget and queue-headroom detail when the aligned slack proof is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueBudgetVisible = true;
  tampered.evidence.backpressure.queueHeadroomVisible = true;
  tampered.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    blockers.includes('queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'),
    true,
  );
});

test('guarded benchmark blocks paired memory-ceiling and queue-headroom detail when the aligned slack proof is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  tampered.evidence.backpressure.queueHeadroomVisible = true;
  tampered.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible,
    false,
  );
  assert.equal(
    blockers.includes('memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'),
    true,
  );
});

test('guarded benchmark blocks paired memory-ceiling and queue-headroom visibility when the headroom probe is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.backpressure.queueHeadroomMeasured = false;
  tampered.evidence.backpressure.queueHeadroomVisible = true;
  tampered.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
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

test('guarded benchmark blocks atomic-group metadata visibility when storage-receipts measurement is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.productionAtomicGroupMetadataVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.productionAtomicGroupMetadataVisibleAndMeasured, false);
  assert.equal(
    blockers.includes('production-atomic-group-metadata-visible-without-storage-receipts-measurement'),
    true,
  );
  assert.equal(blockers.includes('production-atomic-group-metadata-visible-without-atomic-commit'), false);
});

test('guarded benchmark treats metadata visibility without atomic-group measurement as incomplete evidence', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.productionAtomicGroupMetadataVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.productionAtomicGroupMetadataVisibleAndMeasured, false);
  assert.equal(blockers.includes('production-atomic-group-metadata-visible-without-measurement'), true);
});

test('guarded benchmark keeps atomic-group metadata visible-and-measured detail hidden when atomic-commit visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = false;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.productionAtomicGroupMetadataVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.productionAtomicGroupMetadataVisibleAndMeasured, false);
  assert.equal(blockers.includes('production-atomic-group-metadata-visible-without-atomic-commit'), true);
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

test('guarded benchmark blocks storage-receipts visibility without measurement', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = false;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('production-storage-receipts-visible-without-measurement'), true);
  assert.equal(blockers.includes('production-storage-receipts-not-visible'), false);
});

test('guarded benchmark blocks storage-receipts and atomic-commit paired visibility when metadata is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured, false);
  assert.equal(
    blockers.includes('production-storage-receipts-visible-and-atomic-commit-visible-without-metadata'),
    true,
  );
  assert.equal(blockers.includes('production-storage-receipts-without-atomic-group-metadata'), true);
});

test('guarded benchmark keeps storage-receipts and atomic-commit measured detail hidden when metadata is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured, false);
  assert.equal(
    details.atomicGroup.productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured,
    false,
  );
  assert.equal(
    blockers.includes('production-storage-receipts-visible-and-atomic-commit-visible-without-metadata'),
    true,
  );
});

test('guarded benchmark keeps storage-receipts and atomic-commit visible detail hidden when metadata is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;

  const details = productionThroughputDetails(tampered);

  assert.equal(details.productionStorageReceiptsVisibleAndAtomicCommitVisible, false);
  assert.equal(
    details.atomicGroup.productionStorageReceiptsVisibleAndAtomicCommitVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionStorageReceiptsVisibleAndAtomicCommitVisible,
    false,
  );
});

test('guarded benchmark keeps atomic rollout visibility pairs hidden when atomic-commit measurement is missing', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = false;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.productionAtomicGroupMetadataVisibleAndMeasured, false);
  assert.equal(
    details.atomicGroup.productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
    false,
  );
  assert.equal(details.productionStorageReceiptsVisibleAndAtomicCommitVisible, false);
  assert.equal(
    details.atomicGroup.productionStorageReceiptsVisibleAndAtomicCommitVisible,
    false,
  );
  assert.equal(details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisible, false);
  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionStorageReceiptsVisibleAndAtomicCommitVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionRowBatchExecutorVisibleAndStorageReceiptsVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
  assert.ok(
    blockers.includes(
      'production-storage-receipts-visible-and-atomic-commit-visible-without-atomic-commit-measurement',
    ),
  );
  assert.ok(
    blockers.includes('production-atomic-group-metadata-visible-without-measurement'),
  );
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
  assert.equal(details.parallelismLimitsVisibleAndCanonical, false);
  assert.equal(details.atomicGroup.parallelismLimitsVisible, false);
  assert.equal(details.backpressureConsistency.parallelismLimitsVisible, false);
  assert.equal(details.backpressureConsistency.parallelismLimitsVisibleAndCanonical, false);
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
  assert.equal(details.parallelismLimitsVisibleAndCanonical, false);
  assert.equal(details.parallelismLimitsVisibleMeasuredAndCanonical, false);
  assert.equal(details.backpressureConsistency.parallelismLimitsVisibleAndCanonical, false);
  assert.equal(
    details.backpressureConsistency.parallelismLimitsVisibleMeasuredAndCanonical,
    false,
  );
  assert.equal(blockers.includes('production-parallelism-limits-visible-without-canonical'), true);
  assert.equal(blockers.includes('production-parallelism-limits-not-canonical'), true);
});

test('guarded benchmark blocks visible measured parallelism limits when they are not integral', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimits.chunkUpload = 3.5;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.parallelismLimitsIntegral, false);
  assert.equal(details.parallelismLimitsVisible, false);
  assert.equal(details.parallelismLimitsVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.parallelismLimitsVisibleAndMeasured, false);
  assert.equal(blockers.includes('production-parallelism-limits-visible-without-integral'), true);
  assert.equal(blockers.includes('production-parallelism-limits-not-integral'), true);
});

test('guarded benchmark details fail closed when visible measured parallelism caps are non-positive', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimits.dbBatchPerTable = 0;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.parallelismLimitsPositive, false);
  assert.equal(details.parallelismLimitsIntegral, true);
  assert.equal(details.parallelismLimitsVisibleAndMeasured, false);
  assert.equal(details.atomicGroup.parallelismLimitsVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.parallelismLimitsVisibleAndMeasured, false);
  assert.equal(
    blockers.includes('production-parallelism-limits-visible-without-positive'),
    true,
  );
  assert.equal(blockers.includes('production-parallelism-limits-not-measured'), true);
});

test('guarded benchmark keeps rollout summaries pinned to visible-without-positive parallelism blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimits.dbBatchPerTable = 0;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-measured',
        'production-parallelism-limits-not-canonical',
        'production-parallelism-limits-visible-without-positive',
        'production-parallelism-limits-visible-without-canonical',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'file-hashing-concurrency',
    ),
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-measured',
        'production-parallelism-limits-not-canonical',
        'production-parallelism-limits-visible-without-positive',
        'production-parallelism-limits-visible-without-canonical',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-measured',
        'production-parallelism-limits-not-canonical',
        'production-parallelism-limits-visible-without-positive',
        'production-parallelism-limits-visible-without-canonical',
        'production-row-batch-executor-visible-without-parallelism-limits',
      ],
    },
  );
  assert.ok(blockers.includes('production-parallelism-limits-not-measured'));
  assert.ok(blockers.includes('production-parallelism-limits-not-canonical'));
  assert.ok(blockers.includes('production-parallelism-limits-visible-without-positive'));
  assert.ok(blockers.includes('production-parallelism-limits-visible-without-canonical'));
  assert.deepEqual(
    details.rejectedFastPaths.filter((entry) => [
      'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
      'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
      'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation',
      'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize',
      'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback',
      'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
      'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
      'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
    ].includes(entry.id)).map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-parallelism-limits-not-measured',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-positive',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.deepEqual(details.rejectedFastPathGateSummary, [
    { rejectedGate: 'group', count: 13 },
    { rejectedGate: 'recovery', count: 7 },
  ]);
});

test('guarded benchmark keeps rollout summaries pinned to non-integral parallelism blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimits.dbBatchPerTable = 4.5;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.parallelismLimitsIntegral, false);
  assert.equal(details.parallelismLimitsVisible, false);
  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-integral',
        'production-parallelism-limits-not-canonical',
        'production-parallelism-limits-visible-without-integral',
        'production-parallelism-limits-visible-without-canonical',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'file-hashing-concurrency',
    ),
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-integral',
        'production-parallelism-limits-not-canonical',
        'production-parallelism-limits-visible-without-integral',
        'production-parallelism-limits-visible-without-canonical',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-integral',
        'production-parallelism-limits-not-canonical',
        'production-parallelism-limits-visible-without-integral',
        'production-parallelism-limits-visible-without-canonical',
        'production-row-batch-executor-visible-without-parallelism-limits',
      ],
    },
  );
  assert.ok(blockers.includes('production-parallelism-limits-not-integral'));
  assert.ok(blockers.includes('production-parallelism-limits-not-canonical'));
  assert.ok(blockers.includes('production-parallelism-limits-visible-without-integral'));
  assert.ok(blockers.includes('production-parallelism-limits-visible-without-canonical'));
  assert.deepEqual(
    details.rejectedFastPaths.filter((entry) => [
      'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
      'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
      'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
      'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
      'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
    ].includes(entry.id)).map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-parallelism-limits-not-integral',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-integral',
          'production-parallelism-limits-visible-without-canonical',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-integral',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-integral',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-integral',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-integral',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-parallelism-limits-not-integral',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-integral',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-integral',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-integral',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-integral',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-integral',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-integral',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-integral',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-integral',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-integral',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-parallelism-limits-not-integral',
          'production-parallelism-limits-not-canonical',
          'production-parallelism-limits-visible-without-integral',
          'production-parallelism-limits-visible-without-canonical',
          'production-row-batch-executor-visible-without-parallelism-limits',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.deepEqual(details.rejectedFastPathGateSummary, [
    { rejectedGate: 'group', count: 13 },
    { rejectedGate: 'recovery', count: 7 },
  ]);
});

test('guarded benchmark keeps paired row-batch and storage detail hidden when parallelism caps are noncanonical', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimits.chunkUpload = 3;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
  assert.equal(blockers.includes('production-parallelism-limits-visible-without-canonical'), true);
  assert.equal(blockers.includes('production-row-batch-executor-visible-without-parallelism-limits'), true);
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

test('guarded benchmark blocks atomic-group metadata proof when the atomic group stops being ready', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.groupStatus = 'blocked';

  const blockers = productionThroughputBlockers(tampered);

  assert.equal(blockers.includes('production-atomic-group-metadata-not-proven'), true);
  assert.equal(blockers.includes('production-atomic-group-metadata-not-visible'), false);
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

test('guarded benchmark keeps row-batch and atomic-commit visible detail hidden when metadata is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;

  const details = productionThroughputDetails(tampered);

  assert.equal(details.atomicGroup.productionRowBatchExecutorVisibleAndAtomicCommitVisible, false);
  assert.equal(
    details.backpressureConsistency.productionRowBatchExecutorVisibleAndAtomicCommitVisible,
    false,
  );
});

test('guarded benchmark keeps row-batch rollout summary pinned to atomic-group metadata blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = false;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'production-atomic-group-metadata-not-visible',
        'production-atomic-group-commit-visible-without-metadata',
        'production-storage-receipts-without-atomic-group-metadata',
        'production-storage-receipts-visible-and-atomic-commit-visible-without-metadata',
        'production-storage-receipts-and-row-batch-visible-without-atomic-group-metadata',
        'production-row-batch-executor-without-atomic-group-metadata',
      ],
    },
  );
});

test('guarded benchmark keeps row-batch rollout summary pinned to hidden atomic-commit blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = false;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'production-atomic-group-commit-not-visible',
        'production-atomic-group-metadata-visible-without-atomic-commit',
        'production-storage-receipts-without-atomic-commit',
        'production-row-batch-executor-visible-and-storage-receipts-visible-without-atomic-commit',
        'production-row-batch-executor-without-atomic-commit',
      ],
    },
  );
});

test('guarded benchmark keeps row-batch and atomic-commit visible detail hidden when atomic commit measurement is missing', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = false;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.equal(details.atomicGroup.productionRowBatchExecutorVisibleAndAtomicCommitVisible, false);
  assert.equal(
    details.backpressureConsistency.productionRowBatchExecutorVisibleAndAtomicCommitVisible,
    false,
  );
});

test('guarded benchmark blocks row-batch executor visibility without visible measured parallelism caps', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.parallelismLimitsVisible, false);
  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisible,
    true,
  );
  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
  assert.equal(
    blockers.includes('production-row-batch-executor-visible-without-parallelism-limits'),
    true,
  );
  assert.equal(blockers.includes('production-parallelism-limits-not-visible'), true);
});

test('guarded benchmark keeps rollout summaries pinned to hidden parallelism-limit blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = false;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'production-parallelism-limits-not-visible',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'file-hashing-concurrency',
    ),
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'production-parallelism-limits-not-visible',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'production-parallelism-limits-not-visible',
        'production-row-batch-executor-visible-without-parallelism-limits',
      ],
    },
  );
});

test('guarded benchmark carries direct staging-disk visibility blockers into upload rollout summaries', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.backpressure.stagingDiskHeadroomVisible = true;
  tampered.evidence.backpressure.stagingDiskHeadroomMeasured = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'staging-disk-headroom-visible-without-measurement',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'file-hashing-concurrency',
    ),
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'staging-disk-headroom-visible-without-measurement',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
  );
  assert.equal(blockers.includes('staging-disk-headroom-visible-without-measurement'), true);
  assert.deepEqual(
    details.rejectedFastPaths.filter((entry) => [
      'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
      'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
      'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
      'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
    ].includes(entry.id)).map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-measurement',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.deepEqual(details.rejectedFastPathGateSummary, [
    { rejectedGate: 'recovery', count: 2 },
  ]);
});

test('guarded benchmark carries direct queue-headroom measurement blockers into rollout summaries', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-budget-visible-without-queue-headroom-measurement',
        'memory-ceiling-visible-without-queue-headroom-measurement',
        'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        'queue-headroom-visible-without-measurement',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'file-hashing-concurrency',
    ),
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-budget-visible-without-queue-headroom-measurement',
        'memory-ceiling-visible-without-queue-headroom-measurement',
        'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        'queue-headroom-visible-without-measurement',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-budget-visible-without-queue-headroom-measurement',
        'memory-ceiling-visible-without-queue-headroom-measurement',
        'queue-headroom-visible-without-measurement',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
  );
  assert.equal(blockers.includes('queue-budget-visible-without-queue-headroom-measurement'), true);
  assert.equal(blockers.includes('memory-ceiling-visible-without-queue-headroom-measurement'), true);
  assert.equal(blockers.includes('queue-headroom-visible-without-measurement'), true);
  assert.deepEqual(
    details.rejectedFastPaths.filter((entry) => [
      'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
      'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
      'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
      'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
    ].includes(entry.id)).map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-slack-authorizes-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'receipt-cursor-queue-slack-visible-without-queue-headroom-measurement',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-measurement',
        ],
      },
      {
        id: 'cached-receipt-cursor-memory-headroom-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'receipt-cursor-queue-slack-visible-without-queue-headroom-measurement',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-measurement',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-without-queue-headroom-measurement',
          'memory-ceiling-visible-without-queue-headroom-measurement',
          'queue-headroom-visible-without-measurement',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-without-queue-headroom-measurement',
          'memory-ceiling-visible-without-queue-headroom-measurement',
          'queue-headroom-visible-without-measurement',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.deepEqual(details.rejectedFastPathGateSummary, [
    { rejectedGate: 'recovery', count: 6 },
  ]);
});

test('guarded benchmark keeps rollout summaries pinned to visible-without-measurement parallelism blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = false;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'chunk-upload-concurrency',
    ),
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-visible',
        'production-parallelism-limits-visible-without-measurement',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'file-hashing-concurrency',
    ),
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-visible',
        'production-parallelism-limits-visible-without-measurement',
      ],
    },
  );
  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-parallelism-limits-not-visible',
        'production-parallelism-limits-visible-without-measurement',
        'production-row-batch-executor-visible-without-parallelism-limits',
      ],
    },
  );
  assert.ok(blockers.includes('production-parallelism-limits-not-visible'));
  assert.ok(blockers.includes('production-parallelism-limits-visible-without-measurement'));
  assert.deepEqual(
    details.rejectedFastPaths.filter((entry) => [
      'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
      'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
      'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
      'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
      'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
      'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
    ].includes(entry.id)).map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-parallelism-limits-not-visible',
          'production-parallelism-limits-visible-without-measurement',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-visible',
          'production-parallelism-limits-visible-without-measurement',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-visible',
          'production-parallelism-limits-visible-without-measurement',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-parallelism-limits-not-visible',
          'production-parallelism-limits-visible-without-measurement',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-visible',
          'production-parallelism-limits-visible-without-measurement',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-visible',
          'production-parallelism-limits-visible-without-measurement',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-visible',
          'production-parallelism-limits-visible-without-measurement',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-parallelism-limits-not-visible',
          'production-parallelism-limits-visible-without-measurement',
          'production-row-batch-executor-visible-without-parallelism-limits',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.deepEqual(details.rejectedFastPathGateSummary, [
    { rejectedGate: 'group', count: 6 },
    { rejectedGate: 'recovery', count: 4 },
  ]);
});

test('guarded benchmark details fail closed when atomic commit capability is present but the evidence bit is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = false;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.equal(details.productionAtomicCommitMeasured, false);
  assert.equal(details.atomicGroup.productionAtomicCommitMeasured, false);
  assert.equal(details.productionAtomicGroupMetadataVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.productionAtomicGroupMetadataVisibleAndMeasured, false);
});

test('guarded benchmark keeps atomic-group metadata visible-and-measured detail hidden when storage-receipt measurement is missing', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = false;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = false;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.productionAtomicGroupMetadataVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.productionAtomicGroupMetadataVisibleAndMeasured, false);
  assert.ok(
    blockers.includes('production-atomic-group-metadata-visible-without-storage-receipts-measurement'),
  );
});

test('guarded benchmark details fail closed when storage and row-batch capabilities are present but evidence bits are hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = false;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = false;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.equal(details.productionStorageReceiptsMeasured, false);
  assert.equal(details.productionRowBatchExecutorMeasured, false);
  assert.equal(details.atomicGroup.productionStorageReceiptsMeasured, false);
  assert.equal(details.atomicGroup.productionRowBatchExecutorMeasured, false);
  assert.equal(details.productionStorageReceiptsVisibleAndAtomicCommitVisibleAndMeasured, false);
  assert.equal(
    details.atomicGroup.productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
    false,
  );
  assert.equal(details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisible, false);
  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    false,
  );
});

test('guarded benchmark keeps storage-receipts and atomic-group metadata visible detail hidden when atomic-commit visibility is hidden', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = false;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.equal(
    details.atomicGroup.productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
    false,
  );
});

test('guarded benchmark keeps storage visibility pairs hidden when storage-receipt measurement is missing', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = false;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(
    details.atomicGroup.productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
    false,
  );
  assert.equal(details.productionStorageReceiptsVisibleAndAtomicCommitVisible, false);
  assert.equal(
    details.atomicGroup.productionStorageReceiptsVisibleAndAtomicCommitVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionStorageReceiptsVisibleAndAtomicGroupMetadataVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionStorageReceiptsVisibleAndAtomicCommitVisible,
    false,
  );
  assert.ok(blockers.includes('production-storage-receipts-visible-without-measurement'));
  assert.ok(
    blockers.includes('production-storage-receipts-visible-and-atomic-commit-visible-without-measurement'),
  );
});

test('guarded benchmark keeps row-batch visibility pairs hidden when row-batch measurement is missing', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = false;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisible, false);
  assert.equal(details.atomicGroup.productionRowBatchExecutorVisibleAndAtomicCommitVisible, false);
  assert.equal(
    details.backpressureConsistency.productionRowBatchExecutorVisibleAndStorageReceiptsVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.productionRowBatchExecutorVisibleAndAtomicCommitVisible,
    false,
  );
  assert.ok(blockers.includes('production-row-batch-executor-visible-without-measurement'));
});

test('guarded benchmark keeps row-batch rollout summary pinned to row-batch measurement blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = false;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'production-row-batch-executor-measured-not-proven',
        'production-row-batch-executor-visible-without-measurement',
      ],
    },
  );
});

test('guarded benchmark keeps row-batch rollout summary pinned to hidden row-batch visibility blockers', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = false;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;

  const details = productionThroughputDetails(tampered);

  assert.deepEqual(
    details.productionCapabilityRolloutSummary.find(
      (entry) => entry.surface === 'row-batch-concurrency',
    ),
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'production-row-batch-executor-not-visible',
      ],
    },
  );
});

test('guarded benchmark accepts visible canonical parallelism caps for row-batch proof without precomputed claim details', () => {
  const report = smallBenchmark();
  const tampered = clone(report);

  tampered.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  tampered.executorCapabilities.fileReceipts = 'production-storage-receipts';
  tampered.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  tampered.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  tampered.evidence.atomicGroup.productionAtomicCommitVisible = true;
  tampered.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  tampered.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  tampered.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  tampered.evidence.parallelism.parallelismLimitsMeasured = true;
  tampered.evidence.parallelism.parallelismLimitsVisible = true;
  tampered.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  delete tampered.claims.productionThroughputDetails;

  const details = productionThroughputDetails(tampered);
  const blockers = productionThroughputBlockers(tampered);

  assert.equal(details.parallelismLimitsVisible, true);
  assert.equal(blockers.includes('production-parallelism-limits-not-visible'), false);
  assert.equal(
    blockers.includes('production-row-batch-executor-visible-without-parallelism-limits'),
    false,
  );
  assert.equal(
    details.atomicGroup.productionRowBatchExecutorVisibleAndStorageReceiptsVisibleAndMeasured,
    true,
  );
});

test('fast-path fixture rejects cached chunk hashes from skipping window sizing after a pause', () => {
  const fixture = buildFastPathFixture();
  const rejected = fixture.rejectedFastPaths.find(
    (fastPath) =>
      fastPath.id === 'compressed-remote-index-and-cached-chunk-hashes-skips-large-upload-window-sizing-after-pause',
  );

  assert.ok(rejected);
  assert.match(rejected.id, /window-sizing-after-pause$/);
  assert.equal(rejected.rejectedGate, 'recovery');
  assert.deepEqual(rejected.violates, [
    'remote-index-planning-only',
    'compression',
    'file-hashing',
    'chunk-receipts',
    'backpressure',
    'durable-progress',
  ]);
  assert.match(rejected.rejectedBecause, /guarded publish boundary/i);
});

test('fast-path fixture rejects compressed in-memory buffers from proving a plugin update already finished', () => {
  const fixture = buildFastPathFixture();
  const rejected = fixture.rejectedFastPaths.find(
    (fastPath) => fastPath.id === 'index-and-compressed-buffer-completes-plugin-update',
  );

  assert.ok(rejected);
  assert.equal(rejected.rejectedGate, 'recovery');
  assert.match(rejected.proposal, /compressed in-memory buffer/);
  assert.match(rejected.rejectedBecause, /row receipts/i);
  assert.deepEqual(rejected.violates, [
    'remote-index-planning-only',
    'compression',
    'backpressure',
    'plugin-preconditions',
    'row-preconditions',
    'atomic-groups',
    'durable-progress',
  ]);
});

test('fast-path fixture rejects compressed in-memory buffers from proving a plugin install already finished', () => {
  const fixture = buildFastPathFixture();
  const rejected = fixture.rejectedFastPaths.find(
    (fastPath) => fastPath.id === 'index-and-compressed-buffer-completes-plugin-install',
  );

  assert.ok(rejected);
  assert.equal(rejected.rejectedGate, 'recovery');
  assert.match(rejected.proposal, /compressed in-memory buffer/);
  assert.match(rejected.rejectedBecause, /metadata writes, file receipts/i);
  assert.deepEqual(rejected.violates, [
    'remote-index-planning-only',
    'compression',
    'backpressure',
    'plugin-preconditions',
    'atomic-groups',
    'durable-progress',
  ]);
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
  assert.equal(
    report.claims.productionThroughputDetails.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
    true,
  );
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
  assert.equal(report.claims.productionThroughputDetails.backpressureConsistency.receiptCursorQueueSlackVisible, true);
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
  assert.equal(report.claims.productionThroughputDetails.receiptCursorMemoryHeadroomVisible, true);
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
  const missingAlignedBackpressureDetails = productionThroughputDetails(missingAlignedBackpressureProof);
  assert.ok(
    productionThroughputBlockers(missingAlignedBackpressureProof).includes(
      'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
    ),
  );
  assert.equal(missingAlignedBackpressureDetails.receiptCursorPauseFootprintBaseComplete, true);
  assert.equal(missingAlignedBackpressureDetails.receiptCursorPauseFootprintComplete, false);
  assert.equal(missingAlignedBackpressureDetails.receiptCursorPauseFootprintVisible, false);
  assert.equal(missingAlignedBackpressureDetails.receiptCursorBackpressureWithinQueueBudget, false);
  assert.equal(missingAlignedBackpressureDetails.receiptCursorBackpressureWithinResourceHeadroom, false);
  assert.equal(missingAlignedBackpressureDetails.receiptCursorHeadroomMatchesResourceHeadroom, false);
  assert.equal(missingAlignedBackpressureDetails.queueHeadroomMatchesResourceHeadroom, false);
  assert.equal(missingAlignedBackpressureDetails.queueHeadroomMatchesMemoryHeadroom, false);
  assert.equal(
    missingAlignedBackpressureDetails.receiptCursorMemoryHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    missingAlignedBackpressureDetails.receiptCursorMemoryHeadroomWithinResourceHeadroom,
    false,
  );
  assert.equal(missingAlignedBackpressureDetails.queueHeadroomVisibleAndMeasured, false);
  assert.equal(missingAlignedBackpressureDetails.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(
    missingAlignedBackpressureDetails.backpressureConsistency.receiptCursorPauseFootprintBaseComplete,
    true,
  );
  assert.equal(
    missingAlignedBackpressureDetails.backpressureConsistency.receiptCursorBackpressureWithinQueueBudget,
    false,
  );
  assert.equal(
    missingAlignedBackpressureDetails.backpressureConsistency.receiptCursorBackpressureWithinResourceHeadroom,
    false,
  );
  assert.equal(
    missingAlignedBackpressureDetails.backpressureConsistency.receiptCursorHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    missingAlignedBackpressureDetails.backpressureConsistency.queueHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    missingAlignedBackpressureDetails.backpressureConsistency.queueHeadroomMatchesMemoryHeadroom,
    false,
  );
  assert.equal(
    missingAlignedBackpressureDetails.backpressureConsistency
      .receiptCursorMemoryHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    missingAlignedBackpressureDetails.backpressureConsistency
      .receiptCursorMemoryHeadroomWithinResourceHeadroom,
    false,
  );

  const missingBackpressureAlignedSlackProof = clone(report);
  missingBackpressureAlignedSlackProof.evidence.backpressure.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack = false;
  const missingBackpressureAlignedSlackProofDetails = productionThroughputDetails(
    missingBackpressureAlignedSlackProof,
  );
  assert.ok(
    productionThroughputBlockers(missingBackpressureAlignedSlackProof).includes(
      'queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack-proof',
    ),
  );
  assert.ok(
    productionThroughputBlockers(missingBackpressureAlignedSlackProof).includes(
      'queue-pause-without-consistent-measured-and-aligned-receipt-cursor-queue-slack',
    ),
  );
  assert.equal(
    missingBackpressureAlignedSlackProofDetails.backpressureConsistency
      .queuePauseHasBackpressureAlignedReceiptCursorQueueSlack,
    false,
  );
  assert.equal(
    missingBackpressureAlignedSlackProofDetails.backpressureConsistency.backpressureEvidenceComplete,
    false,
  );

  const missingResourceSafeBackpressure = clone(report);
  missingResourceSafeBackpressure.evidence.backpressure.receiptCursorBackpressureWithinResourceHeadroom = false;
  const missingResourceSafeBackpressureDetails = productionThroughputDetails(
    missingResourceSafeBackpressure,
  );
  assert.ok(
    productionThroughputBlockers(missingResourceSafeBackpressure).includes(
      'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    ),
  );
  assert.equal(
    missingResourceSafeBackpressureDetails.backpressureConsistency
      .receiptCursorBackpressureWithinResourceHeadroom,
    true,
  );
  assert.equal(
    missingResourceSafeBackpressureDetails.backpressureConsistency.backpressureEvidenceComplete,
    true,
  );

  const missingMemorySafeSlack = clone(report);
  missingMemorySafeSlack.evidence.backpressure.receiptCursorQueueSlackWithinMemoryCeiling = false;
  const missingMemorySafeSlackDetails = productionThroughputDetails(missingMemorySafeSlack);
  assert.ok(
    productionThroughputBlockers(missingMemorySafeSlack).includes(
      'queue-pause-without-memory-safe-receipt-cursor-slack',
    ),
  );
  assert.equal(
    missingMemorySafeSlackDetails.backpressureConsistency.receiptCursorQueueSlackWithinMemoryCeiling,
    true,
  );
  assert.equal(
    missingMemorySafeSlackDetails.backpressureConsistency.backpressureEvidenceComplete,
    true,
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

  const inconsistentPauseFootprint = clone(report);
  inconsistentPauseFootprint.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;
  assert.ok(
    productionThroughputBlockers(inconsistentPauseFootprint).includes(
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
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

test('guarded benchmark carries receipt-ledger blockers into receipt-driven rejected summaries', () => {
  const report = smallBenchmark();
  const expectedReceiptLedgerFamilies = [
    ['compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause', 'group'],
    ['compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation', 'group'],
    ['compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback', 'group'],
    ['compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause', 'recovery'],
    ['compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause', 'recovery'],
    ['compressed-remote-index-and-batched-row-receipts-skips-release-bundle-commit', 'group'],
    ['compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-activation', 'group'],
    ['compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize', 'group'],
    ['compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause', 'group'],
    ['compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback', 'group'],
    ['compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause', 'group'],
    ['compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause', 'group'],
    ['compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause', 'skip'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation', 'group'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure', 'recovery'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause', 'group'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback', 'group'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation', 'group'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause', 'recovery'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b', 'group'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks', 'group'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize', 'group'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize-variant-b', 'group'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions', 'group'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause', 'group'],
    ['compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure', 'recovery'],
    ['compressed-remote-index-and-cached-row-receipts-skips-plugin-install-activation', 'group'],
    ['compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause', 'recovery'],
    ['compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause', 'group'],
    ['compressed-remote-index-and-cached-row-receipts-skips-plugin-install-writeback', 'group'],
    ['compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation', 'group'],
    ['compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure', 'recovery'],
    ['compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize', 'group'],
    ['compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause', 'group'],
    ['compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause', 'recovery'],
    ['compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause', 'group'],
    ['compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause', 'group'],
  ];
  const tamperedLedger = clone(report);
  tamperedLedger.evidence.journal.successReceiptKindLedgerComplete = false;

  const tamperedLedgerDetails = productionThroughputDetails(tamperedLedger);
  const tamperedLedgerReceiptFamilies = tamperedLedgerDetails.rejectedFastPaths.filter((entry) =>
    entry.id.includes('receipt-flush')
    || entry.id.includes('row-receipts')
    || entry.id.includes('row-batch-receipts')
    || entry.id.includes('chunk-receipts'),
  );

  assert.ok(tamperedLedgerReceiptFamilies.some((entry) => entry.id.includes('receipt-flush')));
  assert.ok(tamperedLedgerReceiptFamilies.some((entry) => entry.id.includes('row-receipts')));
  assert.ok(tamperedLedgerReceiptFamilies.some((entry) => entry.id.includes('row-batch-receipts')));
  assert.ok(tamperedLedgerReceiptFamilies.some((entry) => entry.id.includes('chunk-receipts')));
  assert.deepEqual(
    tamperedLedgerReceiptFamilies
      .map(({ id, rejectedGate, blockerRefs }) => ({
        id,
        rejectedGate,
        blockerRefs: blockerRefs.filter((entry) => entry === 'receipt-ledger-kind-summary-not-proven'),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    expectedReceiptLedgerFamilies.map(([id, rejectedGate]) => ({
      id,
      rejectedGate,
      blockerRefs: ['receipt-ledger-kind-summary-not-proven'],
    })),
  );
  assert.deepEqual(summarizeRejectedGates(tamperedLedgerReceiptFamilies), [
    { rejectedGate: 'group', count: 28 },
    { rejectedGate: 'recovery', count: 8 },
    { rejectedGate: 'skip', count: 1 },
  ]);

  const mismatchedLedger = clone(report);
  mismatchedLedger.evidence.journal.successReceiptKindLedger.pop();

  const mismatchedLedgerDetails = productionThroughputDetails(mismatchedLedger);
  const mismatchedLedgerReceiptFamilies = mismatchedLedgerDetails.rejectedFastPaths.filter((entry) =>
    entry.id.includes('receipt-flush')
    || entry.id.includes('row-receipts')
    || entry.id.includes('row-batch-receipts')
    || entry.id.includes('chunk-receipts'),
  );

  assert.deepEqual(
    mismatchedLedgerReceiptFamilies
      .map(({ id, rejectedGate, blockerRefs }) => ({
        id,
        rejectedGate,
        blockerRefs: blockerRefs.filter((entry) => entry === 'receipt-ledger-kind-summary-mismatch'),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    expectedReceiptLedgerFamilies.map(([id, rejectedGate]) => ({
      id,
      rejectedGate,
      blockerRefs: ['receipt-ledger-kind-summary-mismatch'],
    })),
  );
  assert.deepEqual(summarizeRejectedGates(mismatchedLedgerReceiptFamilies), [
    { rejectedGate: 'group', count: 28 },
    { rejectedGate: 'recovery', count: 8 },
    { rejectedGate: 'skip', count: 1 },
  ]);
});

test('guarded benchmark carries non-kind-scoped receipt flush blockers into receipt-flush rollout summaries', () => {
  const report = smallBenchmark();
  const interleavedJournalKinds = clone(report);

  interleavedJournalKinds.evidence.journal.successRecordTypes = [
    'apply-staged',
    'chunk-receipt',
    'journal-opened',
    'target-planned',
    'dependencies-validated',
    'recovery-state',
  ];

  const details = productionThroughputDetails(interleavedJournalKinds);

  assert.deepEqual(
    details.rejectedFastPaths
      .filter((entry) => entry.id.includes('receipt-flush'))
      .map(({ id, blockerRefs }) => ({
        id,
        blockerRefs: blockerRefs.filter((blocker) => blocker === 'receipt-flushes-not-kind-scoped'),
      })),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
    ],
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

  const brokenJournalIntegrity = clone(report);
  brokenJournalIntegrity.evidence.journal.allJournalsIntegrityOk = false;
  assert.ok(
    productionThroughputBlockers(brokenJournalIntegrity).includes(
      'missing-durable-journal-integrity',
    ),
  );

  const exposedJournalValues = clone(report);
  exposedJournalValues.evidence.redaction.durableJournalsContainNoRawValues = false;
  assert.ok(
    productionThroughputBlockers(exposedJournalValues).includes(
      'durable-journal-redaction-not-proven',
    ),
  );

  const missingRecovery = clone(report);
  missingRecovery.evidence.recovery.partialCommitBlocksRecovery = false;
  assert.ok(
    productionThroughputBlockers(missingRecovery).includes('missing-partial-commit-recovery-evidence'),
  );

  const missingSuccessRecovery = clone(report);
  missingSuccessRecovery.evidence.recovery.successReplayInspectable = false;
  assert.ok(
    productionThroughputBlockers(missingSuccessRecovery).includes(
      'missing-success-recovery-evidence',
    ),
  );

  const missingPreCommitRecovery = clone(report);
  missingPreCommitRecovery.evidence.recovery.preCommitFailureInspectable = false;
  assert.ok(
    productionThroughputBlockers(missingPreCommitRecovery).includes(
      'missing-pre-commit-recovery-evidence',
    ),
  );

  const partialPreCommitVisibility = clone(report);
  partialPreCommitVisibility.evidence.atomicGroup.preCommitFailureLeavesRemoteUnchanged = false;
  assert.ok(
    productionThroughputBlockers(partialPreCommitVisibility).includes(
      'atomic-group-pre-commit-visibility-not-proven',
    ),
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
  assert.equal(
    productionThroughputDetails(invalidParallelismLimits).parallelismLimitsPositive,
    false,
  );
  assert.equal(
    productionThroughputDetails(invalidParallelismLimits).parallelismLimitsVisibleAndMeasured,
    false,
  );
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
  assert.equal(
    productionThroughputDetails(hiddenParallelismLimits).backpressureConsistency.parallelismLimitsVisible,
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

  const queueBudgetAndHeadroomVisibleWithoutMeasurement = clone(report);
  queueBudgetAndHeadroomVisibleWithoutMeasurement.evidence.backpressure.queueBudgetVisible = true;
  queueBudgetAndHeadroomVisibleWithoutMeasurement.evidence.backpressure.queueHeadroomVisible = true;
  queueBudgetAndHeadroomVisibleWithoutMeasurement.evidence.backpressure.queueHeadroomMeasured = false;
  assert.ok(
    productionThroughputBlockers(queueBudgetAndHeadroomVisibleWithoutMeasurement).includes(
      'queue-budget-and-queue-headroom-visible-without-queue-headroom-measurement',
    ),
  );

  const brokenWindowEvidence = clone(report);
  brokenWindowEvidence.evidence.resourceLimits.chunkWindowWithinMemoryCeiling = false;
  assert.ok(
    productionThroughputBlockers(brokenWindowEvidence).includes('chunk-window-exceeds-memory-ceiling'),
  );

  const hiddenPausedMemoryCeiling = clone(report);
  hiddenPausedMemoryCeiling.evidence.backpressure.queuePausedBeforeOverflow = true;
  hiddenPausedMemoryCeiling.evidence.backpressure.queueBudgetVisible = true;
  hiddenPausedMemoryCeiling.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;
  assert.ok(
    productionThroughputBlockers(hiddenPausedMemoryCeiling).includes(
      'queue-budget-visible-without-memory-ceiling-visibility',
    ),
  );

  const incompletePauseFootprint = clone(report);
  incompletePauseFootprint.evidence.backpressure.receiptCursorPauseFootprintComplete = false;
  assert.ok(
    productionThroughputBlockers(incompletePauseFootprint).includes(
      'queue-pause-without-complete-receipt-cursor-pause-footprint',
    ),
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

  const hiddenReceiptCursorQueueSlack = clone(report);
  hiddenReceiptCursorQueueSlack.evidence.backpressure.receiptCursorQueueSlackVisible = false;
  assert.ok(
    productionThroughputBlockers(hiddenReceiptCursorQueueSlack).includes(
      'queue-pause-without-visible-receipt-cursor-queue-slack',
    ),
  );
  assert.equal(
    productionThroughputDetails(hiddenReceiptCursorQueueSlack).receiptCursorQueueSlackVisible,
    false,
  );

  const hiddenReceiptCursorMemoryHeadroom = clone(report);
  hiddenReceiptCursorMemoryHeadroom.evidence.backpressure.receiptCursorMemoryHeadroomVisible = false;
  assert.ok(
    productionThroughputBlockers(hiddenReceiptCursorMemoryHeadroom).includes(
      'queue-pause-without-visible-receipt-cursor-memory-headroom',
    ),
  );
  assert.equal(
    productionThroughputDetails(hiddenReceiptCursorMemoryHeadroom).receiptCursorMemoryHeadroomVisible,
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
  const missingQueuePauseDetails = productionThroughputDetails(missingQueuePause);
  assert.ok(
    productionThroughputBlockers(missingQueuePause).includes(
      'queue-did-not-pause-before-overflow',
    ),
  );
  assert.equal(missingQueuePauseDetails.receiptCursorPauseFootprintComplete, false);
  assert.equal(missingQueuePauseDetails.receiptCursorPauseFootprintVisible, false);
  assert.equal(missingQueuePauseDetails.stagingDiskHeadroomVisibleAndMeasuredAfterPause, false);
  assert.equal(missingQueuePauseDetails.backpressureConsistency.queuePausedBeforeOverflow, false);

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
  const missingMeasuredQueueSlackProofDetails = productionThroughputDetails(missingMeasuredQueueSlackProof);
  assert.ok(
    productionThroughputBlockers(missingMeasuredQueueSlackProof).includes(
      'queue-pause-without-measured-receipt-cursor-queue-slack-proof',
    ),
  );
  assert.equal(
    missingMeasuredQueueSlackProofDetails.backpressureConsistency.queuePauseHasMeasuredReceiptCursorQueueSlack,
    false,
  );
  assert.equal(
    missingMeasuredQueueSlackProofDetails.backpressureConsistency.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack,
    false,
  );
  assert.equal(
    missingMeasuredQueueSlackProofDetails.backpressureConsistency.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
    false,
  );
  assert.equal(
    missingMeasuredQueueSlackProofDetails.backpressureConsistency.receiptCursorPauseFootprintComplete,
    false,
  );
  assert.equal(
    missingMeasuredQueueSlackProofDetails.backpressureConsistency.queueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    missingMeasuredQueueSlackProofDetails.backpressureConsistency.queueHeadroomVisibleAndMeasuredAndAligned,
    false,
  );
  assert.equal(
    missingMeasuredQueueSlackProofDetails.backpressureConsistency.queueHeadroomVisibleAndQueueSlackMeasured,
    false,
  );
  assert.equal(
    missingMeasuredQueueSlackProofDetails.backpressureConsistency.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured,
    false,
  );
  assert.equal(
    missingMeasuredQueueSlackProofDetails.backpressureConsistency.receiptCursorQueueSlackVisibleAndMeasured,
    false,
  );
  assert.equal(
    missingMeasuredQueueSlackProofDetails.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
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
    false,
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

  const mismatchedMemoryResourceHeadroom = clone(report);
  mismatchedMemoryResourceHeadroom.evidence.backpressure.receiptCursorMemoryHeadroomBytes -= 1;
  assert.ok(
    productionThroughputBlockers(mismatchedMemoryResourceHeadroom).includes(
      'receipt-cursor-memory-headroom-resource-headroom-mismatch',
    ),
  );
  assert.equal(
    productionThroughputDetails(mismatchedMemoryResourceHeadroom).receiptCursorMemoryHeadroomWithinResourceHeadroom,
    true,
  );
  assert.equal(
    productionThroughputDetails(mismatchedMemoryResourceHeadroom).receiptCursorMemoryHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedMemoryResourceHeadroom).backpressureConsistency.receiptCursorMemoryHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    productionThroughputDetails(mismatchedMemoryResourceHeadroom).backpressureConsistency.backpressureEvidenceComplete,
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
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).queueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).backpressureConsistency
      .queueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).backpressureConsistency.queueHeadroomWithinResourceCeiling,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).queueHeadroomVisibleAndMeasuredAndAligned,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).receiptCursorPauseFootprintVisible,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling)
      .receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).backpressureConsistency
      .queueHeadroomVisibleAndMeasuredAndAligned,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).backpressureConsistency
      .queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).backpressureConsistency
      .queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).backpressureConsistency
      .receiptCursorPauseFootprintVisible,
    false,
  );
  assert.equal(
    productionThroughputDetails(queueHeadroomBeyondResourceCeiling).backpressureConsistency
      .receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
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
    productionThroughputDetails(zeroQueueSlackEvidence).queueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(zeroQueueSlackEvidence).backpressureConsistency.queueHeadroomVisibleAndMeasured,
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

  const hiddenMeasuredBackpressureBit = clone(report);
  hiddenMeasuredBackpressureBit.evidence.backpressure.receiptCursorBackpressureMeasured = false;
  const hiddenMeasuredBackpressureDetails = productionThroughputDetails(hiddenMeasuredBackpressureBit);
  assert.ok(
    productionThroughputBlockers(hiddenMeasuredBackpressureBit).includes(
      'queue-pause-without-measured-receipt-cursor-backpressure',
    ),
  );
  assert.equal(
    hiddenMeasuredBackpressureDetails.backpressureConsistency.receiptCursorBackpressureMeasured,
    false,
  );
  assert.equal(
    hiddenMeasuredBackpressureDetails.receiptCursorPauseFootprintComplete,
    false,
  );
  assert.equal(
    hiddenMeasuredBackpressureDetails.receiptCursorPauseFootprintVisible,
    false,
  );
  assert.equal(
    hiddenMeasuredBackpressureDetails.queueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    hiddenMeasuredBackpressureDetails.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(
    hiddenMeasuredBackpressureDetails.backpressureConsistency.backpressureEvidenceComplete,
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
  assert.equal(
    productionThroughputDetails(zeroMemoryHeadroom).queueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    productionThroughputDetails(zeroMemoryHeadroom).backpressureConsistency.queueHeadroomVisibleAndMeasured,
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
  assert.equal(
    productionThroughputDetails(blockedReasonWithWhitespace).successInspectionClaimReasonVisible,
    false,
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

test('guarded benchmark keeps forged memory-ceiling visibility blockers unique', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;
  mutated.evidence.backpressure.queueBudgetVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = true;

  const blockers = productionThroughputBlockers(mutated);
  const memoryCeilingVisibilityBlockers = blockers.filter(
    (blocker) => blocker === 'queue-budget-visible-without-memory-ceiling-visibility',
  );

  assert.deepEqual(memoryCeilingVisibilityBlockers, [
    'queue-budget-visible-without-memory-ceiling-visibility',
  ]);
});

test('guarded benchmark treats receipt-cursor queue-slack visibility without queue-budget visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackVisible, true);
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-budget-visibility'));
});

test('guarded benchmark treats receipt-cursor queue-slack visibility without queue-headroom visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackVisible, true);
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-headroom-visibility'));
});

test('guarded benchmark treats receipt-cursor queue-slack visibility without memory-ceiling visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackVisible, true);
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility'));
});

test('guarded benchmark treats receipt-cursor queue-slack visibility without memory-headroom visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisible, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-memory-headroom-visibility'));
});

test('guarded benchmark keeps paired queue-slack and memory-headroom visibility fail closed when queue-headroom measurement is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueHeadroomMeasured, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-headroom-measurement'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-headroom-measurement'));
});

test('guarded benchmark keeps paired queue-slack and memory-headroom visibility fail closed when queue-budget visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueBudgetVisible, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-budget-visibility'));
});

test('guarded benchmark treats receipt-cursor queue-slack visibility without measured bytes as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackBytes = null;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.receiptCursorQueueSlackMeasured, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMeasured, false);
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-measurement'));
});

test('guarded benchmark keeps queue-headroom plus queue-slack visibility detail fail closed when queue-slack visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.receiptCursorQueueSlackVisible, false);
  assert.equal(details.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackMeasured, true);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured,
    false,
  );
  assert.ok(blockers.includes('queue-headroom-visible-without-queue-slack-visibility'));
});

test('guarded benchmark keeps queue-headroom plus queue-slack visibility detail fail closed when queue-headroom measurement is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;
  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.queueHeadroomMeasured, false);
  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.receiptCursorQueueSlackMeasured, true);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured,
    false,
  );
  assert.ok(blockers.includes('queue-headroom-visible-without-measurement'));
});

test('guarded benchmark treats queue-headroom visibility without measurement as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.backpressureConsistency.queueHeadroomVisible, true);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.ok(blockers.includes('queue-headroom-visible-without-measurement'));
});

test('guarded benchmark treats queue-headroom visibility without memory-ceiling visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.ok(blockers.includes('queue-headroom-visible-without-memory-ceiling-visibility'));
});

test('guarded benchmark treats queue-headroom visibility without memory-headroom visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisible, false);
  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.ok(
    blockers.includes('queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility'),
  );
});

test('guarded benchmark treats queue-budget visibility without queue-headroom measurement as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueBudgetVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.ok(blockers.includes('queue-budget-visible-without-queue-headroom-measurement'));
});

test('guarded benchmark treats queue-budget plus measured headroom detail as incomplete when queue-headroom visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueBudgetVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = false;
  mutated.evidence.backpressure.queueHeadroomMeasured = true;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.ok(blockers.includes('queue-budget-visible-without-queue-headroom-visible'));
});

test('guarded benchmark treats queue-budget plus measured headroom detail as incomplete when the aligned slack proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueBudgetVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.ok(blockers.includes('queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof'));
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
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-budget-visibility'));
});

test('guarded benchmark treats receipt-cursor memory-headroom visibility without memory-ceiling visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomVisible, true);
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility'));
});

test('guarded benchmark treats receipt-cursor memory-headroom visibility without queue-budget visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-budget-visibility'));
});

test('guarded benchmark keeps paired memory-headroom and queue-budget visibility fail closed when queue-headroom measurement is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueBudgetVisible, true);
  assert.equal(details.queueHeadroomMeasured, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-headroom-measurement'));
});

test('guarded benchmark keeps paired memory-headroom and queue-budget visibility fail closed when memory-ceiling visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueBudgetVisible, true);
  assert.equal(details.receiptCursorMemoryCeilingVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility'));
});

test('guarded benchmark keeps paired memory-headroom and queue-budget visibility fail closed when queue-slack visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueBudgetVisible, true);
  assert.equal(details.receiptCursorQueueSlackVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-slack-visibility'));
});

test('guarded benchmark treats receipt-cursor memory-headroom visibility without queue-headroom visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisible, false);
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility'));
});

test('guarded benchmark treats receipt-cursor memory-headroom visibility without queue-slack visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.receiptCursorQueueSlackVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackVisible, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-slack-visibility'));
});

test('guarded benchmark treats receipt-cursor memory-headroom visibility without measured bytes as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomBytes = null;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomPositive, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-measurement'));
});

test('guarded benchmark treats receipt-cursor queue-slack visibility without queue-headroom measurement as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMeasured,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-headroom-measurement'));
});

test('guarded benchmark treats receipt-cursor queue-slack visible-and-measured detail as incomplete when queue-headroom visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.queueHeadroomVisible, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMeasured,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-headroom-visibility'));
});

test('guarded benchmark treats receipt-cursor memory-headroom visibility without queue-headroom measurement as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-headroom-measurement'));
});

test('guarded benchmark treats receipt-cursor memory-headroom visible-and-measured detail as incomplete when queue-headroom visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured,
    false,
  );
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility'));
});

test('guarded benchmark treats memory-ceiling and queue-headroom visibility without queue-budget visibility as incomplete backpressure evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.ok(blockers.includes('memory-ceiling-and-queue-headroom-visible-without-queue-budget-visibility'));
});

test('guarded benchmark keeps memory-ceiling and queue-headroom visibility detail fail closed when queue-slack visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryCeilingVisible, true);
  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.receiptCursorQueueSlackVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
    false,
  );
  assert.ok(blockers.includes('queue-pause-without-visible-receipt-cursor-queue-slack'));
});

test('guarded benchmark keeps memory-headroom visibility summaries false when queue-slack visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.receiptCursorQueueSlackVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured,
    false,
  );
  assert.ok(blockers.includes('queue-pause-without-visible-receipt-cursor-queue-slack'));
});

test('guarded benchmark keeps memory-ceiling and queue-headroom visibility detail fail closed when memory-headroom visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryCeilingVisible, true);
  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
    false,
  );
  assert.ok(blockers.includes('queue-pause-without-visible-receipt-cursor-memory-headroom'));
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

  assert.equal(details.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.receiptCursorQueueSlackMatchesBackpressure, false);
  assert.equal(details.receiptCursorQueueSlackMatchesMemoryHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackMatchesResourceHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackWithinMemoryCeiling, false);
  assert.equal(details.receiptCursorQueueSlackWithinQueueBudget, false);
  assert.equal(details.receiptCursorQueueSlackWithinResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.equal(details.backpressureConsistency.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackMatchesBackpressure, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackMatchesMemoryHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackMatchesResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackWithinMemoryCeiling, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackWithinQueueBudget, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackWithinResourceHeadroom, false);
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

test('guarded benchmark keeps aligned paused queue-slack details false when queue-headroom measurement is missing', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePausedBeforeOverflow = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;
  mutated.evidence.backpressure.queuePauseHasMeasuredReceiptCursorQueueSlack = true;
  mutated.evidence.backpressure.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = true;

  const details = productionThroughputDetails(mutated);

  assert.equal(details.queuePauseHasBackpressureAlignedReceiptCursorQueueSlack, false);
  assert.equal(details.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack, false);
});

test('guarded benchmark keeps pause-footprint details false when the raw completeness bit is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorPauseFootprintComplete = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.receiptCursorBackpressureWithinQueueBudget, false);
  assert.equal(details.receiptCursorBackpressureWithinResourceHeadroom, false);
  assert.equal(details.receiptCursorHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.queueHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.queueHeadroomMatchesMemoryHeadroom, false);
  assert.equal(details.receiptCursorMemoryHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.receiptCursorMemoryHeadroomWithinResourceHeadroom, false);
  assert.equal(details.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.backpressureConsistency.receiptCursorBackpressureWithinQueueBudget, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorBackpressureWithinResourceHeadroom,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.queueHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.queueHeadroomMatchesMemoryHeadroom, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomWithinResourceHeadroom,
    false,
  );
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndMeasured, false);
  assert.ok(blockers.includes('queue-pause-footprint-not-proven'));
});

test('guarded benchmark keeps pause-footprint visibility false when queue-budget visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisible, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorPauseFootprintComplete, false);
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('queue-budget-not-visible'));
  assert.ok(blockers.includes('queue-headroom-visible-without-queue-budget-visibility'));
});

test('guarded benchmark keeps pause-footprint visibility false when receipt-cursor memory-headroom visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorPauseFootprintComplete, true);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured,
    false,
  );
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-memory-headroom-visibility'));
});

test('guarded benchmark keeps pause-footprint visibility false when memory-ceiling-match visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorPauseFootprintComplete, true);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudgetVisible, false);
  assert.ok(blockers.includes('queue-pause-with-complete-footprint-without-memory-ceiling-match-visibility'));
});

test('guarded benchmark keeps pause-footprint visibility false when the aligned queue-slack proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack, false);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorPauseFootprintVisible, false);
  assert.ok(
    blockers.includes('queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack'),
  );
});

test('guarded benchmark keeps queue-budget and memory-ceiling visibility pair false when the aligned queue-slack proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueBudgetVisible, true);
  assert.equal(details.receiptCursorMemoryCeilingVisible, true);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.ok(
    blockers.includes('queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof'),
  );
});

test('guarded benchmark keeps queue-budget and queue-headroom visibility pair false when the aligned queue-slack proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueBudgetVisible, true);
  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.ok(
    blockers.includes('queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'),
  );
});

test('guarded benchmark keeps memory-ceiling and queue-budget visibility pair false when the aligned queue-slack proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryCeilingVisible, true);
  assert.equal(details.queueBudgetVisible, true);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible,
    false,
  );
  assert.ok(
    blockers.includes('queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof'),
  );
});

test('guarded benchmark keeps queue-slack and memory-headroom visibility pair false when the aligned queue-slack proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);

  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
});

test('guarded benchmark keeps memory-headroom and queue-budget visibility pair false when the aligned queue-slack proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);

  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueBudgetVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
    false,
  );
});

test('guarded benchmark keeps memory-headroom pair summaries false when memory-ceiling-match visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
    false,
  );
  assert.ok(blockers.includes('queue-budget-visible-without-memory-ceiling-match-visibility'));
});

test('guarded benchmark keeps queue-headroom measured visibility summaries false when memory-ceiling-match visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.queueHeadroomMeasured, true);
  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.receiptCursorQueueSlackMeasured, true);
  assert.equal(details.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMeasured, false);
  assert.ok(blockers.includes('queue-budget-visible-without-memory-ceiling-match-visibility'));
});

test('guarded benchmark keeps paused queue-headroom summaries false when raw resource-ceiling proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomWithinResourceCeiling = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.queueHeadroomMeasured, true);
  assert.equal(details.queueHeadroomWithinResourceCeiling, false);
  assert.equal(details.queueHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.queueHeadroomMatchesMemoryHeadroom, false);
  assert.equal(details.receiptCursorHeadroomMatchesQueueHeadroom, false);
  assert.equal(details.receiptCursorHeadroomCoveredByQueueBudget, false);
  assert.equal(details.receiptCursorHeadroomWithinQueueBudget, false);
  assert.equal(details.receiptCursorMemoryHeadroomWithinQueueBudget, false);
  assert.equal(details.receiptCursorBackpressureWithinQueueHeadroom, false);
  assert.equal(details.receiptCursorBackpressureWithinResourceHeadroom, false);
  assert.equal(details.receiptCursorHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackMatchesResourceHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackWithinResourceHeadroom, false);
  assert.equal(details.receiptCursorMemoryHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.receiptCursorMemoryHeadroomWithinResourceHeadroom, false);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe, false);
  assert.equal(details.stagingDiskHeadroomVisibleAndMeasuredAfterPause, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.equal(details.backpressureConsistency.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.backpressureConsistency.queueHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.queueHeadroomMatchesMemoryHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorHeadroomMatchesQueueHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorHeadroomCoveredByQueueBudget, false);
  assert.equal(details.backpressureConsistency.receiptCursorHeadroomWithinQueueBudget, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomWithinQueueBudget, false);
  assert.equal(details.backpressureConsistency.receiptCursorBackpressureWithinQueueHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorBackpressureWithinResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackMatchesResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackWithinResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomWithinResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
    false,
  );
  assert.equal(details.backpressureConsistency.stagingDiskHeadroomVisibleAndMeasuredAfterPause, false);
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('queue-headroom-exceeds-resource-ceiling'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark keeps paused queue-headroom summaries false when raw queue-slack headroom proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorQueueSlackMatchesQueueHeadroom = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorQueueSlackMatchesQueueHeadroom, false);
  assert.equal(details.receiptCursorHeadroomMatchesQueueHeadroom, false);
  assert.equal(details.receiptCursorHeadroomCoveredByQueueBudget, false);
  assert.equal(details.receiptCursorBackpressureWithinQueueHeadroom, false);
  assert.equal(details.receiptCursorHeadroomWithinQueueBudget, false);
  assert.equal(details.receiptCursorQueueSlackWithinQueueHeadroom, false);
  assert.equal(details.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackMatchesQueueHeadroom,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorHeadroomMatchesQueueHeadroom,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorHeadroomCoveredByQueueBudget,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorBackpressureWithinQueueHeadroom,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorHeadroomWithinQueueBudget,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackWithinQueueHeadroom,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack,
    false,
  );
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(
    blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'),
  );
  assert.ok(
    blockers.includes('backpressure-evidence-incomplete'),
  );
});

test('guarded benchmark keeps paused queue-headroom summaries false when raw queue-headroom drifts below the bounded pause footprint', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomWithinResourceCeiling, false);
  assert.equal(details.queueHeadroomMatchesMemoryHeadroom, false);
  assert.equal(details.receiptCursorHeadroomMatchesQueueHeadroom, false);
  assert.equal(details.receiptCursorBackpressureWithinQueueHeadroom, false);
  assert.equal(details.receiptCursorHeadroomCoveredByQueueBudget, false);
  assert.equal(details.receiptCursorHeadroomWithinQueueBudget, false);
  assert.equal(details.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.equal(details.backpressureConsistency.queueHeadroomWithinResourceCeiling, false);
  assert.equal(details.backpressureConsistency.queueHeadroomMatchesMemoryHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorHeadroomMatchesQueueHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorBackpressureWithinQueueHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorHeadroomCoveredByQueueBudget, false);
  assert.equal(details.backpressureConsistency.receiptCursorHeadroomWithinQueueBudget, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('queue-headroom-backpressure-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-headroom-mismatch'));
  assert.ok(blockers.includes('queue-headroom-memory-headroom-mismatch'));
  assert.ok(blockers.includes('queue-headroom-exceeds-resource-ceiling'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark keeps paused queue-budget and memory-headroom pair summaries false when raw memory-ceiling visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = true;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryCeilingVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudgetVisible, false);
  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    false,
  );
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-memory-ceiling-visibility'));
});

test('guarded benchmark keeps paused memory-boundary pair summaries false when memory-ceiling match proof fails', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudget = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudget, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe, false);
  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
    false,
  );
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndMeasured, false);
  assert.ok(
    blockers.includes('queue-pause-without-memory-ceiling-matching-queue-budget-proof'),
  );
});

test('guarded benchmark keeps paused queue-budget pair summaries false when raw queue-budget drifts below the bounded pause footprint', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueBudgetBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueBudgetMatchesResourceCeiling, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured, false);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.equal(details.backpressureConsistency.queueBudgetMatchesResourceCeiling, false);
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('queue-budget-does-not-match-resource-ceiling'));
  assert.ok(blockers.includes('queue-memory-ceiling-does-not-match-queue-budget'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark keeps rollout summaries pinned when raw queue-budget bytes drift under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueBudgetBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueBudgetMatchesResourceCeiling, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-budget-does-not-match-resource-ceiling',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-exceeds-resource-ceiling',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-budget-does-not-match-resource-ceiling',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-exceeds-resource-ceiling',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-budget-does-not-match-resource-ceiling',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-exceeds-resource-ceiling',
      ],
    },
  ]);
  assert.ok(blockers.includes('queue-budget-does-not-match-resource-ceiling'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark keeps rollout summaries pinned when raw queue-headroom bytes drift under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueHeadroomBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomWithinResourceCeiling, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-exceeds-resource-ceiling',
        'queue-headroom-memory-headroom-mismatch',
        'receipt-cursor-headroom-mismatch',
        'receipt-cursor-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
        'receipt-cursor-queue-slack-headroom-mismatch',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-exceeds-resource-ceiling',
        'queue-headroom-memory-headroom-mismatch',
        'receipt-cursor-headroom-mismatch',
        'receipt-cursor-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
        'receipt-cursor-queue-slack-headroom-mismatch',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-exceeds-resource-ceiling',
        'queue-headroom-memory-headroom-mismatch',
        'receipt-cursor-headroom-mismatch',
        'receipt-cursor-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
        'receipt-cursor-queue-slack-headroom-mismatch',
      ],
    },
  ]);
  assert.ok(blockers.includes('queue-headroom-exceeds-resource-ceiling'));
  assert.ok(blockers.includes('queue-headroom-memory-headroom-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-headroom-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-headroom-not-covered-by-queue-budget'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-not-covered-by-queue-budget'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-headroom-mismatch'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark carries hidden queue-headroom visibility blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-budget-visible-without-queue-headroom-visible',
        'memory-ceiling-match-visible-without-queue-headroom-visibility',
        'memory-ceiling-visible-without-queue-headroom-visible',
        'queue-headroom-not-visible',
        'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
        'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-budget-visible-without-queue-headroom-visible',
        'memory-ceiling-match-visible-without-queue-headroom-visibility',
        'memory-ceiling-visible-without-queue-headroom-visible',
        'queue-headroom-not-visible',
        'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
        'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-budget-visible-without-queue-headroom-visible',
        'memory-ceiling-match-visible-without-queue-headroom-visibility',
        'memory-ceiling-visible-without-queue-headroom-visible',
        'queue-headroom-not-visible',
        'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
        'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
      ],
    },
  ]);
  assert.ok(blockers.includes('queue-budget-visible-without-queue-headroom-visible'));
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-queue-headroom-visibility'));
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-headroom-visible'));
  assert.ok(blockers.includes('queue-headroom-not-visible'));
  assert.ok(
    blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility'),
  );
  assert.ok(
    blockers.includes('receipt-cursor-queue-slack-visible-without-queue-headroom-visibility'),
  );
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark carries hidden queue-budget visibility blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const releaseBundleBackpressure = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
  );
  const queueBudgetPauseAfterRetry = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
  );
  const stagingDiskReplay = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );
  const pluginUpdatePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
    'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
    'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
  ].includes(entry.id));

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-budget-not-visible',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'memory-ceiling-match-visible-without-queue-budget-visibility',
        'memory-ceiling-visible-without-queue-budget-visibility',
        'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        'queue-headroom-visible-without-queue-budget-visibility',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
        'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-budget-not-visible',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'memory-ceiling-match-visible-without-queue-budget-visibility',
        'memory-ceiling-visible-without-queue-budget-visibility',
        'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        'queue-headroom-visible-without-queue-budget-visibility',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
        'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-budget-not-visible',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'memory-ceiling-match-visible-without-queue-budget-visibility',
        'memory-ceiling-visible-without-queue-budget-visibility',
        'queue-headroom-visible-without-queue-budget-visibility',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
        'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
      ],
    },
  ]);
  assert.ok(blockers.includes('queue-budget-not-visible'));
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('queue-headroom-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-budget-visibility'));
  assert.ok(
    blockers.includes('staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'),
  );
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
  assert.deepEqual(releaseBundleBackpressure?.blockerRefs, [
    'queue-budget-not-visible',
    'memory-ceiling-match-visible-without-queue-budget-visibility',
    'memory-ceiling-visible-without-queue-budget-visibility',
    'queue-headroom-visible-without-queue-budget-visibility',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
    'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(queueBudgetPauseAfterRetry?.blockerRefs, [
    'queue-budget-not-visible',
    'memory-ceiling-match-visible-without-queue-budget-visibility',
    'memory-ceiling-visible-without-queue-budget-visibility',
    'queue-headroom-visible-without-queue-budget-visibility',
    'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
    'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
  ]);
  assert.deepEqual(stagingDiskReplay?.blockerRefs, [
    'queue-budget-not-visible',
    'memory-ceiling-match-visible-without-queue-budget-visibility',
    'memory-ceiling-visible-without-queue-budget-visibility',
    'queue-headroom-visible-without-queue-budget-visibility',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
    'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.ok(details.rejectedFastPathGateSummary.some((entry) => entry.rejectedGate === 'recovery'));
});

test('guarded benchmark carries hidden queue-budget visibility blockers into plugin-update and plugin-install backpressure summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const pluginUpdateAndInstallBackpressureRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
    'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-budget-not-visible'));
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('queue-headroom-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-budget-visibility'));
  assert.deepEqual(
    pluginUpdateAndInstallBackpressureRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
        ],
      },
    ],
  );
});

test('guarded benchmark carries hidden queue-headroom visibility blockers into rejected release-bundle summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const releaseBundleBackpressure = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
  );
  const pluginInstallBackpressureRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
  ].includes(entry.id));
  const pluginUpdatePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
    'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
    'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
  ].includes(entry.id));
  const stagingDiskReplay = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );

  assert.deepEqual(releaseBundleBackpressure?.blockerRefs, [
    'queue-budget-visible-without-queue-headroom-visible',
    'memory-ceiling-match-visible-without-queue-headroom-visibility',
    'memory-ceiling-visible-without-queue-headroom-visible',
    'queue-headroom-not-visible',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
    'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(stagingDiskReplay?.blockerRefs, [
    'queue-budget-visible-without-queue-headroom-visible',
    'memory-ceiling-match-visible-without-queue-headroom-visibility',
    'memory-ceiling-visible-without-queue-headroom-visible',
    'queue-headroom-not-visible',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
    'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(
    pluginUpdatePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'skip',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          ...HIDDEN_QUEUE_BUDGET_VISIBILITY_BLOCKER_REFS,
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
});

test('guarded benchmark keeps release-bundle pause shortcuts blocked when raw receipt-cursor queue-slack visibility disappears', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = false;

  const details = productionThroughputDetails(mutated);
  const releaseBundlePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
  ].includes(entry.id));

  assert.deepEqual(
    releaseBundlePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
        rejectedGate: 'skip',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );

  assert.deepEqual(summarizeRejectedGates(releaseBundlePauseRejectedFastPaths), [
    { rejectedGate: 'group', count: 5 },
    { rejectedGate: 'recovery', count: 2 },
    { rejectedGate: 'skip', count: 1 },
  ]);
});

test('guarded benchmark keeps release-bundle pause shortcuts blocked when raw queue-headroom visibility disappears', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const releaseBundlePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
    'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
  ].includes(entry.id));
  const releaseBundleBackpressure = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
  );
  const stagingDiskReplay = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );

  assert.deepEqual(
    releaseBundlePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
        rejectedGate: 'skip',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-budget-visible-without-queue-headroom-visible',
          'memory-ceiling-match-visible-without-queue-headroom-visibility',
          'memory-ceiling-visible-without-queue-headroom-visible',
          'queue-headroom-not-visible',
          'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
          'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.deepEqual(releaseBundleBackpressure?.blockerRefs, [
    'queue-budget-visible-without-queue-headroom-visible',
    'memory-ceiling-match-visible-without-queue-headroom-visibility',
    'memory-ceiling-visible-without-queue-headroom-visible',
    'queue-headroom-not-visible',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
    'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(stagingDiskReplay?.blockerRefs, [
    'queue-budget-visible-without-queue-headroom-visible',
    'memory-ceiling-match-visible-without-queue-headroom-visibility',
    'memory-ceiling-visible-without-queue-headroom-visible',
    'queue-headroom-not-visible',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
    'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
});

test('guarded benchmark carries hidden raw memory-ceiling visibility blockers into rejected release-bundle summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;

  const details = productionThroughputDetails(mutated);
  const releaseBundleBackpressure = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
  );
  const pluginInstallBackpressureRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
  ].includes(entry.id));
  const pluginUpdatePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
    'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
    'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
  ].includes(entry.id));
  const stagingDiskReplay = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );

  assert.deepEqual(releaseBundleBackpressure?.blockerRefs, [
    ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS.slice(0, 4),
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS.slice(4),
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(stagingDiskReplay?.blockerRefs, [
    ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS.slice(0, 4),
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS.slice(4),
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(
    pluginUpdatePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
        rejectedGate: 'group',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.deepEqual(
    pluginInstallBackpressureRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          ...HIDDEN_MEMORY_CEILING_VISIBILITY_BLOCKER_REFS,
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
});

test('guarded benchmark carries hidden raw memory-ceiling visibility blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-budget-visible-without-memory-ceiling-visibility',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'memory-ceiling-match-visible-without-memory-ceiling-visibility',
        'queue-headroom-visible-without-memory-ceiling-visibility',
        'queue-pause-without-visible-memory-ceiling',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
        'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-budget-visible-without-memory-ceiling-visibility',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'memory-ceiling-match-visible-without-memory-ceiling-visibility',
        'queue-headroom-visible-without-memory-ceiling-visibility',
        'queue-pause-without-visible-memory-ceiling',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
        'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-budget-visible-without-memory-ceiling-visibility',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'memory-ceiling-match-visible-without-memory-ceiling-visibility',
        'queue-headroom-visible-without-memory-ceiling-visibility',
        'queue-pause-without-visible-memory-ceiling',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
        'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
      ],
    },
  ]);
  assert.ok(blockers.includes('queue-budget-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('queue-headroom-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('queue-pause-without-visible-memory-ceiling'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark carries hidden raw memory-ceiling visibility blockers into plugin post-pause summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const postPauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-budget-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('queue-pause-without-visible-memory-ceiling'));
  assert.ok(blockers.includes('queue-headroom-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility'));
  assert.deepEqual(
    postPauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
});

test('guarded benchmark carries hidden queue-budget visibility blockers into plugin post-pause summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const postPauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-budget-not-visible'));
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('queue-headroom-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-budget-visibility'));
  assert.deepEqual(
    postPauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
});

test('guarded benchmark carries hidden queue-headroom visibility blockers into plugin post-pause summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const postPauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-budget-visible-without-queue-headroom-visible'));
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-queue-headroom-visibility'));
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-headroom-visible'));
  assert.ok(blockers.includes('queue-headroom-not-visible'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-headroom-visibility'));
  assert.deepEqual(
    postPauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
});

test('guarded benchmark carries hidden memory-headroom visibility blockers into plugin post-pause summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const postPauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('memory-ceiling-match-visible-without-memory-headroom-visibility'));
  assert.ok(blockers.includes('queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility'));
  assert.ok(blockers.includes('queue-pause-without-visible-receipt-cursor-memory-headroom'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-memory-headroom-visibility'));
  assert.deepEqual(
    postPauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
});

test('guarded benchmark carries hidden queue-budget visibility blockers into release-bundle post-pause summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const releaseBundlePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
    'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
    'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-budget-not-visible'));
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('queue-headroom-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-budget-visibility'));
  assert.deepEqual(
    releaseBundlePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
        rejectedGate: 'skip',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_BUDGET_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
});

test('guarded benchmark carries hidden queue-headroom visibility blockers into release-bundle post-pause summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const releaseBundlePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
    'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
    'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-budget-visible-without-queue-headroom-visible'));
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-queue-headroom-visibility'));
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-headroom-visible'));
  assert.ok(blockers.includes('queue-headroom-not-visible'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-headroom-visibility'));
  assert.deepEqual(
    releaseBundlePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
        rejectedGate: 'skip',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_QUEUE_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
});

test('guarded benchmark keeps release-bundle post-pause planning summaries pending until a full pause footprint is proven', () => {
  const report = smallBenchmark();
  const details = productionThroughputDetails(report);

  assert.deepEqual(details.releaseBundlePlanningSummary, {
    surface: 'release-bundle-post-pause-planning',
    status: 'pending',
    measured: false,
    visible: false,
    blockerRefs: [],
  });
});

test('guarded benchmark marks release-bundle post-pause planning summaries ready when the full pause footprint is proven', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingBytes =
    mutated.evidence.backpressure.queueBudgetBytes;
  mutated.evidence.backpressure.receiptCursorQueueSlackMatchesQueueHeadroom = true;

  const details = productionThroughputDetails(mutated);

  assert.deepEqual(details.releaseBundlePlanningSummary, {
    surface: 'release-bundle-post-pause-planning',
    status: 'ready',
    measured: true,
    visible: true,
    blockerRefs: [],
  });
});

test('guarded benchmark blocks release-bundle post-pause planning summaries when queue-headroom visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(blockers.includes('queue-budget-visible-without-queue-headroom-visible'));
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-queue-headroom-visibility'));
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-headroom-visible'));
  assert.ok(blockers.includes('queue-headroom-not-visible'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-headroom-visibility'));
  assert.deepEqual(details.releaseBundlePlanningSummary, {
    surface: 'release-bundle-post-pause-planning',
    status: 'blocked',
    measured: false,
    visible: false,
    blockerRefs: [
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      'queue-budget-visible-without-queue-headroom-visible',
      'memory-ceiling-match-visible-without-queue-headroom-visibility',
      'memory-ceiling-visible-without-queue-headroom-visible',
      'queue-headroom-not-visible',
      'receipt-cursor-memory-headroom-visible-without-queue-headroom-visibility',
      'receipt-cursor-queue-slack-visible-without-queue-headroom-visibility',
    ],
  });
});

test('guarded benchmark blocks release-bundle post-pause planning summaries when queue-budget visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(blockers.includes('queue-budget-not-visible'));
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('queue-headroom-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-budget-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-queue-budget-visibility'));
  assert.deepEqual(details.releaseBundlePlanningSummary, {
    surface: 'release-bundle-post-pause-planning',
    status: 'blocked',
    measured: false,
    visible: false,
    blockerRefs: [
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      'queue-budget-not-visible',
      'memory-ceiling-match-visible-without-queue-budget-visibility',
      'memory-ceiling-visible-without-queue-budget-visibility',
      'queue-headroom-visible-without-queue-budget-visibility',
      'receipt-cursor-memory-headroom-visible-without-queue-budget-visibility',
      'receipt-cursor-queue-slack-visible-without-queue-budget-visibility',
    ],
  });
});

test('guarded benchmark blocks release-bundle post-pause planning summaries when memory-ceiling visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = false;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(blockers.includes('queue-budget-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('queue-pause-without-visible-memory-ceiling'));
  assert.ok(blockers.includes('queue-headroom-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility'));
  assert.deepEqual(details.releaseBundlePlanningSummary, {
    surface: 'release-bundle-post-pause-planning',
    status: 'blocked',
    measured: false,
    visible: false,
    blockerRefs: [
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      'queue-budget-visible-without-memory-ceiling-visibility',
      'queue-pause-without-visible-memory-ceiling',
      'queue-headroom-visible-without-memory-ceiling-visibility',
      'receipt-cursor-memory-headroom-visible-without-memory-ceiling-visibility',
      'receipt-cursor-queue-slack-visible-without-memory-ceiling-visibility',
    ],
  });
});

test('guarded benchmark blocks release-bundle post-pause planning summaries when queue-headroom measurement is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queueHeadroomVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(blockers.includes('queue-budget-visible-without-queue-headroom-measurement'));
  assert.ok(blockers.includes('memory-ceiling-visible-without-queue-headroom-measurement'));
  assert.ok(blockers.includes('queue-headroom-visible-without-measurement'));
  assert.deepEqual(details.releaseBundlePlanningSummary, {
    surface: 'release-bundle-post-pause-planning',
    status: 'blocked',
    measured: false,
    visible: false,
    blockerRefs: [
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      'queue-budget-visible-without-queue-headroom-measurement',
      'memory-ceiling-visible-without-queue-headroom-measurement',
      'queue-headroom-visible-without-measurement',
    ],
  });
});

test('guarded benchmark blocks release-bundle post-pause planning summaries when aligned queue-slack proof is missing after a full pause footprint', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePausedBeforeOverflow = true;
  mutated.evidence.backpressure.queueBudgetVisible = true;
  mutated.evidence.backpressure.queueHeadroomVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = true;
  mutated.evidence.backpressure.queueHeadroomWithinResourceCeiling = true;
  mutated.evidence.backpressure.receiptCursorWithinQueueBudget = true;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = true;
  mutated.evidence.backpressure.receiptCursorPauseFootprintComplete = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredReceiptCursorQueueSlack = false;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;
  mutated.evidence.backpressure.stagingDiskHeadroomVisible = true;
  mutated.evidence.backpressure.stagingDiskHeadroomMeasured = true;
  mutated.evidence.backpressure.stagingDiskHeadroomWithinPlanReserve = true;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(
    blockers.includes(
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
    ),
  );
  assert.ok(blockers.includes('queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.deepEqual(details.releaseBundlePlanningSummary, {
    surface: 'release-bundle-post-pause-planning',
    status: 'blocked',
    measured: false,
    visible: false,
    blockerRefs: [
      'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
      'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
      'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
      'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
    ],
  });
});

test('guarded benchmark blocks release-bundle post-pause planning summaries when staging-disk measurement is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.stagingDiskHeadroomVisible = true;
  mutated.evidence.backpressure.stagingDiskHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(blockers.includes('staging-disk-headroom-visible-without-measurement'));
  assert.deepEqual(details.releaseBundlePlanningSummary, {
    surface: 'release-bundle-post-pause-planning',
    status: 'blocked',
    measured: false,
    visible: false,
    blockerRefs: [
      'staging-disk-headroom-visible-without-measurement',
    ],
  });
});

test('guarded benchmark blocks release-bundle post-pause planning summaries when staging-disk visibility is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingBytes =
    mutated.evidence.backpressure.queueBudgetBytes;
  mutated.evidence.backpressure.receiptCursorQueueSlackMatchesQueueHeadroom = true;
  mutated.evidence.backpressure.stagingDiskHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(blockers.includes('staging-disk-headroom-not-visible'));
  assert.deepEqual(details.releaseBundlePlanningSummary, {
    surface: 'release-bundle-post-pause-planning',
    status: 'blocked',
    measured: true,
    visible: false,
    blockerRefs: [
      'staging-disk-headroom-not-visible',
    ],
  });
});

test('guarded benchmark blocks release-bundle post-pause planning summaries when staging-disk headroom drifts outside the plan reserve', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.stagingDiskHeadroomWithinPlanReserve = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(blockers.includes('staging-disk-headroom-outside-plan-reserve'));
  assert.deepEqual(details.releaseBundlePlanningSummary, {
    surface: 'release-bundle-post-pause-planning',
    status: 'blocked',
    measured: false,
    visible: false,
    blockerRefs: [
      'staging-disk-headroom-outside-plan-reserve',
    ],
  });
});

test('guarded benchmark keeps rollout summaries pinned when raw memory-ceiling bytes drift under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryCeilingBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudget, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
      ],
    },
  ]);
  assert.ok(blockers.includes('queue-memory-ceiling-does-not-match-queue-budget'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark keeps memory-ceiling match details false when raw memory-ceiling bytes drift below the bounded pause footprint', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudget, false);
  assert.equal(details.receiptCursorMemoryCeilingMatchesQueueBudgetVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingMatchesQueueBudget,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingMatchesQueueBudgetVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('queue-memory-ceiling-does-not-match-queue-budget'));
  assert.ok(blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark keeps paused backpressure summaries false when raw receipt-cursor bytes drift below the bounded pause footprint', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMatchesBackpressure, false);
  assert.equal(details.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.receiptCursorBackpressureWithinQueueBudget, false);
  assert.equal(details.receiptCursorBackpressureWithinResourceHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackMatchesBackpressure, false);
  assert.equal(details.receiptCursorQueueSlackMatchesMemoryHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackMatchesResourceHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackWithinMemoryCeiling, false);
  assert.equal(details.receiptCursorQueueSlackWithinQueueBudget, false);
  assert.equal(details.receiptCursorQueueSlackWithinResourceHeadroom, false);
  assert.equal(details.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomMeasured, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMeasured, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible, false);
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.equal(details.backpressureConsistency.receiptCursorMatchesBackpressure, false);
  assert.equal(details.backpressureConsistency.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.backpressureConsistency.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.backpressureConsistency.receiptCursorBackpressureWithinQueueBudget, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorBackpressureWithinResourceHeadroom,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackMatchesBackpressure, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackMatchesMemoryHeadroom,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackMatchesResourceHeadroom,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackWithinMemoryCeiling, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackWithinQueueBudget, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackWithinResourceHeadroom,
    false,
  );
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMeasuredAndAligned,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndQueueHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndQueueBudgetVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueBudgetVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisible,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndQueueHeadroomVisibleAndSafe,
    false,
  );
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('receipt-cursor-backpressure-mismatch'));
  assert.ok(blockers.includes('backpressure-alignment-not-proven'));
  assert.ok(blockers.includes('queue-pause-without-backpressure-aligned-receipt-cursor-queue-slack'));
  assert.ok(blockers.includes('queue-pause-without-backpressure-aligned-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark keeps paused chunk-window summaries false when raw receipt-cursor size bytes drift below the bounded pause footprint', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.chunkReceipts.resumeCursor.sizeBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.receiptCursorMatchesChunkWindow, false);
  assert.equal(details.receiptCursorMatchesBackpressure, false);
  assert.equal(details.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.receiptCursorPauseFootprintVisible, false);
  assert.equal(details.receiptCursorBackpressureWithinResourceHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackMatchesResourceHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackWithinResourceHeadroom, false);
  assert.equal(details.receiptCursorHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.receiptCursorMemoryHeadroomMatchesResourceHeadroom, false);
  assert.equal(details.queueHeadroomVisibleAndMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndMeasuredAndAligned, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.equal(details.backpressureConsistency.receiptCursorMatchesBackpressure, false);
  assert.equal(details.backpressureConsistency.receiptCursorPauseFootprintComplete, false);
  assert.equal(details.backpressureConsistency.receiptCursorPauseFootprintVisible, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorBackpressureWithinResourceHeadroom,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackWithinResourceHeadroom,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomMatchesResourceHeadroom,
    false,
  );
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMeasuredAndAligned,
    false,
  );
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('missing-valid-receipt-cursor'));
  assert.ok(blockers.includes('receipt-cursor-backpressure-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-headroom-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-resource-headroom-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-resource-headroom-mismatch'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark keeps paused memory-boundary pair summaries false when raw memory-headroom drifts below the bounded pause footprint', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryHeadroomBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(details.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.equal(details.backpressureConsistency.queueHeadroomMatchesMemoryHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackMatchesMemoryHeadroom, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisible, false);
  assert.equal(
    details.backpressureConsistency.queueBudgetVisibleAndMemoryCeilingVisibleAndMeasured,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(details.backpressureConsistency.backpressureEvidenceComplete, false);
  assert.ok(blockers.includes('queue-headroom-memory-headroom-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-resource-headroom-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-not-covered-by-queue-budget'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark keeps rollout summaries pinned when raw memory-headroom bytes drift under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(details.backpressureEvidenceComplete, false);
  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-memory-headroom-mismatch',
        'receipt-cursor-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-resource-headroom-mismatch',
        'receipt-cursor-queue-slack-mismatch',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-memory-headroom-mismatch',
        'receipt-cursor-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-resource-headroom-mismatch',
        'receipt-cursor-queue-slack-mismatch',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-headroom-memory-headroom-mismatch',
        'receipt-cursor-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-not-covered-by-queue-budget',
        'receipt-cursor-memory-headroom-resource-headroom-mismatch',
        'receipt-cursor-queue-slack-mismatch',
      ],
    },
  ]);
  assert.ok(blockers.includes('queue-headroom-memory-headroom-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-headroom-not-covered-by-queue-budget'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-not-covered-by-queue-budget'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-resource-headroom-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-mismatch'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark carries direct queue-slack drift blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'receipt-cursor-queue-slack-headroom-mismatch',
        'receipt-cursor-queue-slack-mismatch',
        'receipt-cursor-queue-slack-resource-headroom-mismatch',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'receipt-cursor-queue-slack-headroom-mismatch',
        'receipt-cursor-queue-slack-mismatch',
        'receipt-cursor-queue-slack-resource-headroom-mismatch',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'receipt-cursor-queue-slack-headroom-mismatch',
        'receipt-cursor-queue-slack-mismatch',
        'receipt-cursor-queue-slack-resource-headroom-mismatch',
      ],
    },
  ]);
  assert.ok(blockers.includes('receipt-cursor-queue-slack-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-headroom-mismatch'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-resource-headroom-mismatch'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark carries direct receipt-cursor backpressure drift blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorBytes -= 1;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'receipt-cursor-backpressure-mismatch',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'receipt-cursor-backpressure-mismatch',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'receipt-cursor-backpressure-mismatch',
      ],
    },
  ]);
  assert.ok(blockers.includes('receipt-cursor-backpressure-mismatch'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
});

test('guarded benchmark keeps queue-headroom and memory-headroom visibility pair false when the aligned queue-slack proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible,
    false,
  );
});

test('guarded benchmark keeps receipt-cursor measured visibility details false when the aligned queue-slack proof is hidden', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);

  assert.equal(details.queueHeadroomVisible, true);
  assert.equal(details.queueHeadroomMeasured, true);
  assert.equal(details.receiptCursorQueueSlackVisible, true);
  assert.equal(details.receiptCursorMemoryHeadroomVisible, true);
  assert.equal(details.receiptCursorMemoryCeilingVisible, true);
  assert.equal(details.receiptCursorQueueSlackMatchesBackpressure, false);
  assert.equal(details.receiptCursorQueueSlackMatchesMemoryHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackMatchesResourceHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackWithinMemoryCeiling, false);
  assert.equal(details.receiptCursorQueueSlackWithinQueueBudget, false);
  assert.equal(details.receiptCursorQueueSlackWithinResourceHeadroom, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackMeasured, false);
  assert.equal(details.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndQueueSlackVisibleAndMeasured,
    false,
  );
  assert.equal(details.queueHeadroomVisibleAndMemoryHeadroomVisible, false);
  assert.equal(
    details.backpressureConsistency.queueHeadroomVisibleAndMemoryHeadroomVisible,
    false,
  );
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackMatchesBackpressure, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackMatchesMemoryHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackMatchesResourceHeadroom, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackWithinMemoryCeiling, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackWithinQueueBudget, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackWithinResourceHeadroom, false);
  assert.equal(details.receiptCursorQueueSlackVisibleAndMeasured, false);
  assert.equal(details.backpressureConsistency.receiptCursorQueueSlackVisibleAndMeasured, false);
  assert.equal(details.receiptCursorMemoryHeadroomVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryHeadroomVisibleAndMeasured,
    false,
  );
  assert.equal(details.receiptCursorMemoryCeilingVisibleAndMeasured, false);
  assert.equal(
    details.backpressureConsistency.receiptCursorMemoryCeilingVisibleAndMeasured,
    false,
  );
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
      ],
    },
  ]);
  assert.ok(blockers.includes('queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into rejected retry summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const retryRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
    'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
    'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.deepEqual(
    retryRejectedFastPaths.map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      })),
    [
      {
        id: 'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(retryRejectedFastPaths), [
    { rejectedGate: 'recovery', count: 3 },
  ]);
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into rejected commit-after-pause summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(blockers.includes('queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack'));
  assert.ok(blockers.includes('queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.deepEqual(
    details.rejectedFastPaths
      .filter((entry) => [
        'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
        'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
        'cached-receipt-cursor-and-staging-disk-headroom-skips-atomic-group-commit-after-pause',
        'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
        'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
      ].includes(entry.id))
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      })),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-staging-disk-headroom-skips-atomic-group-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
    ],
  );
});

test('guarded benchmark carries direct queue-slack visibility blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        'memory-ceiling-match-visible-without-queue-slack-visibility',
        'queue-headroom-visible-without-queue-slack-visibility',
        'queue-pause-without-visible-receipt-cursor-queue-slack',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-memory-headroom-visible-without-queue-slack-visibility',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        'memory-ceiling-match-visible-without-queue-slack-visibility',
        'queue-headroom-visible-without-queue-slack-visibility',
        'queue-pause-without-visible-receipt-cursor-queue-slack',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-memory-headroom-visible-without-queue-slack-visibility',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'memory-ceiling-match-visible-without-queue-slack-visibility',
        'queue-headroom-visible-without-queue-slack-visibility',
        'queue-pause-without-visible-receipt-cursor-queue-slack',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-memory-headroom-visible-without-queue-slack-visibility',
      ],
    },
  ]);
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-queue-slack-visibility'));
  assert.ok(blockers.includes('queue-headroom-visible-without-queue-slack-visibility'));
  assert.ok(blockers.includes('queue-pause-without-visible-receipt-cursor-queue-slack'));
  assert.ok(blockers.includes('receipt-cursor-memory-headroom-visible-without-queue-slack-visibility'));
  assert.ok(
    blockers.includes('staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'),
  );
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure'));
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-memory-safe-receipt-cursor-slack'));
  assert.deepEqual(
    details.rejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-slack-authorizes-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-queue-slack-visibility',
          'queue-headroom-visible-without-queue-slack-visibility',
          'queue-pause-without-visible-receipt-cursor-queue-slack',
          'receipt-cursor-memory-headroom-visible-without-queue-slack-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-queue-slack-visibility',
          'queue-headroom-visible-without-queue-slack-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-queue-slack-visibility',
          'queue-headroom-visible-without-queue-slack-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-queue-slack-visibility',
          'queue-headroom-visible-without-queue-slack-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ],
  );
  assert.deepEqual(details.rejectedFastPathGateSummary, [
    { rejectedGate: 'recovery', count: 6 },
  ]);
});

test('guarded benchmark surfaces receipt-cursor recovery blockers at runtime', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = false;

  const details = productionThroughputDetails(mutated);
  const receiptCursorRecoveryRejectedFastPaths = details.rejectedFastPaths
    .filter((entry) => [
      'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
      'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
      'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
      'cached-receipt-cursor-queue-slack-authorizes-commit-after-pause',
      'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
    ].includes(entry.id))
    .sort((left, right) => left.id.localeCompare(right.id));

  assert.deepEqual(
    receiptCursorRecoveryRejectedFastPaths.map(({ id, rejectedGate, blockerRefs }) => ({
      id,
      rejectedGate,
      blockerRefs,
    })),
    [
      {
        id: 'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-queue-slack-visibility',
          'queue-headroom-visible-without-queue-slack-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-queue-slack-visibility',
          'queue-headroom-visible-without-queue-slack-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-queue-slack-visibility',
          'queue-headroom-visible-without-queue-slack-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-slack-authorizes-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-queue-slack-visibility',
          'queue-headroom-visible-without-queue-slack-visibility',
          'queue-pause-without-visible-receipt-cursor-queue-slack',
          'receipt-cursor-memory-headroom-visible-without-queue-slack-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ],
  );
});

test('guarded benchmark surfaces retry blockers at runtime', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const retryRejectedFastPaths = details.rejectedFastPaths
    .filter((entry) => entry.id.includes('after-retry'))
    .sort((left, right) => left.id.localeCompare(right.id));

  assert.deepEqual(
    retryRejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(retryRejectedFastPaths), [
    { rejectedGate: 'recovery', count: 3 },
  ]);
});

test('guarded benchmark surfaces replay blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const replayRejectedFastPaths = details.rejectedFastPaths
    .filter((entry) => entry.id.includes('replay'))
    .sort((left, right) => left.id.localeCompare(right.id));

  assert.deepEqual(
    replayRejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(replayRejectedFastPaths), [
    { rejectedGate: 'recovery', count: 1 },
  ]);
});

test('guarded benchmark surfaces large-upload backpressure blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const largeUploadRejectedFastPaths = details.rejectedFastPaths
    .filter(
      (entry) =>
        entry.id === 'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
    );

  assert.deepEqual(
    largeUploadRejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'compressed-remote-index-and-parallel-chunk-sends-skips-large-upload-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-parallelism-limits-not-visible',
          'production-storage-receipts-not-measured',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(largeUploadRejectedFastPaths), [
    { rejectedGate: 'recovery', count: 1 },
  ]);
});

test('guarded benchmark surfaces file-hash release-bundle blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const fileHashReleaseBundleRejectedFastPaths = details.rejectedFastPaths
    .filter(
      (entry) =>
        entry.id === 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
    );

  assert.deepEqual(
    fileHashReleaseBundleRejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(fileHashReleaseBundleRejectedFastPaths), [
    { rejectedGate: 'group', count: 1 },
  ]);
});

test('guarded benchmark surfaces release-cursor release-bundle blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const releaseCursorReleaseBundleRejectedFastPaths = details.rejectedFastPaths
    .filter(
      (entry) =>
        entry.id === 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
    );

  assert.deepEqual(
    releaseCursorReleaseBundleRejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(releaseCursorReleaseBundleRejectedFastPaths), [
    { rejectedGate: 'recovery', count: 1 },
  ]);
});

test('guarded benchmark surfaces chunk-and-db-receipts release-bundle blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const chunkAndDbReceiptsReleaseBundleRejectedFastPaths = details.rejectedFastPaths
    .filter(
      (entry) =>
        entry.id === 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
    );

  assert.deepEqual(
    chunkAndDbReceiptsReleaseBundleRejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(chunkAndDbReceiptsReleaseBundleRejectedFastPaths), [
    { rejectedGate: 'group', count: 1 },
  ]);
});

test('guarded benchmark carries direct measured queue-headroom proof blockers into rejected retry summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queueHeadroomMeasured = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(blockers.includes('queue-pause-without-measured-queue-headroom-proof'));
  assert.deepEqual(
    details.rejectedFastPaths
      .filter((entry) => [
        'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
        'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
        'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
      ].includes(entry.id))
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      })),
    [
      {
        id: 'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-measured-queue-headroom-proof',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-measured-queue-headroom-proof',
          'queue-budget-visible-without-queue-headroom-measurement',
          'memory-ceiling-visible-without-queue-headroom-measurement',
          'queue-headroom-visible-without-measurement',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-measured-queue-headroom-proof',
          'queue-budget-visible-without-queue-headroom-measurement',
          'memory-ceiling-visible-without-queue-headroom-measurement',
          'queue-headroom-visible-without-measurement',
        ],
      },
    ],
  );
});

test('guarded benchmark carries direct memory-headroom visibility blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        'memory-ceiling-match-visible-without-memory-headroom-visibility',
        'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
        'queue-pause-without-visible-receipt-cursor-memory-headroom',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        'memory-ceiling-match-visible-without-memory-headroom-visibility',
        'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
        'queue-pause-without-visible-receipt-cursor-memory-headroom',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'memory-ceiling-match-visible-without-memory-headroom-visibility',
        'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
        'queue-pause-without-visible-receipt-cursor-memory-headroom',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
        'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
      ],
    },
  ]);
  assert.ok(blockers.includes('memory-ceiling-match-visible-without-memory-headroom-visibility'));
  assert.ok(blockers.includes('queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility'));
  assert.ok(blockers.includes('queue-pause-without-visible-receipt-cursor-memory-headroom'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-memory-headroom-visibility'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
  assert.deepEqual(
    details.rejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'cached-receipt-cursor-memory-headroom-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-memory-headroom-visibility',
          'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
          'queue-pause-without-visible-receipt-cursor-memory-headroom',
          'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-memory-headroom-visibility',
          'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-memory-headroom-visibility',
          'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'memory-ceiling-match-visible-without-memory-headroom-visibility',
          'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ],
  );
  assert.deepEqual(details.rejectedFastPathGateSummary, [
    { rejectedGate: 'recovery', count: 6 },
  ]);
});

test('guarded benchmark carries direct aligned backpressure proof blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
      ],
    },
  ]);
  assert.ok(blockers.includes('queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof'));
});

test('guarded benchmark carries direct aligned backpressure proof blockers into rejected recovery summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorBackpressure = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.ok(blockers.includes('queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof'));
  assert.deepEqual(
    details.rejectedFastPaths
      .filter((entry) => [
        'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
      ].includes(entry.id))
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      })),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-measured-and-aligned-receipt-cursor-backpressure-proof',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ],
  );
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into rejected replay summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const replay = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );

  assert.ok(blockers.includes('queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack'));
  assert.ok(blockers.includes('queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.deepEqual(replay?.blockerRefs, [
    'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
    'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
    'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
    'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into rejected release-bundle backpressure summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const releaseBundleBackpressure = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
  );

  assert.ok(blockers.includes('queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack'));
  assert.ok(blockers.includes('queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.deepEqual(releaseBundleBackpressure?.blockerRefs, [
    'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
    'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
    'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
    'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into plugin-update pause summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const pluginUpdatePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
    'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure'));
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-memory-safe-receipt-cursor-slack'));
  assert.deepEqual(
    pluginUpdatePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
        rejectedGate: 'group',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(pluginUpdatePauseRejectedFastPaths), [
    { rejectedGate: 'group', count: 1 },
    { rejectedGate: 'recovery', count: 4 },
  ]);
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into plugin-update backpressure summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const pluginUpdateBackpressureRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
    'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure'));
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-memory-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'));
  assert.deepEqual(
    pluginUpdateBackpressureRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
        rejectedGate: 'group',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          ...ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
        ],
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(pluginUpdateBackpressureRejectedFastPaths), [
    { rejectedGate: 'group', count: 2 },
    { rejectedGate: 'recovery', count: 6 },
  ]);
});

test('guarded benchmark keeps plugin-update backpressure shortcuts blocked when raw receipt-cursor queue-slack visibility disappears', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const pluginUpdateBackpressureRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
    'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure'));
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-memory-safe-receipt-cursor-slack'));
  assert.deepEqual(
    pluginUpdateBackpressureRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-batching-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-row-preconditions-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(pluginUpdateBackpressureRejectedFastPaths), [
    { rejectedGate: 'group', count: 3 },
    { rejectedGate: 'recovery', count: 7 },
  ]);
});

test('guarded benchmark keeps plugin-update receipt-flush shortcuts blocked when visible production capability evidence loses kind-scoped receipts', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.journal.successRecordTypes = [
    'apply-staged',
    'chunk-receipt',
    'journal-opened',
    'target-planned',
    'dependencies-validated',
    'recovery-state',
  ];

  const blockers = productionThroughputBlockers(mutated);
  const details = productionThroughputDetails(mutated);
  const pluginUpdateReceiptFlushRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
  ].includes(entry.id));

  assert.ok(blockers.includes('receipt-flushes-not-kind-scoped'));
  assert.deepEqual(
    pluginUpdateReceiptFlushRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
        rejectedGate: 'group',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(pluginUpdateReceiptFlushRejectedFastPaths), [
    { rejectedGate: 'group', count: 2 },
  ]);
});

test('guarded benchmark keeps plugin-install receipt-flush finalize shortcuts blocked when visible production capability evidence loses kind-scoped receipts', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.journal.successRecordTypes = [
    'apply-staged',
    'chunk-receipt',
    'journal-opened',
    'target-planned',
    'dependencies-validated',
    'recovery-state',
  ];

  const blockers = productionThroughputBlockers(mutated);
  const details = productionThroughputDetails(mutated);
  const pluginInstallReceiptFlushRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('receipt-flushes-not-kind-scoped'));
  assert.deepEqual(
    pluginInstallReceiptFlushRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(pluginInstallReceiptFlushRejectedFastPaths), [
    { rejectedGate: 'group', count: 1 },
    { rejectedGate: 'recovery', count: 1 },
  ]);
});

test('guarded benchmark keeps release-bundle receipt-flush shortcuts blocked when visible production capability evidence loses kind-scoped receipts', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.journal.successRecordTypes = [
    'apply-staged',
    'chunk-receipt',
    'journal-opened',
    'target-planned',
    'dependencies-validated',
    'recovery-state',
  ];

  const blockers = productionThroughputBlockers(mutated);
  const details = productionThroughputDetails(mutated);
  const releaseBundleReceiptFlushRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('receipt-flushes-not-kind-scoped'));
  assert.deepEqual(
    releaseBundleReceiptFlushRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
        rejectedGate: 'skip',
        blockerRefs: ['receipt-flushes-not-kind-scoped'],
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(releaseBundleReceiptFlushRejectedFastPaths), [
    { rejectedGate: 'group', count: 1 },
    { rejectedGate: 'recovery', count: 1 },
    { rejectedGate: 'skip', count: 1 },
  ]);
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into plugin-install pause summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const pluginInstallPauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure'));
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-memory-safe-receipt-cursor-slack'));
  assert.deepEqual(
    pluginInstallPauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  assert.deepEqual(summarizeRejectedGates(pluginInstallPauseRejectedFastPaths), [
    { rejectedGate: 'group', count: 11 },
    { rejectedGate: 'recovery', count: 4 },
  ]);
});

test('guarded benchmark carries hidden staging-disk visibility blockers into plugin-install pause summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.stagingDiskHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const pluginInstallPauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('staging-disk-headroom-not-visible'));
  assert.deepEqual(
    pluginInstallPauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
          'staging-disk-headroom-not-visible',
        ],
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(pluginInstallPauseRejectedFastPaths), [
    { rejectedGate: 'group', count: 11 },
    { rejectedGate: 'recovery', count: 4 },
  ]);
});

test('guarded benchmark keeps plugin-install pause shortcuts blocked when raw receipt-cursor queue-slack visibility disappears', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorQueueSlackVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const pluginInstallPauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
    'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure'));
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-memory-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-visible-receipt-cursor-queue-slack'));
  assert.deepEqual(
    pluginInstallPauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(pluginInstallPauseRejectedFastPaths), [
    { rejectedGate: 'group', count: 11 },
    { rejectedGate: 'recovery', count: 4 },
  ]);
});

test('guarded benchmark carries hidden staging-disk visibility blockers into plugin-update backpressure-after-pause summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.stagingDiskHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const pluginUpdateBackpressure = details.rejectedFastPaths.find(
    (entry) =>
      entry.id ===
        'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
  );

  assert.ok(blockers.includes('staging-disk-headroom-not-visible'));
  assert.deepEqual({
    id: pluginUpdateBackpressure?.id,
    rejectedGate: pluginUpdateBackpressure?.rejectedGate,
    blockerRefs: pluginUpdateBackpressure?.blockerRefs,
  }, {
    id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
    rejectedGate: 'recovery',
    blockerRefs: [
      'staging-disk-headroom-not-visible',
    ],
  });
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into package-hash and dependency-graph plugin-install backpressure summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const pluginInstallBackpressureRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
  ].includes(entry.id));

  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure'));
  assert.ok(blockers.includes('queue-pause-without-resource-headroom-safe-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-consistent-receipt-cursor-slack'));
  assert.ok(blockers.includes('queue-pause-without-memory-safe-receipt-cursor-slack'));
  assert.deepEqual(
    pluginInstallBackpressureRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: ALIGNED_QUEUE_SLACK_PAUSE_BLOCKER_REFS,
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(pluginInstallBackpressureRejectedFastPaths), [
    { rejectedGate: 'group', count: 3 },
  ]);
});

test('guarded benchmark surfaces plugin-update group blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const pluginUpdateGroupRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
    'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize-variant-b',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
  ].includes(entry.id));

  assert.deepEqual(
    pluginUpdateGroupRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-dependency-checks',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-finalize-variant-b',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-row-preconditions',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-update-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(pluginUpdateGroupRejectedFastPaths), [
    { rejectedGate: 'group', count: 12 },
  ]);
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into row-receipt and release-cursor release-bundle pause summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const releaseBundlePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
    'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
    'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
  ].includes(entry.id));

  assert.deepEqual(
    releaseBundlePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      })),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(releaseBundlePauseRejectedFastPaths), [
    { rejectedGate: 'group', count: 2 },
    { rejectedGate: 'recovery', count: 2 },
  ]);
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into receipt-flush and cached release-bundle pause summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const releaseBundlePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
  ].includes(entry.id));

  assert.deepEqual(
    releaseBundlePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(releaseBundlePauseRejectedFastPaths), [
    { rejectedGate: 'group', count: 3 },
    { rejectedGate: 'recovery', count: 1 },
  ]);
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into backpressure-after-retry summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const retryRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
    'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
    'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
  ].includes(entry.id));

  assert.ok(
    blockers.includes('queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof'),
  );
  assert.ok(
    blockers.includes('queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'),
  );
  assert.ok(
    blockers.includes('memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'),
  );
  assert.ok(blockers.includes('queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.deepEqual(
    retryRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'cached-receipt-cursor-and-queue-budget-match-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        ],
      },
      {
        id: 'cached-receipt-cursor-and-queue-headroom-skips-backpressure-pause-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        ],
      },
      {
        id: 'cached-receipt-cursor-queue-headroom-authorizes-atomic-group-commit-after-retry',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-budget-visible-and-memory-ceiling-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-budget-visible-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'memory-ceiling-and-queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
        ],
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(retryRejectedFastPaths), [
    { rejectedGate: 'recovery', count: 3 },
  ]);
});

test('guarded benchmark carries direct aligned queue-slack proof blockers into release-bundle planning pause summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const releaseBundlePlanning = details.rejectedFastPaths.find(
    (entry) =>
      entry.id ===
        'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
  );

  assert.ok(blockers.includes('queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack'));
  assert.ok(blockers.includes('queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.ok(blockers.includes('staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof'));
  assert.deepEqual(releaseBundlePlanning?.blockerRefs, [
    'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
    'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
    'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
    'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
  ]);
});

test('guarded benchmark surfaces release-manifest release-bundle commit blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const releaseBundleCommitRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-commit',
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-row-receipts-skips-release-bundle-commit',
    'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-compressed-db-batches-skips-release-bundle-commit',
  ].includes(entry.id));

  assert.deepEqual(
    releaseBundleCommitRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      })),
    [
      {
        id: 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipts-skips-release-bundle-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-compressed-db-batches-skips-release-bundle-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(releaseBundleCommitRejectedFastPaths), [
    { rejectedGate: 'group', count: 7 },
    { rejectedGate: 'recovery', count: 2 },
  ]);
});

test('guarded benchmark surfaces release-bundle planning blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const releaseBundlePlanningRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-planning',
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
  ].includes(entry.id));

  assert.deepEqual(
    releaseBundlePlanningRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      })),
    [
      {
        id: 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-planning',
        rejectedGate: 'skip',
        blockerRefs: ['production-capability-measurement-not-aligned'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
        rejectedGate: 'skip',
        blockerRefs: ['production-capability-measurement-not-aligned'],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(releaseBundlePlanningRejectedFastPaths), [
    { rejectedGate: 'skip', count: 2 },
  ]);
});

test('guarded benchmark surfaces release-cursor and receipt-flush release-bundle pause blockers at runtime', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.queuePauseHasMeasuredAndAlignedReceiptCursorQueueSlack = false;

  const details = productionThroughputDetails(mutated);
  const releaseBundlePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
  ].includes(entry.id));

  assert.deepEqual(
    releaseBundlePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      })),
    [
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'queue-pause-with-complete-footprint-without-measured-and-aligned-receipt-cursor-queue-slack',
          'queue-pause-without-measured-and-aligned-receipt-cursor-queue-slack-proof',
          'queue-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-aligned-receipt-cursor-queue-slack-proof',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(releaseBundlePauseRejectedFastPaths), [
    { rejectedGate: 'group', count: 5 },
    { rejectedGate: 'recovery', count: 2 },
  ]);
});

test('guarded benchmark carries hidden staging-disk visibility blockers into release-bundle pause summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.stagingDiskHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const releaseBundlePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
    'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
    'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('staging-disk-headroom-not-visible'));
  assert.deepEqual(
    releaseBundlePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'cached-receipt-cursor-and-staging-disk-headroom-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: ['staging-disk-headroom-not-visible'],
      },
    ],
  );
  assert.deepEqual(summarizeRejectedGates(releaseBundlePauseRejectedFastPaths), [
    { rejectedGate: 'group', count: 7 },
    { rejectedGate: 'recovery', count: 4 },
  ]);
});

test('guarded benchmark carries hidden staging-disk visibility blockers into post-pause replay summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.stagingDiskHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const replay = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );

  assert.ok(blockers.includes('staging-disk-headroom-not-visible'));
  assert.deepEqual(replay?.blockerRefs, [
    'staging-disk-headroom-not-visible',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
});

test('guarded benchmark carries hidden memory-headroom visibility blockers into release-bundle pause summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.receiptCursorMemoryHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const releaseBundlePauseRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
    'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
  ].includes(entry.id));
  const releaseBundleBackpressure = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
  );
  const replay = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );

  assert.ok(blockers.includes('memory-ceiling-match-visible-without-memory-headroom-visibility'));
  assert.ok(blockers.includes('queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility'));
  assert.ok(blockers.includes('queue-pause-without-visible-receipt-cursor-memory-headroom'));
  assert.ok(blockers.includes('receipt-cursor-queue-slack-visible-without-memory-headroom-visibility'));
  assert.deepEqual(
    releaseBundlePauseRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
      },
    ],
  );
  assert.deepEqual(releaseBundleBackpressure?.blockerRefs, [
    ...POST_PAUSE_HIDDEN_MEMORY_HEADROOM_RESOURCE_VISIBILITY_BLOCKER_REFS,
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(replay?.blockerRefs, [
    'memory-ceiling-match-visible-without-memory-headroom-visibility',
    'queue-headroom-visible-without-receipt-cursor-memory-headroom-visibility',
    'queue-pause-without-visible-receipt-cursor-memory-headroom',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'receipt-cursor-queue-slack-visible-without-memory-headroom-visibility',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
});

test('guarded benchmark surfaces receipt-flush blockers at runtime', async () => {
  const report = await runGuardedExecutorBenchmark({ profile: 'unit' });
  const details = productionThroughputDetails(report);
  const receiptFlushRejectedFastPaths = details.rejectedFastPaths.filter((entry) =>
    entry.id.includes('receipt-flush'),
  );

  assert.deepEqual(
    receiptFlushRejectedFastPaths.map(({ id, rejectedGate, blockerRefs }) => ({
      id,
      rejectedGate,
      blockerRefs,
    })),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-update-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
        rejectedGate: 'skip',
        blockerRefs: ['production-capability-measurement-not-aligned'],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(receiptFlushRejectedFastPaths), [
    { rejectedGate: 'group', count: 4 },
    { rejectedGate: 'recovery', count: 2 },
    { rejectedGate: 'skip', count: 1 },
  ]);
});

test('guarded benchmark surfaces release-bundle blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const releaseBundleRejectedFastPaths = details.rejectedFastPaths
    .filter((entry) => entry.id.includes('release-bundle'))
    .sort((left, right) => left.id.localeCompare(right.id));

  assert.deepEqual(
    releaseBundleRejectedFastPaths.map(({ id, rejectedGate, blockerRefs }) => ({
      id,
      rejectedGate,
      blockerRefs,
    })),
    [
      {
        id: 'compressed-remote-index-and-batched-chunk-and-db-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipts-skips-release-bundle-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-cursor-skips-release-bundle-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-batched-receipt-flush-skips-release-bundle-planning-after-pause',
        rejectedGate: 'skip',
        blockerRefs: [
          'production-capability-measurement-not-aligned',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-and-journal-lag-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-release-manifest-skips-release-bundle-planning',
        rejectedGate: 'skip',
        blockerRefs: [
          'production-capability-measurement-not-aligned',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-release-bundle-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
      {
        id: 'compressed-remote-index-and-compressed-db-batches-skips-release-bundle-commit',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-storage-receipts-not-measured',
          'production-row-batch-executor-not-measured',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(releaseBundleRejectedFastPaths), [
    { rejectedGate: 'group', count: 10 },
    { rejectedGate: 'recovery', count: 3 },
    { rejectedGate: 'skip', count: 2 },
  ]);
});

test('guarded benchmark surfaces plugin-install blockers at runtime', () => {
  const report = largeBenchmark();
  const details = productionThroughputDetails(report);
  const pluginInstallRejectedFastPaths = details.rejectedFastPaths
    .filter((entry) => entry.id.includes('plugin-install'))
    .sort((left, right) => left.id.localeCompare(right.id));

  assert.deepEqual(
    pluginInstallRejectedFastPaths.map(({ id, rejectedGate, blockerRefs }) => ({
      id,
      rejectedGate,
      blockerRefs,
    })),
    [
      {
        id: 'compressed-remote-index-and-batched-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-batched-row-receipt-flush-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-digests-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-chunk-receipts-skips-plugin-install-writeback-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-dependency-checks',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-fingerprint-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-file-hash-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-manifest-hash-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-dependency-checks',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-cache-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-dependency-checks',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-plugin-activation-map-skips-plugin-install-commit-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-activation',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-finalize-after-pause',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-writeback',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ],
  );

  assert.deepEqual(summarizeRejectedGates(pluginInstallRejectedFastPaths), [
    { rejectedGate: 'group', count: 36 },
    { rejectedGate: 'recovery', count: 4 },
  ]);
});

test('guarded benchmark carries hidden staging-disk visibility blockers into rollout summaries under visible production capability evidence', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.executorCapabilities.productionAtomicCommit = 'production-atomic-group-commit';
  mutated.executorCapabilities.fileReceipts = 'production-storage-receipts';
  mutated.executorCapabilities.rowApply = 'production-batched-compare-and-swap';
  mutated.evidence.parallelism.parallelismLimitsMeasured = true;
  mutated.evidence.parallelism.parallelismLimitsVisible = true;
  mutated.evidence.parallelism.parallelismLimits = {
    chunkUpload: 4,
    fileHashing: 2,
    dbBatchPerTable: 2,
  };
  mutated.evidence.atomicGroup.productionAtomicCommitMeasured = true;
  mutated.evidence.atomicGroup.productionAtomicCommitVisible = true;
  mutated.evidence.atomicGroup.productionAtomicGroupMetadataVisible = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsMeasured = true;
  mutated.evidence.atomicGroup.productionStorageReceiptsVisible = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorMeasured = true;
  mutated.evidence.atomicGroup.productionRowBatchExecutorVisible = true;
  mutated.evidence.backpressure.stagingDiskHeadroomVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);

  assert.deepEqual(details.productionCapabilityRolloutSummary, [
    {
      surface: 'chunk-upload-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'staging-disk-headroom-not-visible',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      surface: 'file-hashing-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'staging-disk-headroom-not-visible',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
    {
      surface: 'row-batch-concurrency',
      status: 'blocked',
      measured: false,
      visible: false,
      blockerRefs: [
        'backpressure-evidence-incomplete',
        'queue-memory-ceiling-does-not-match-queue-budget',
        'staging-disk-headroom-not-visible',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
        'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
        'queue-pause-without-consistent-receipt-cursor-slack',
        'queue-pause-without-memory-safe-receipt-cursor-slack',
      ],
    },
  ]);
  assert.ok(blockers.includes('staging-disk-headroom-not-visible'));
  assert.ok(blockers.includes('backpressure-evidence-incomplete'));
  assert.deepEqual(
    details.rejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'staging-disk-headroom-not-visible',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ],
  );
  assert.deepEqual(details.rejectedFastPathGateSummary, [
    { rejectedGate: 'recovery', count: 1 },
  ]);
});

test('guarded benchmark carries incomplete pause-footprint blockers into rejected fast-path summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorPauseFootprintComplete = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const releaseBundleBackpressure = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
  );
  const pluginInstallBackpressureRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
  ].includes(entry.id));
  const pluginUpdateBackpressureRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
  ].includes(entry.id));
  const stagingDiskReplay = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );

  assert.ok(blockers.includes('queue-pause-footprint-not-proven'));
  assert.ok(blockers.includes('queue-pause-without-complete-receipt-cursor-pause-footprint'));
  assert.ok(
    blockers.includes('staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'),
  );
  assert.deepEqual(releaseBundleBackpressure?.blockerRefs, [
    ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(
    pluginInstallBackpressureRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
        ],
      },
    ],
  );
  assert.deepEqual(
    pluginUpdateBackpressureRejectedFastPaths.map((entry) => ({
      id: entry.id,
      rejectedGate: entry.rejectedGate,
      blockerRefs: entry.blockerRefs,
    })),
    [
      {
        id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
        ],
      },
    ],
  );
  assert.deepEqual(stagingDiskReplay?.blockerRefs, [
    ...INCOMPLETE_PAUSE_FOOTPRINT_BLOCKER_REFS,
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
});

test('guarded benchmark carries hidden staging-disk visibility blockers into plugin-update and plugin-install post-pause summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.stagingDiskHeadroomVisible = false;
  mutated.claims.productionThroughputDetails.stagingDiskHeadroomVisibleAndMeasured = false;
  mutated.claims.productionThroughputDetails.stagingDiskHeadroomVisibleAndMeasuredAfterPause = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const pluginUpdateRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
    'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
  ].includes(entry.id));
  const pluginInstallRejectedFastPaths = details.rejectedFastPaths.filter((entry) => [
    'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
    'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
    'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
    'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
  ].includes(entry.id));

  assert.ok(blockers.includes('staging-disk-headroom-not-visible'));
  assert.deepEqual(
    pluginUpdateRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'cached-dependency-graph-and-remote-index-cursor-skips-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-update-commit-after-pause-variant-b',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-update-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'reuse-canonical-per-kind-budgets-to-skip-plugin-update-row-batch-revalidation-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'staging-disk-headroom-not-visible',
        ],
      },
    ],
  );
  assert.deepEqual(
    pluginInstallRejectedFastPaths
      .map((entry) => ({
        id: entry.id,
        rejectedGate: entry.rejectedGate,
        blockerRefs: entry.blockerRefs,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      {
        id: 'compressed-remote-index-and-cached-dependency-graph-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-activation-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-package-hash-skips-plugin-install-finalize-after-pause-and-backpressure',
        rejectedGate: 'group',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-batch-receipts-skips-plugin-install-backpressure',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-cached-row-receipts-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
          'staging-disk-headroom-not-visible',
        ],
      },
      {
        id: 'compressed-remote-index-and-parallel-row-batches-skips-plugin-install-backpressure-after-pause',
        rejectedGate: 'recovery',
        blockerRefs: [
          'production-atomic-group-commit-not-measured',
          'production-parallelism-limits-not-visible',
          'production-row-batch-executor-not-measured',
          'production-row-batch-executor-measured-not-proven',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
          'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
          'queue-pause-without-consistent-receipt-cursor-slack',
          'queue-pause-without-memory-safe-receipt-cursor-slack',
          'staging-disk-headroom-not-visible',
        ],
      },
    ],
  );
});

test('guarded benchmark carries hidden memory-ceiling-match blockers into rejected fast-path summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.receiptCursorMemoryCeilingMatchesQueueBudgetVisible = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const releaseBundleBackpressure = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
  );
  const stagingDiskReplay = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );

  assert.ok(blockers.includes('queue-pause-with-complete-footprint-without-memory-ceiling-match-visibility'));
  assert.ok(blockers.includes('staging-disk-headroom-visible-without-memory-ceiling-match-visibility'));
  assert.ok(
    blockers.includes('staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint'),
  );
  assert.deepEqual(releaseBundleBackpressure?.blockerRefs, [
    'queue-pause-with-complete-footprint-without-memory-ceiling-match-visibility',
    'staging-disk-headroom-visible-without-memory-ceiling-match-visibility',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(stagingDiskReplay?.blockerRefs, [
    'queue-pause-with-complete-footprint-without-memory-ceiling-match-visibility',
    'staging-disk-headroom-visible-without-memory-ceiling-match-visibility',
    'staging-disk-headroom-visible-without-visible-receipt-cursor-pause-footprint',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(
    summarizeRejectedGates(
      [releaseBundleBackpressure, stagingDiskReplay].filter(Boolean),
    ),
    [{ rejectedGate: 'recovery', count: 2 }],
  );
});

test('guarded benchmark carries non-terminal receipt-cursor blockers into rejected fast-path summaries', () => {
  const report = smallBenchmark();
  const mutated = clone(report);

  mutated.evidence.backpressure.queuePausedBeforeOverflow = true;
  mutated.evidence.chunkReceipts.cursorConsistency.canResumeFromCursor = false;

  const details = productionThroughputDetails(mutated);
  const blockers = productionThroughputBlockers(mutated);
  const releaseBundleBackpressure = details.rejectedFastPaths.find(
    (entry) =>
      entry.id === 'compressed-remote-index-and-cached-row-batch-receipts-skips-release-bundle-commit-after-pause-and-backpressure',
  );
  const stagingDiskReplay = details.rejectedFastPaths.find(
    (entry) => entry.id === 'cached-receipt-cursor-staging-disk-headroom-and-journal-lag-skips-post-pause-replay',
  );

  assert.ok(blockers.includes('queue-pause-without-terminal-receipt-cursor'));
  assert.ok(blockers.includes('receipt-cursor-not-terminal'));
  assert.deepEqual(releaseBundleBackpressure?.blockerRefs, [
    'queue-pause-without-terminal-receipt-cursor',
    'receipt-cursor-not-terminal',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(stagingDiskReplay?.blockerRefs, [
    'queue-pause-without-terminal-receipt-cursor',
    'receipt-cursor-not-terminal',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-backpressure',
    'queue-pause-without-resource-headroom-safe-receipt-cursor-slack',
    'queue-pause-without-consistent-receipt-cursor-slack',
    'queue-pause-without-memory-safe-receipt-cursor-slack',
  ]);
  assert.deepEqual(
    summarizeRejectedGates(
      [releaseBundleBackpressure, stagingDiskReplay].filter(Boolean),
    ),
    [{ rejectedGate: 'recovery', count: 2 }],
  );
});
