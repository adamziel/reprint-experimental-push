import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILESYSTEM_MEMORY_CEILING_BOUNDARY,
} from '../src/filesystem-memory-ceiling-proof.js';
import {
  FILESYSTEM_MEMORY_CEILING_BENCHMARK_ID,
  runFilesystemMemoryCeilingProofBenchmark,
} from '../scripts/bench/filesystem-memory-ceiling-proof.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');

test('filesystem memory ceiling benchmark reports resources, gates, and stale rejection', () => {
  const report = runFilesystemMemoryCeilingProofBenchmark({
    profile: 'unit',
    now: fixedNow,
    updateFiles: 3,
    createFiles: 2,
    staleFiles: 2,
    fileBytes: 64 * 1024,
    chunkSizeBytes: 4096,
    maxBufferedBytes: 4096,
  });

  assert.equal(report.rppId, 'RPP-0717');
  assert.equal(report.benchmark, FILESYSTEM_MEMORY_CEILING_BENCHMARK_ID);
  assert.equal(report.profile, 'unit');
  assert.equal(report.ok, true);
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.ok(report.runtime.durationMs >= 0);
  assert.equal(report.runtime.budgets.profile, 'unit');
  assert.equal(report.runtime.budgets.maxBufferedBytes, 4096);
  assert.equal(report.runtime.budgets.chunkSizeBytes, 4096);

  assert.equal(report.resources.storage.boundary, FILESYSTEM_MEMORY_CEILING_BOUNDARY);
  assert.equal(report.resources.storage.engine, 'filesystem');
  assert.equal(report.resources.storage.tempPlacement, 'same-directory');
  assert.equal(report.resources.storage.guardedWritesAttempted, 7);
  assert.equal(report.resources.storage.appliedWrites, 5);
  assert.equal(report.resources.storage.staleAtWriteWrites, 2);
  assert.equal(report.resources.storage.unsafeRenameOnStaleWrites, 0);
  assert.equal(report.resources.tempLeaks, 0);
  assert.equal(report.resources.bytes.tempWrittenBytes, 7 * 64 * 1024);
  assert.equal(report.resources.bytes.renamedBytes, 5 * 64 * 1024);
  assert.equal(report.resources.bytes.driftPreservedBytes, 2 * 64 * 1024);
  assert.equal(report.resources.memoryCeiling.maxObservedBufferedBytes, 4096);
  assert.equal(report.resources.memoryCeiling.ceilingBreaches, 0);
  assert.equal(report.resources.memoryCeiling.fullPayloadBufferWrites, 0);
  assert.equal(report.resources.memoryCeiling.materializedPayloadWrites, 0);
  assert.equal(report.resources.memoryCeiling.payloadBytesGreaterThanCeilingWrites, 7);
  assert.equal(report.resources.memoryCeiling.streamedWrites, 7);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');

  assert.ok(report.gates.length >= 8);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'memory-ceiling-held-before-live-compare'));
  assert.ok(report.gates.some((gate) => gate.id === 'stale-storage-rejected-and-preserved'));
  assert.ok(report.gates.some((gate) => gate.id === 'runtime-resource-budget'));
});

test('filesystem memory ceiling benchmark records hash-only evidence for streamed stale rejections', () => {
  const report = runFilesystemMemoryCeilingProofBenchmark({
    profile: 'unit',
    now: fixedNow,
    updateFiles: 1,
    createFiles: 1,
    staleFiles: 1,
    fileBytes: 32 * 1024,
    chunkSizeBytes: 4096,
    maxBufferedBytes: 4096,
  });

  assert.equal(report.deterministicCoverage.failures.length, 0);
  assert.equal(report.deterministicCoverage.writes.applied, 2);
  assert.equal(report.deterministicCoverage.writes.staleAtWrite, 1);
  assert.equal(report.deterministicCoverage.writes.stalePreserved, 1);
  assert.equal(report.deterministicCoverage.writes.unsafeRenameOnStale, 0);
  assert.equal(report.deterministicCoverage.memory.ceilingBreaches, 0);
  assert.equal(report.deterministicCoverage.memory.maxObservedBufferedBytes, 4096);
  assert.equal(report.deterministicCoverage.tempLeaks, 0);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);

  const outcomes = new Set(report.deterministicCoverage.evidenceSamples.map((evidence) => evidence.outcome));
  assert.ok(outcomes.has('applied'));
  assert.ok(outcomes.has('stale-at-write'));

  for (const evidence of report.deterministicCoverage.evidenceSamples) {
    assert.equal(evidence.boundary, FILESYSTEM_MEMORY_CEILING_BOUNDARY);
    assert.equal(evidence.sameDirectoryTemp, true);
    assert.equal(evidence.compareBeforeRename, true);
    assert.equal(evidence.memoryCeiling.ceilingHeld, true);
    assert.equal(evidence.memoryCeiling.fullPayloadBufferUsed, false);
    assert.equal(evidence.memoryCeiling.plannedPayloadMaterialized, false);
    assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.actualStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(evidence), /memory-(?:base|planned|drift)-payload|filesystem memory raw fixture/);
  }
});

test('filesystem memory ceiling large-site profile keeps documented budgets in the report', () => {
  const report = runFilesystemMemoryCeilingProofBenchmark({
    profile: 'large-site',
    now: fixedNow,
    updateFiles: 2,
    createFiles: 1,
    staleFiles: 1,
    fileBytes: 128 * 1024,
    chunkSizeBytes: 8192,
    maxBufferedBytes: 8192,
    maxDurationMs: 5_000,
    maxHeapUsedBytes: 128 * 1024 * 1024,
  });

  assert.equal(report.profile, 'large-site');
  assert.equal(report.runtime.budgets.profile, 'large-site');
  assert.equal(report.runtime.budgets.maxDurationMs, 5_000);
  assert.equal(report.runtime.budgets.maxHeapUsedBytes, 128 * 1024 * 1024);
  assert.equal(report.runtime.budgets.maxBufferedBytes, 8192);
  assert.equal(report.ok, true);
  assert.equal(report.resources.workload.expectedWrites, 4);
  assert.equal(report.resources.memoryCeiling.maxObservedBufferedBytes, 8192);
  assert.ok(report.gates.some((gate) => (
    gate.id === 'runtime-resource-budget'
      && gate.status === 'pass'
      && gate.evidence.profile === 'large-site'
  )));
});
