import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILESYSTEM_FSYNC_BOUNDARY,
} from '../src/filesystem-fsync-evidence.js';
import {
  LARGE_MEDIA_LIBRARY_BENCHMARK_ID,
  LARGE_MEDIA_LIBRARY_FAST_PATH_LANE,
  runLargeMediaLibraryBenchmark,
} from '../scripts/bench/large-media-library-benchmark.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');

test('large media library benchmark reports resources, batches, gates, and fast-path lane gating', () => {
  const report = runLargeMediaLibraryBenchmark({
    profile: 'unit',
    now: fixedNow,
    updateMedia: 3,
    createMedia: 2,
    staleMedia: 1,
    tempFsyncFailureMedia: 1,
    directoryFsyncFailureMedia: 1,
    fileBytes: 2048,
    metadataRowsPerMedia: 2,
    maxDbBatchRows: 4,
  });

  assert.equal(report.rppId, 'RPP-0715');
  assert.equal(report.benchmark, LARGE_MEDIA_LIBRARY_BENCHMARK_ID);
  assert.equal(report.profile, 'unit');
  assert.equal(report.ok, true);
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.ok(report.runtime.durationMs >= 0);
  assert.equal(report.runtime.budgets.profile, 'unit');
  assert.equal(report.runtime.budgets.maxDbBatchRows, 4);

  assert.equal(report.resources.storage.boundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(report.resources.storage.engine, 'filesystem');
  assert.equal(report.resources.storage.mediaDriver, 'benchmark-media-library-file');
  assert.equal(report.resources.storage.mediaWritesAttempted, 8);
  assert.equal(report.resources.storage.appliedMediaWrites, 6);
  assert.equal(report.resources.storage.appliedFsyncCompleteMediaWrites, 5);
  assert.equal(report.resources.storage.appliedFsyncIncompleteMediaWrites, 1);
  assert.equal(report.resources.storage.staleAtWriteMediaWrites, 1);
  assert.equal(report.resources.storage.tempFsyncFailedBeforeRenameMediaWrites, 1);
  assert.equal(report.resources.storage.unsafeRenameOnStaleMediaWrites, 0);
  assert.equal(report.resources.storage.unsafeRenameAfterTempFsyncFailureMediaWrites, 0);
  assert.equal(report.resources.storage.postWriteStorageVerified, 5);

  assert.deepEqual(report.resources.database.tables, ['wp_posts', 'wp_postmeta']);
  assert.equal(report.resources.database.attachmentRowsPreconditioned, 8);
  assert.equal(report.resources.database.metadataRowsPreconditioned, 16);
  assert.equal(report.resources.database.rowPreconditions, 24);
  assert.equal(report.resources.database.rowPreconditionsAttachedToLaneUpdates, 15);
  assert.equal(report.resources.database.batchCount, 6);
  assert.equal(report.resources.database.maxBatchRowsObserved, 4);
  assert.equal(report.resources.database.batchesOverLimit, 0);

  assert.equal(report.fastPathLane.id, LARGE_MEDIA_LIBRARY_FAST_PATH_LANE);
  assert.equal(report.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(report.fastPathLane.updates, 5);
  assert.equal(report.fastPathLane.blocked, 3);
  assert.deepEqual(report.fastPathLane.blockedBy, {
    'live-storage-mismatch': 1,
    'target-directory-fsync-missing': 1,
    'temp-file-fsync-missing': 1,
  });

  assert.ok(report.gates.length >= 9);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'fast-path-lane-updates-only-after-correctness-gates'));
  assert.ok(report.gates.some((gate) => gate.id === 'attachment-row-preconditions-retained'));
  assert.ok(report.gates.some((gate) => gate.id === 'media-db-batches-within-budget'));

  const rootKeys = Object.keys(report);
  assert.ok(rootKeys.indexOf('gates') < rootKeys.indexOf('fastPathLane'));
});

test('large media library benchmark records hash-only media row and storage evidence', () => {
  const report = runLargeMediaLibraryBenchmark({
    profile: 'unit',
    now: fixedNow,
    updateMedia: 1,
    createMedia: 1,
    staleMedia: 1,
    tempFsyncFailureMedia: 1,
    directoryFsyncFailureMedia: 1,
    fileBytes: 1024,
    metadataRowsPerMedia: 3,
    maxDbBatchRows: 3,
  });

  assert.equal(report.deterministicCoverage.failures.length, 0);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.equal(report.deterministicCoverage.media.appliedFsyncComplete, 2);
  assert.equal(report.deterministicCoverage.media.appliedFsyncIncomplete, 1);
  assert.equal(report.deterministicCoverage.media.staleAtWrite, 1);
  assert.equal(report.deterministicCoverage.media.tempFsyncFailedBeforeRename, 1);
  assert.equal(report.deterministicCoverage.fastPathLane.updated, 2);
  assert.equal(report.deterministicCoverage.fastPathLane.blocked, 3);
  assert.equal(report.deterministicCoverage.db.rowPreconditions, 20);
  assert.equal(report.deterministicCoverage.db.rowPreconditionsAttachedToLaneUpdates, 8);

  const outcomes = new Set(
    report.deterministicCoverage.evidenceSamples.map((sample) => sample.storageGuard.outcome),
  );
  assert.ok(outcomes.has('applied'));
  assert.ok(outcomes.has('stale-at-write'));
  assert.ok(outcomes.has('fsync-failed-before-rename'));
  assert.ok(outcomes.has('applied-fsync-incomplete'));

  for (const sample of report.deterministicCoverage.evidenceSamples) {
    assert.equal(sample.storageGuard.boundary, FILESYSTEM_FSYNC_BOUNDARY);
    assert.equal(sample.storageGuard.sameDirectoryTemp, true);
    assert.equal(sample.storageGuard.compareBeforeRename, true);
    assert.match(sample.storageGuard.expectedResourceHash, /^[a-f0-9]{64}$/);
    assert.match(sample.storageGuard.expectedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(sample.storageGuard.actualStorageHash, /^[a-f0-9]{64}$/);
    assert.match(sample.storageGuard.plannedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(sample.mediaRows.attachmentRowHash, /^[a-f0-9]{64}$/);
    assert.equal(sample.mediaRows.metadataRowHashes.length, 3);
    assert.equal(sample.mediaRows.allRowsHaveExpectedRemoteHash, true);
    assert.equal(
      sample.storageGuard.fastPathLane.updated,
      sample.storageGuard.correctnessGates.every((gate) => gate.status === 'pass')
        && sample.storageGuard.outcome === 'applied',
    );
    assert.doesNotMatch(JSON.stringify(sample), /media-(?:base|planned|drift)-payload|large media raw fixture/);
  }
});

test('large media library large-site profile keeps runtime and batch budgets in the report', () => {
  const report = runLargeMediaLibraryBenchmark({
    profile: 'large-site',
    now: fixedNow,
    updateMedia: 4,
    createMedia: 2,
    staleMedia: 1,
    tempFsyncFailureMedia: 1,
    directoryFsyncFailureMedia: 1,
    fileBytes: 4096,
    metadataRowsPerMedia: 4,
    maxDbBatchRows: 5,
    maxDurationMs: 5_000,
    maxHeapUsedBytes: 128 * 1024 * 1024,
  });

  assert.equal(report.profile, 'large-site');
  assert.equal(report.runtime.budgets.profile, 'large-site');
  assert.equal(report.runtime.budgets.maxDurationMs, 5_000);
  assert.equal(report.runtime.budgets.maxHeapUsedBytes, 128 * 1024 * 1024);
  assert.equal(report.runtime.budgets.maxDbBatchRows, 5);
  assert.equal(report.ok, true);
  assert.equal(report.resources.workload.attemptedMedia, 9);
  assert.equal(report.resources.database.maxBatchRowsObserved, 5);
  assert.equal(report.fastPathLane.updates, 6);
  assert.ok(report.gates.some((gate) => (
    gate.id === 'runtime-resource-budget'
      && gate.status === 'pass'
      && gate.evidence.profile === 'large-site'
  )));
  assert.ok(report.gates.some((gate) => (
    gate.id === 'media-db-batches-within-budget'
      && gate.status === 'pass'
      && gate.evidence.maxDbBatchRows === 5
  )));
});
