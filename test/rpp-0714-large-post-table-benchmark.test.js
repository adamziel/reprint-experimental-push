import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LARGE_POST_TABLE_BENCHMARK_ID,
  runLargePostTableBenchmark,
} from '../scripts/bench/large-post-table-benchmark.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('RPP-0714 large post table benchmark reports runtime, resources, and gates', () => {
  const report = runLargePostTableBenchmark({
    profile: 'unit',
    now: fixedNow,
    tableRows: 80,
    changedRows: 48,
    batchSizeRows: 12,
  });

  assert.equal(report.rppId, 'RPP-0714');
  assert.equal(report.benchmark, LARGE_POST_TABLE_BENCHMARK_ID);
  assert.equal(report.profile, 'unit');
  assert.equal(report.ok, true);
  assert.equal(report.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.ok(report.runtime.durationMs >= 0);
  assert.equal(report.runtime.budgets.profile, 'unit');

  assert.equal(report.resources.table.table, 'wp_posts');
  assert.equal(report.resources.table.totalRows, 80);
  assert.equal(report.resources.table.changedRows, 48);
  assert.equal(report.resources.table.mutationRows, 48);
  assert.equal(report.resources.batchSizing.batchSizeRows, 12);
  assert.equal(report.resources.batchSizing.batchCount, 4);
  assert.equal(report.resources.batchSizing.maxObservedBatchRows, 12);
  assert.equal(report.resources.batchSizing.allRowsCoveredOnce, true);
  assert.equal(report.resources.preconditions.expected, 48);
  assert.equal(report.resources.preconditions.recorded, 48);
  assert.equal(report.resources.preconditions.liveRemote, 48);
  assert.equal(report.resources.apply.appliedMutations, 48);
  assert.equal(report.resources.apply.changedRowsVerified, 48);
  assert.equal(report.resources.apply.verificationFailures, 0);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');

  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);
  assert.ok(report.gates.some((gate) => gate.id === 'wp-posts-live-preconditions'));
  assert.ok(report.gates.some((gate) => gate.id === 'bounded-primary-key-batches'));
  assert.ok(report.gates.some((gate) => gate.id === 'large-site-runtime-budget'));
  assert.equal(report.claims.productionThroughput, 'not-claimed');
});

test('RPP-0714 benchmark keeps bounded primary-key batch evidence hash-only', () => {
  const report = runLargePostTableBenchmark({
    profile: 'unit',
    now: fixedNow,
    tableRows: 24,
    changedRows: 17,
    batchSizeRows: 5,
  });

  assert.equal(report.deterministicCoverage.plan.status, 'ready');
  assert.equal(report.deterministicCoverage.plan.mutations, 17);
  assert.equal(report.deterministicCoverage.batchWindows.length, 4);
  assert.deepEqual(
    report.deterministicCoverage.batchWindows.map((batch) => batch.rowCount),
    [5, 5, 5, 2],
  );
  assert.deepEqual(
    report.deterministicCoverage.batchWindows.map((batch) => [batch.firstPostId, batch.lastPostId]),
    [
      [1, 5],
      [6, 10],
      [11, 15],
      [16, 17],
    ],
  );
  assert.equal(report.deterministicCoverage.batchCoverage.duplicatePostIds, 0);
  assert.equal(report.deterministicCoverage.batchCoverage.monotonicPrimaryKeyOrder, true);
  assert.equal(report.deterministicCoverage.redaction.rawValueEvidenceLeaks, 0);

  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /RPP0714 (?:base|local) post|RPP0714 post body|rpp-0714-post-/);
  for (const sample of report.deterministicCoverage.hashOnlySamples.changedRows) {
    assert.match(sample.resourceKeyHash, /^[a-f0-9]{64}$/);
    assert.match(sample.remoteBeforeHash, /^[a-f0-9]{64}$/);
    assert.match(sample.appliedHash, /^[a-f0-9]{64}$/);
    assert.match(sample.localHash, /^[a-f0-9]{64}$/);
  }
});

test('RPP-0714 large-site profile keeps documented budgets in the report', () => {
  const report = runLargePostTableBenchmark({
    profile: 'large-site',
    now: fixedNow,
    tableRows: 120,
    changedRows: 60,
    batchSizeRows: 15,
    maxDurationMs: 5_000,
    maxHeapUsedBytes: 128 * 1024 * 1024,
  });

  assert.equal(report.profile, 'large-site');
  assert.equal(report.runtime.budgets.profile, 'large-site');
  assert.equal(report.runtime.budgets.maxDurationMs, 5_000);
  assert.equal(report.runtime.budgets.maxHeapUsedBytes, 128 * 1024 * 1024);
  assert.equal(report.ok, true);
  assert.equal(report.resources.table.totalRows, 120);
  assert.equal(report.resources.batchSizing.batchCount, 4);
  assert.ok(report.gates.some((gate) => (
    gate.id === 'large-site-runtime-budget'
      && gate.status === 'pass'
      && gate.evidence.profile === 'large-site'
  )));
});

test('RPP-0714 CLI emits stable JSON with gates before production speed claims', () => {
  const stdout = execFileSync(process.execPath, [
    'scripts/bench/large-post-table-benchmark.js',
    '--profile=unit',
    '--table-rows=36',
    '--changed-rows=18',
    '--batch-size-rows=6',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const report = JSON.parse(stdout);
  const rootKeys = Object.keys(report);

  assert.equal(report.ok, true);
  assert.equal(report.resources.table.totalRows, 36);
  assert.equal(report.resources.batchSizing.batchCount, 3);
  assert.equal(report.resources.preconditions.everyMutationHasLivePrecondition, true);
  assert.ok(rootKeys.indexOf('runtime') < rootKeys.indexOf('resources'));
  assert.ok(rootKeys.indexOf('resources') < rootKeys.indexOf('gates'));
  assert.ok(rootKeys.indexOf('gates') < rootKeys.indexOf('claims'));
  assert.equal(report.claims.productionThroughput, 'not-claimed');
});
