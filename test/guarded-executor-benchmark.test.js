import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BenchmarkClaimError,
  productionThroughputBlockers,
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
  assert.equal(
    report.claims.productionThroughputDetails.executorCapabilities.fileReceipts,
    'lab-file-journal-receipts',
  );
  assert.equal(
    report.claims.productionThroughputDetails.resourceLimits.memoryCeilingBytes,
    32 * 1024 * 1024,
  );
  assert.equal(
    report.claims.productionThroughputDetails.recovery.partialCommitInspectionStatus,
    'blocked-recovery',
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
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-durable-chunk-receipts'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-live-remote-preconditions'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-partial-commit-recovery-evidence'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('wordpress-graph-identity-evidence-not-proven'));

  assert.throws(
    () => smallBenchmark({ claimProductionThroughput: true }),
    (error) =>
      error instanceof BenchmarkClaimError
      && error.code === 'PRODUCTION_THROUGHPUT_CLAIM_BLOCKED'
      && error.details.throughput.productionThroughput === 'not-claimed'
      && error.details.executorCapabilities.fileReceipts === 'lab-file-journal-receipts'
      && error.details.resourceLimits.memoryCeilingBytes === 32 * 1024 * 1024
      && error.details.blockers.includes('production-atomic-group-commit-not-measured'),
  );
});

test('production claim gate fails closed if benchmark evidence is tampered', () => {
  const report = smallBenchmark();

  const missingReceipt = clone(report);
  missingReceipt.evidence.chunkReceipts.recorded -= 1;
  assert.ok(productionThroughputBlockers(missingReceipt).includes('missing-durable-chunk-receipts'));

  const missingPrecondition = clone(report);
  missingPrecondition.evidence.preconditions.everyMutationHasLiveRemotePrecondition = false;
  assert.ok(productionThroughputBlockers(missingPrecondition).includes('missing-live-remote-preconditions'));

  const missingRecovery = clone(report);
  missingRecovery.evidence.recovery.partialCommitBlocksRecovery = false;
  assert.ok(
    productionThroughputBlockers(missingRecovery).includes('missing-partial-commit-recovery-evidence'),
  );

  const missingMemoryCeiling = clone(report);
  delete missingMemoryCeiling.resourceLimits.memoryCeilingBytes;
  assert.ok(
    productionThroughputBlockers(missingMemoryCeiling).includes('production-memory-ceiling-not-measured'),
  );

  const missingGraphIdentity = clone(report);
  missingGraphIdentity.evidence.wordpressGraphIdentity.allPostmetaReferencesUseStableRemoteIdentity = false;
  assert.ok(
    productionThroughputBlockers(missingGraphIdentity).includes('wordpress-graph-identity-evidence-not-proven'),
  );
});
