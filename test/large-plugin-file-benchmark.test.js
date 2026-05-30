import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  LARGE_PLUGIN_FILE_BENCHMARK_ID,
  LARGE_PLUGIN_FILE_BOUNDARY,
  LARGE_PLUGIN_FILE_GROUP_ID,
  runLargePluginFileBenchmark,
} from '../scripts/bench/large-plugin-file-benchmark.js';
import { FILESYSTEM_FSYNC_BOUNDARY } from '../src/filesystem-fsync-evidence.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');

function unitPluginFiles() {
  return [
    pluginFile('payments', 'payments.php', 2048, 'text/x-php', true),
    pluginFile('payments', 'assets/admin.js', 4096, 'application/javascript', true),
    pluginFile('commerce', 'commerce.php', 2048, 'text/x-php', true),
    pluginFile('commerce', 'assets/catalog.dat', 8192, 'application/octet-stream', false),
  ];
}

test('large plugin file benchmark reports runtime, resources, and pass/fail gates', () => {
  const report = runLargePluginFileBenchmark({
    profile: 'unit',
    now: fixedNow,
    pluginFiles: unitPluginFiles(),
    chunkSizeBytes: 2048,
    maxDurationMs: 5_000,
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0716');
  assert.equal(report.benchmark, LARGE_PLUGIN_FILE_BENCHMARK_ID);
  assert.equal(report.variant, 1);
  assert.equal(report.profile, 'unit');
  assert.equal(report.ok, true);
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.ok(report.runtime.durationMs >= 0);
  assert.equal(report.runtime.budgets.profile, 'unit');

  assert.equal(report.resources.storage.boundary, LARGE_PLUGIN_FILE_BOUNDARY);
  assert.equal(report.resources.storage.engine, 'filesystem');
  assert.equal(report.resources.storage.adapter, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(report.resources.storage.atomicGroupId, LARGE_PLUGIN_FILE_GROUP_ID);
  assert.equal(report.resources.workload.pluginFiles, 4);
  assert.equal(report.resources.workload.totalPluginFileBytes, 16_384);
  assert.equal(report.resources.workload.largestPluginFileBytes, 8192);
  assert.equal(report.resources.workload.expectedGuardedWrites, 8);
  assert.equal(report.resources.storage.guardedWritesAttempted, 8);
  assert.equal(report.resources.storage.stagedWrites, 4);
  assert.equal(report.resources.storage.committedWrites, 4);
  assert.equal(report.resources.storage.appliedFsyncCompleteWrites, 8);
  assert.equal(report.resources.storage.groupFinalizeRecords, 1);
  assert.equal(report.resources.storage.atomicGroupCommits, 1);
  assert.equal(report.resources.storage.unsafeLiveVisibleBeforeCommit, 0);
  assert.equal(report.resources.chunks.receipts, 8);
  assert.equal(report.resources.chunks.expectedReceipts, 8);
  assert.equal(report.resources.chunks.bytesReceipted, 16_384);
  assert.equal(report.resources.chunks.duplicateReceiptKeys, 0);
  assert.equal(report.resources.chunks.receiptOnlyResumeSkips, 8);
  assert.equal(report.resources.chunks.missingReceiptBlocksResume, true);
  assert.equal(report.resources.chunks.mismatchedReceiptBlocksResume, true);
  assert.equal(report.resources.bytes.stagedBytes, 16_384);
  assert.equal(report.resources.bytes.committedBytes, 16_384);
  assert.equal(report.resources.bytes.liveVisibleBeforeCommitBytes, 0);
  assert.equal(report.resources.bytes.liveVisibleAfterCommitBytes, 16_384);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');

  assert.ok(report.gates.length >= 9);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'chunk-receipts-cover-large-plugin-files'));
  assert.ok(report.gates.some((gate) => gate.id === 'runtime-resource-budget'));
});

test('large plugin file benchmark keeps plugin files invisible until group commit', () => {
  const report = runLargePluginFileBenchmark({
    profile: 'unit',
    now: fixedNow,
    pluginFiles: unitPluginFiles(),
    chunkSizeBytes: 4096,
  });

  assert.equal(report.atomicGroup.id, LARGE_PLUGIN_FILE_GROUP_ID);
  assert.equal(report.atomicGroup.commitPolicy, 'all-or-nothing');
  assert.equal(report.atomicGroup.canonicalVisibleBeforeCommit, false);
  assert.equal(report.atomicGroup.finalized, true);
  assert.equal(report.atomicGroup.committed, true);
  assert.equal(report.atomicGroup.requiredChunkReceipts, 5);
  assert.equal(report.atomicGroup.requiredStagedFiles, 4);
  assert.equal(report.atomicGroup.livePreconditionsRechecked, 4);
  assert.equal(report.atomicGroup.allFilesVisibleAfterCommit, true);

  assert.equal(report.deterministicCoverage.group.canonicalVisibleBeforeCommit, false);
  assert.equal(report.deterministicCoverage.group.finalized, true);
  assert.equal(report.deterministicCoverage.group.committed, true);
  assert.equal(report.deterministicCoverage.writes.livePreconditionChecks, 4);
  assert.equal(report.deterministicCoverage.writes.livePreconditionDrift, 0);
});

test('large plugin file benchmark records hash-only storage and chunk receipt evidence', () => {
  const report = runLargePluginFileBenchmark({
    profile: 'unit',
    now: fixedNow,
    pluginFiles: unitPluginFiles(),
    chunkSizeBytes: 4096,
  });

  assert.equal(report.deterministicCoverage.failures.length, 0);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.equal(report.deterministicCoverage.evidenceSamples.length, 8);
  assert.equal(report.deterministicCoverage.chunkReceiptSamples.length, 5);

  for (const evidence of report.deterministicCoverage.evidenceSamples) {
    assert.equal(evidence.boundary, FILESYSTEM_FSYNC_BOUNDARY);
    assert.equal(evidence.engine, 'filesystem');
    assert.match(evidence.expectedResourceHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.expectedStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.actualStorageHash, /^[a-f0-9]{64}$/);
    assert.match(evidence.plannedStorageHash, /^[a-f0-9]{64}$/);
    assert.equal(evidence.fastPathLane.updated, true);
    assert.equal(evidence.fsyncEvidence.tempFile.status, 'passed');
    assert.equal(evidence.fsyncEvidence.targetDirectory.status, 'passed');
    assert.equal(evidence.correctnessGates.every((gate) => gate.status === 'pass'), true);
    assert.doesNotMatch(
      JSON.stringify(evidence),
      /plugin-file-(?:base|planned)-payload|large plugin file raw fixture/,
    );
  }

  for (const receipt of report.deterministicCoverage.chunkReceiptSamples) {
    assert.match(receipt.resourceKeyHash, /^[a-f0-9]{64}$/);
    assert.match(receipt.chunkDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(receipt.receiptKeyHash, /^[a-f0-9]{64}$/);
    assert.match(receipt.idempotencyKeyHash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(receipt), /plugin-file-(?:base|planned)-payload/);
  }
});

test('large plugin file large-site profile keeps documented budgets in the report', () => {
  const report = runLargePluginFileBenchmark({
    profile: 'large-site',
    now: fixedNow,
    pluginFiles: [
      pluginFile('commerce', 'commerce.php', 4096, 'text/x-php', true),
      pluginFile('commerce', 'assets/catalog.dat', 12_288, 'application/octet-stream', false),
    ],
    chunkSizeBytes: 4096,
    maxDurationMs: 5_000,
    maxHeapUsedBytes: 128 * 1024 * 1024,
  });

  assert.equal(report.profile, 'large-site');
  assert.equal(report.runtime.budgets.profile, 'large-site');
  assert.equal(report.runtime.budgets.maxDurationMs, 5_000);
  assert.equal(report.runtime.budgets.maxHeapUsedBytes, 128 * 1024 * 1024);
  assert.equal(report.ok, true);
  assert.equal(report.resources.workload.pluginFiles, 2);
  assert.equal(report.resources.workload.expectedChunks, 4);
  assert.equal(report.resources.chunks.receipts, 4);
  assert.equal(report.resources.storage.atomicGroupCommits, 1);
  assert.ok(report.gates.some((gate) => (
    gate.id === 'runtime-resource-budget'
      && gate.status === 'pass'
      && gate.evidence.profile === 'large-site'
  )));
});

test('large plugin file CLI emits parseable benchmark evidence', () => {
  const stdout = execFileSync(process.execPath, [
    'scripts/bench/large-plugin-file-benchmark.js',
    '--profile=unit',
    '--catalog-bytes=8192',
    '--chunk-size-bytes=4096',
    '--max-duration-ms=5000',
  ], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  const report = JSON.parse(stdout);
  const rootKeys = Object.keys(report);

  assert.equal(report.rppId, 'RPP-0716');
  assert.equal(report.benchmark, LARGE_PLUGIN_FILE_BENCHMARK_ID);
  assert.equal(report.ok, true);
  assert.ok(rootKeys.indexOf('runtime') < rootKeys.indexOf('resources'));
  assert.ok(rootKeys.indexOf('resources') < rootKeys.indexOf('gates'));
  assert.equal(report.resources.storage.boundary, LARGE_PLUGIN_FILE_BOUNDARY);
  assert.ok(report.gates.every((gate) => gate.status === 'pass'));
});

function pluginFile(plugin, relativePath, sizeBytes, mimeType, compressible) {
  const path = `wp-content/plugins/${plugin}/${relativePath}`;
  return {
    resourceKey: `file:${path}`,
    path,
    pluginOwner: plugin,
    sizeBytes,
    mimeType,
    compressible,
  };
}
