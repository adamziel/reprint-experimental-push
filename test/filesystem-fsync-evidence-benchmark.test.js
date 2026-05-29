import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILESYSTEM_FSYNC_BOUNDARY,
  FILESYSTEM_FSYNC_FAST_PATH_LANE,
} from '../src/filesystem-fsync-evidence.js';
import {
  FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID,
  runFilesystemFsyncEvidenceBenchmark,
} from '../scripts/bench/filesystem-fsync-evidence.js';

const fixedNow = new Date('2026-05-29T00:00:00.000Z');

test('filesystem fsync benchmark reports resources, gates, and fast-path lane gating', () => {
  const report = runFilesystemFsyncEvidenceBenchmark({
    profile: 'unit',
    now: fixedNow,
    updateFiles: 3,
    createFiles: 2,
    staleFiles: 1,
    tempFsyncFailureFiles: 1,
    directoryFsyncFailureFiles: 1,
    fileBytes: 2048,
  });

  assert.equal(report.rppId, 'RPP-0705');
  assert.equal(report.benchmark, FILESYSTEM_FSYNC_EVIDENCE_BENCHMARK_ID);
  assert.equal(report.profile, 'unit');
  assert.equal(report.ok, true);
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.ok(report.runtime.durationMs >= 0);
  assert.equal(report.runtime.budgets.profile, 'unit');

  assert.equal(report.resources.storage.boundary, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(report.resources.storage.engine, 'filesystem');
  assert.equal(report.resources.storage.fsyncStrategy, 'temp-file-before-rename-and-directory-after-rename');
  assert.equal(report.resources.storage.guardedWritesAttempted, 8);
  assert.equal(report.resources.storage.appliedWrites, 6);
  assert.equal(report.resources.storage.appliedFsyncCompleteWrites, 5);
  assert.equal(report.resources.storage.appliedFsyncIncompleteWrites, 1);
  assert.equal(report.resources.storage.staleAtWriteWrites, 1);
  assert.equal(report.resources.storage.tempFsyncFailedBeforeRenameWrites, 1);
  assert.equal(report.resources.storage.unsafeRenameOnStaleWrites, 0);
  assert.equal(report.resources.storage.unsafeRenameAfterTempFsyncFailureWrites, 0);
  assert.equal(report.resources.tempLeaks, 0);
  assert.equal(report.resources.bytes.fastPathLaneBytes, 5 * 2048);
  assert.equal(report.resources.bytes.fsyncIncompleteAppliedBytes, 2048);
  assert.equal(report.resources.bytes.driftPreservedBytes, 2048);
  assert.equal(report.resources.bytes.tempFsyncFailurePreservedBytes, 2048);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');

  assert.ok(report.gates.length >= 9);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'correctness-gates-before-fast-path-lane'));
  assert.ok(report.gates.some((gate) => gate.id === 'temp-and-directory-fsync-required-for-updates'));
  assert.ok(report.gates.some((gate) => gate.id === 'directory-fsync-failure-withholds-fast-path-lane-update'));

  assert.equal(report.fastPathLane.id, FILESYSTEM_FSYNC_FAST_PATH_LANE);
  assert.equal(report.fastPathLane.updatesOnlyAfterCorrectnessGates, true);
  assert.equal(report.fastPathLane.updates, 5);
  assert.equal(report.fastPathLane.blocked, 3);
  assert.deepEqual(report.fastPathLane.blockedBy, {
    'live-storage-mismatch': 1,
    'target-directory-fsync-missing': 1,
    'temp-file-fsync-missing': 1,
  });

  const rootKeys = Object.keys(report);
  assert.ok(rootKeys.indexOf('gates') < rootKeys.indexOf('fastPathLane'));
});

test('filesystem fsync benchmark records hash-only evidence samples for success and blocked lanes', () => {
  const report = runFilesystemFsyncEvidenceBenchmark({
    profile: 'unit',
    now: fixedNow,
    updateFiles: 1,
    createFiles: 1,
    staleFiles: 1,
    tempFsyncFailureFiles: 1,
    directoryFsyncFailureFiles: 1,
    fileBytes: 1024,
  });

  assert.equal(report.deterministicCoverage.failures.length, 0);
  assert.equal(report.deterministicCoverage.writes.appliedFsyncComplete, 2);
  assert.equal(report.deterministicCoverage.writes.appliedFsyncIncomplete, 1);
  assert.equal(report.deterministicCoverage.writes.staleAtWrite, 1);
  assert.equal(report.deterministicCoverage.writes.tempFsyncFailedBeforeRename, 1);
  assert.equal(report.deterministicCoverage.fastPathLane.updated, 2);
  assert.equal(report.deterministicCoverage.fastPathLane.blocked, 3);
  assert.equal(report.deterministicCoverage.fastPathLane.unsafeUpdatesBeforeGates, 0);
  assert.equal(report.deterministicCoverage.tempLeaks, 0);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);

  const outcomes = new Set(report.deterministicCoverage.evidenceSamples.map((evidence) => evidence.outcome));
  assert.ok(outcomes.has('applied'));
  assert.ok(outcomes.has('stale-at-write'));
  assert.ok(outcomes.has('fsync-failed-before-rename'));
  assert.ok(outcomes.has('applied-fsync-incomplete'));

  for (const evidence of report.deterministicCoverage.evidenceSamples) {
    assert.equal(evidence.boundary, FILESYSTEM_FSYNC_BOUNDARY);
    assert.equal(evidence.sameDirectoryTemp, true);
    assert.equal(evidence.compareBeforeRename, true);
    assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.actualStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
    assert.equal(evidence.fastPathLane.correctnessGatesEvaluatedBeforeUpdate, true);
    assert.equal(
      evidence.fastPathLane.updated,
      evidence.correctnessGates.every((gate) => gate.status === 'pass') && evidence.outcome === 'applied',
    );
    assert.doesNotMatch(JSON.stringify(evidence), /fsync-(?:base|planned|drift)-payload|filesystem fsync raw fixture/);
  }
});

test('filesystem fsync large-site profile keeps documented budgets in the report', () => {
  const report = runFilesystemFsyncEvidenceBenchmark({
    profile: 'large-site',
    now: fixedNow,
    updateFiles: 3,
    createFiles: 2,
    staleFiles: 1,
    tempFsyncFailureFiles: 1,
    directoryFsyncFailureFiles: 1,
    fileBytes: 4096,
    maxDurationMs: 5_000,
    maxHeapUsedBytes: 128 * 1024 * 1024,
  });

  assert.equal(report.profile, 'large-site');
  assert.equal(report.runtime.budgets.profile, 'large-site');
  assert.equal(report.runtime.budgets.maxDurationMs, 5_000);
  assert.equal(report.runtime.budgets.maxHeapUsedBytes, 128 * 1024 * 1024);
  assert.equal(report.ok, true);
  assert.equal(report.resources.workload.expectedWrites, 8);
  assert.equal(report.fastPathLane.updates, 5);
  assert.ok(report.gates.some((gate) => (
    gate.id === 'runtime-resource-budget'
      && gate.status === 'pass'
      && gate.evidence.profile === 'large-site'
  )));
});
