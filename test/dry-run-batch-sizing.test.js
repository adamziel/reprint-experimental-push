import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DRY_RUN_BATCH_SIZING_BENCHMARK_ID,
  DryRunBatchSizingConfigError,
  planDryRunBatches,
  runDryRunBatchSizingBenchmark,
  validateDryRunBatchLimits,
} from '../scripts/bench/dry-run-batch-sizing.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixedNow = new Date('2026-05-30T00:00:00.000Z');

test('RPP-0712 dry-run batch sizing keeps batches bounded and read-only', () => {
  const report = runDryRunBatchSizingBenchmark({
    profile: 'unit',
    now: fixedNow,
    fileResources: 5,
    wpPosts: 17,
    wpPostmeta: 31,
    wpOptions: 7,
    pluginMetadataResources: 2,
    maxBatchResources: 9,
    maxBatchEstimatedBytes: 8192,
    maxBatchPreconditions: 9,
  });

  assert.equal(report.rppId, 'RPP-0712');
  assert.equal(report.variant, 1);
  assert.equal(report.benchmark, DRY_RUN_BATCH_SIZING_BENCHMARK_ID);
  assert.equal(report.profile, 'unit');
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'deterministic-dry-run-batch-sizing');
  assert.equal(report.liveRemote.status, 'not-configured');
  assert.match(report.liveRemote.limitation, /No live remote service was configured or contacted/);
  assert.ok(report.resources.dryRun.batches > 1, 'fixture should force multiple dry-run batches');
  assert.equal(report.resources.dryRun.readOnly, true);
  assert.equal(report.resources.dryRun.finalReceiptRequiresCompleteBatchSet, true);
  assert.equal(report.resources.dryRun.finalReceiptApplyAuthorization, false);
  assert.equal(report.resources.dryRun.largestBatch.resourceCount <= 9, true);
  assert.equal(report.resources.dryRun.largestBatch.estimatedBytes <= 8192, true);
  assert.equal(report.resources.dryRun.largestBatch.preconditionCount <= 9, true);
  assert.equal(report.resources.dryRun.totalResources, 62);
  assert.equal(report.resources.dryRun.totalPreconditions, 62);
  assert.match(report.resources.dryRun.finalReceiptHash, /^[a-f0-9]{64}$/);

  assert.equal(report.resources.storageGuardProjection.outcome, 'stale-at-write');
  assert.equal(report.resources.storageGuardProjection.guardedWriteRejected, true);
  assert.equal(report.resources.storageGuardProjection.mutationApplied, false);
  assert.equal(report.resources.storageGuardProjection.dryRunReceiptAuthorizesMutation, false);

  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'final-receipt-requires-all-batches'));
  assert.ok(report.gates.some((gate) => gate.id === 'stale-storage-rejected-after-dry-run'));
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
});

test('RPP-0712 dry-run batch sizing projection is deterministic', () => {
  const options = {
    profile: 'unit',
    now: fixedNow,
    fileResources: 3,
    wpPosts: 9,
    wpPostmeta: 12,
    wpOptions: 4,
    pluginMetadataResources: 1,
    maxBatchResources: 6,
    maxBatchEstimatedBytes: 6144,
    maxBatchPreconditions: 6,
  };
  const first = runDryRunBatchSizingBenchmark(options);
  const second = runDryRunBatchSizingBenchmark(options);

  assert.deepEqual(first.limits, second.limits);
  assert.deepEqual(first.resources.dryRun, second.resources.dryRun);
  assert.deepEqual(first.resources.storageGuardProjection, second.resources.storageGuardProjection);
  assert.deepEqual(first.deterministicCoverage, second.deterministicCoverage);
});

test('RPP-0712 dry-run batch sizing fails closed for invalid limits and oversized items', () => {
  assert.throws(
    () => runDryRunBatchSizingBenchmark({ profile: 'unit', maxBatchResources: 0 }),
    (error) =>
      error instanceof DryRunBatchSizingConfigError
      && error.code === 'DRY_RUN_BATCH_LIMIT_INVALID'
      && error.details.field === 'maxBatchResources',
  );

  assert.throws(
    () => validateDryRunBatchLimits({
      maxBatchResources: 8,
      maxBatchEstimatedBytes: -1,
      maxBatchPreconditions: 8,
    }),
    (error) =>
      error instanceof DryRunBatchSizingConfigError
      && error.code === 'DRY_RUN_BATCH_LIMIT_INVALID'
      && error.details.field === 'maxBatchEstimatedBytes',
  );

  assert.throws(
    () => planDryRunBatches([
      {
        itemId: 'oversized-item',
        sequence: 0,
        kind: 'file',
        resourceKey: 'file:oversized.bin',
        resourceKeyHash: '4'.repeat(64),
        estimatedBytes: 4097,
        preconditionCount: 1,
        expectedHash: `sha256:${'a'.repeat(64)}`,
        plannedHash: `sha256:${'b'.repeat(64)}`,
        validatesOnly: true,
        applyAuthorization: false,
      },
    ], {
      maxBatchResources: 2,
      maxBatchEstimatedBytes: 4096,
      maxBatchPreconditions: 2,
    }),
    (error) =>
      error instanceof DryRunBatchSizingConfigError
      && error.code === 'DRY_RUN_BATCH_ITEM_EXCEEDS_LIMIT'
      && error.details.violations.includes('maxBatchEstimatedBytes'),
  );

  const report = runDryRunBatchSizingBenchmark({ profile: 'unit', now: fixedNow });
  assert.equal(report.resources.errorPathCoverage.allFailedClosed, true);
  assert.deepEqual(
    report.resources.errorPathCoverage.probes.map((probe) => [probe.id, probe.blocked, probe.code]),
    [
      ['zero-resource-limit', true, 'DRY_RUN_BATCH_LIMIT_INVALID'],
      ['oversized-resource-envelope', true, 'DRY_RUN_BATCH_ITEM_EXCEEDS_LIMIT'],
      ['missing-precondition-hash', true, 'DRY_RUN_BATCH_ITEM_INVALID'],
    ],
  );
});

test('RPP-0712 dry-run batch sizing CLI reports runtime, resources, and pass/fail gates', () => {
  const stdout = execFileSync(process.execPath, [
    'scripts/bench/dry-run-batch-sizing.js',
    '--profile=unit',
    '--file-resources=2',
    '--wp-posts=8',
    '--wp-postmeta=10',
    '--wp-options=3',
    '--plugin-metadata-resources=1',
    '--max-batch-resources=5',
    '--max-batch-estimated-bytes=4096',
    '--max-batch-preconditions=5',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const report = JSON.parse(stdout);
  const rootKeys = Object.keys(report);

  assert.equal(report.ok, true);
  assert.equal(report.rppId, 'RPP-0712');
  assert.ok(rootKeys.indexOf('runtime') < rootKeys.indexOf('limits'));
  assert.ok(rootKeys.indexOf('resources') < rootKeys.indexOf('gates'));
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.equal(report.resources.dryRun.totalResources, 24);
  assert.equal(report.resources.dryRun.finalReceiptApplyAuthorization, false);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.equal(report.deterministicCoverage.errorPathCoverage.allFailedClosed, true);
});

test('RPP-0712 dry-run batch evidence stays hash-and-count only', () => {
  const report = runDryRunBatchSizingBenchmark({
    profile: 'unit',
    now: fixedNow,
    fileResources: 1,
    wpPosts: 3,
    wpPostmeta: 3,
    wpOptions: 1,
    pluginMetadataResources: 1,
  });
  const encoded = JSON.stringify({
    resources: report.resources,
    deterministicCoverage: report.deterministicCoverage,
  });

  assert.doesNotMatch(encoded, /rpp-0712-raw-fixture|dry-run raw payload|customer secret|private option value/);
  assert.doesNotMatch(encoded, /post_content|option_value|meta_value/);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.match(report.deterministicCoverage.finalReceipt.receiptHash, /^[a-f0-9]{64}$/);
});
