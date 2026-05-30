import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LONG_PUSH_PROGRESS_BENCHMARK_ID,
  LONG_PUSH_PROGRESS_POLICY_ID,
  runLongPushProgressReportingBenchmark,
} from '../scripts/bench/rpp-0719-long-push-progress-reporting.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const GIB = 1024 * 1024 * 1024;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

function runReport(overrides = {}) {
  return runLongPushProgressReportingBenchmark({
    profile: 'unit',
    now: fixedNow,
    ...overrides,
  });
}

test('RPP-0719 progress report emits bounded redacted monotonic long-push updates', () => {
  const report = runReport();
  const events = report.progress.events;
  const finalEvent = events.at(-1);

  assert.equal(report.rppId, 'RPP-0719');
  assert.equal(report.benchmark, LONG_PUSH_PROGRESS_BENCHMARK_ID);
  assert.equal(report.ok, true);
  assert.equal(report.progress.policy.policyId, LONG_PUSH_PROGRESS_POLICY_ID);
  assert.equal(report.progress.policy.completionRule, '100-percent-only-after-final-durable-commit-evidence');
  assert.equal(events[0].kind, 'push-start');
  assert.equal(events[0].percentComplete, 0);
  assert.equal(finalEvent.kind, 'push-complete');
  assert.equal(finalEvent.percentComplete, 100);
  assert.equal(finalEvent.completedActions, report.progress.totals.totalActions);

  for (const phase of report.progress.policy.requiredPhaseCoverage) {
    assert.ok(report.progress.phasesCovered.includes(phase), `missing progress phase ${phase}`);
  }

  assert.ok(report.progress.eventCount >= report.progress.budgets.minOperatorEvents);
  assert.ok(
    report.progress.observedGaps.maxActionsBetweenReports
      <= report.progress.budgets.maxActionsBetweenReports,
  );
  assert.ok(
    report.progress.observedGaps.maxUploadBytesBetweenReports
      <= report.progress.budgets.maxUploadBytesBetweenReports,
  );

  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    assert.ok(current.completedActions >= previous.completedActions);
    assert.ok(current.percentComplete >= previous.percentComplete);
    assert.ok(current.counters.uploadBytesAcked >= previous.counters.uploadBytesAcked);
    assert.ok(current.counters.dbRowsCommitted >= previous.counters.dbRowsCommitted);
  }

  const completedEvents = events.filter((event) => event.kind === 'progress' || event.kind === 'push-complete');
  assert.ok(completedEvents.every((event) => event.durableCursor.evidenceSource));
  assert.ok(completedEvents.every((event) => sha256Pattern.test(event.durableCursor.actionRefHash)));

  const chunkEvents = completedEvents.filter((event) => event.durableCursor.actionType === 'chunk-upload');
  assert.ok(chunkEvents.length > 0, 'expected chunk-upload progress events');
  assert.ok(chunkEvents.every((event) => sha256Pattern.test(event.durableCursor.receiptRefHash)));
  assert.ok(chunkEvents.every((event) => sha256Pattern.test(event.durableCursor.resumeCursorHash)));
  assert.ok(chunkEvents.every((event) => sha256Pattern.test(event.durableCursor.idempotencyKeyHash)));

  assert.doesNotMatch(
    JSON.stringify(events),
    /wp-content|wp_posts|wp_postmeta|catalog-export|commerce-stack|payments\.php|commerce\.php|row-payload/i,
  );
  assert.ok(events.every((event) => event.redaction.rawValuesIncluded === false));
  assert.ok(events.every((event) => event.redaction.payloadBytesIncluded === false));
});

test('RPP-0719 large-site profile finishes inside documented runtime and heap budgets', () => {
  const report = runReport({ profile: 'large-site' });
  const runtimeGate = report.gates.find((gate) => gate.id === 'large-site-runtime-budget');

  assert.equal(report.ok, true);
  assert.equal(report.profile, 'large-site');
  assert.equal(report.runtime.budgets.profile, 'large-site');
  assert.ok(report.runtime.durationMs <= report.runtime.budgets.maxDurationMs);
  assert.ok(report.resources.heapUsedBytes <= report.runtime.budgets.maxHeapUsedBytes);
  assert.ok(report.workload.largeSiteShape.uploadBytes >= GIB);
  assert.ok(report.workload.largeSiteShape.dbRows >= 10_000);
  assert.equal(runtimeGate.status, 'pass');
  assert.equal(runtimeGate.evidence.profile, 'large-site');
  assert.equal(runtimeGate.evidence.maxDurationMs, 5_000);
  assert.equal(runtimeGate.evidence.maxHeapUsedBytes, 256 * 1024 * 1024);
});

test('RPP-0719 CLI prints runtime resources progress and pass/fail gates', () => {
  const stdout = execFileSync(process.execPath, [
    'scripts/bench/rpp-0719-long-push-progress-reporting.js',
    '--profile=unit',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const report = JSON.parse(stdout);
  const rootKeys = Object.keys(report);

  assert.equal(report.ok, true);
  assert.equal(report.benchmark, LONG_PUSH_PROGRESS_BENCHMARK_ID);
  assert.ok(rootKeys.indexOf('runtime') < rootKeys.indexOf('resources'));
  assert.ok(rootKeys.indexOf('resources') < rootKeys.indexOf('workload'));
  assert.ok(rootKeys.indexOf('workload') < rootKeys.indexOf('progress'));
  assert.ok(rootKeys.indexOf('progress') < rootKeys.indexOf('gates'));
  assert.equal(typeof report.runtime.durationMs, 'number');
  assert.equal(typeof report.resources.heapUsedBytes, 'number');
  assert.ok(report.progress.eventCount >= report.progress.budgets.minOperatorEvents);
  assert.ok(report.gates.every((gate) => gate.status === 'pass'));
});
