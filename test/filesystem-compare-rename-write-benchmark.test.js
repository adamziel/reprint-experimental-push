import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILESYSTEM_COMPARE_RENAME_BOUNDARY,
} from '../src/filesystem-compare-rename-write.js';
import {
  FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID,
  runFilesystemCompareRenameBenchmark,
} from '../scripts/bench/filesystem-compare-rename-write.js';

const fixedNow = new Date('2026-05-29T00:00:00.000Z');

test('filesystem compare-and-rename benchmark reports runtime, resources, and pass/fail gates', () => {
  const report = runFilesystemCompareRenameBenchmark({
    profile: 'unit',
    now: fixedNow,
    updateFiles: 3,
    createFiles: 2,
    staleFiles: 2,
    fileBytes: 4096,
  });

  assert.equal(report.rppId, 'RPP-0704');
  assert.equal(report.benchmark, FILESYSTEM_COMPARE_RENAME_BENCHMARK_ID);
  assert.equal(report.profile, 'unit');
  assert.equal(report.ok, true);
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.ok(report.runtime.durationMs >= 0);
  assert.equal(report.runtime.budgets.profile, 'unit');

  assert.equal(report.resources.storage.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
  assert.equal(report.resources.storage.engine, 'filesystem');
  assert.equal(report.resources.storage.tempPlacement, 'same-directory');
  assert.equal(report.resources.storage.guardedWritesAttempted, 7);
  assert.equal(report.resources.storage.appliedWrites, 5);
  assert.equal(report.resources.storage.staleAtWriteWrites, 2);
  assert.equal(report.resources.storage.unsafeRenameOnStaleWrites, 0);
  assert.equal(report.resources.tempLeaks, 0);
  assert.equal(report.resources.bytes.renamedBytes, 5 * 4096);
  assert.equal(report.resources.bytes.driftPreservedBytes, 2 * 4096);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');

  assert.ok(report.gates.length >= 7);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'same-directory-compare-before-rename-evidence'));
  assert.ok(report.gates.some((gate) => gate.id === 'large-site-runtime-budget'));
});

test('filesystem compare-and-rename benchmark records stale rejections without raw fixture evidence', () => {
  const report = runFilesystemCompareRenameBenchmark({
    profile: 'unit',
    now: fixedNow,
    updateFiles: 1,
    createFiles: 1,
    staleFiles: 1,
    fileBytes: 1024,
  });

  assert.equal(report.deterministicCoverage.failures.length, 0);
  assert.equal(report.deterministicCoverage.writes.applied, 2);
  assert.equal(report.deterministicCoverage.writes.staleAtWrite, 1);
  assert.equal(report.deterministicCoverage.writes.stalePreserved, 1);
  assert.equal(report.deterministicCoverage.writes.unsafeRenameOnStale, 0);
  assert.equal(report.deterministicCoverage.tempLeaks, 0);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);

  for (const evidence of report.deterministicCoverage.evidenceSamples) {
    assert.equal(evidence.boundary, FILESYSTEM_COMPARE_RENAME_BOUNDARY);
    assert.equal(evidence.sameDirectoryTemp, true);
    assert.equal(evidence.compareBeforeRename, true);
    assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.actualStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(evidence), /fs-(?:base|planned|drift)-payload|filesystem raw fixture/);
  }
});

test('filesystem compare-and-rename large-site profile keeps documented budgets in the report', () => {
  const report = runFilesystemCompareRenameBenchmark({
    profile: 'large-site',
    now: fixedNow,
    updateFiles: 2,
    createFiles: 1,
    staleFiles: 1,
    fileBytes: 2048,
    maxDurationMs: 5_000,
    maxHeapUsedBytes: 128 * 1024 * 1024,
  });

  assert.equal(report.profile, 'large-site');
  assert.equal(report.runtime.budgets.profile, 'large-site');
  assert.equal(report.runtime.budgets.maxDurationMs, 5_000);
  assert.equal(report.runtime.budgets.maxHeapUsedBytes, 128 * 1024 * 1024);
  assert.equal(report.ok, true);
  assert.equal(report.resources.workload.expectedWrites, 4);
  assert.ok(report.gates.some((gate) => (
    gate.id === 'large-site-runtime-budget'
      && gate.status === 'pass'
      && gate.evidence.profile === 'large-site'
  )));
});
