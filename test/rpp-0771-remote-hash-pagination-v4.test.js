import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REMOTE_HASH_CURSOR_FORMAT,
  REMOTE_HASH_MAX_BATCH_SIZE,
  REMOTE_HASH_PAGINATION_BENCHMARK_ID,
} from '../scripts/bench/remote-hash-pagination.js';
import { digest } from '../src/stable-json.js';

const benchmarkScript = fileURLToPath(new URL('../scripts/bench/remote-hash-pagination.js', import.meta.url));
const proofId = 'rpp-0771-remote-hash-pagination-v4';
const successResourceCount = 197;
const successBatchSize = 23;
const successMaxDurationMs = 5000;
const successMaxHeapUsedBytes = 256 * 1024 * 1024;
const failResourceCount = 43;
const failBatchSize = 9;
const failMaxDurationMs = 5000;
const failMaxHeapUsedBytes = 1;
const requiredBenchmarkGateIds = Object.freeze([
  'complete-resource-set',
  'cursor-binds-source-and-scope',
  'configuration-bounds-enforced',
  'page-hashes-deterministic',
  'planning-only-not-write-authority',
  'hash-only-page-evidence',
  'runtime-resource-budget',
]);
const supportProofGateIds = Object.freeze([
  'benchmark-command-reports-runtime-resources-gates',
  'complete-remote-hash-pagination-report',
  'deterministic-remote-hash-page-coverage',
  'hash-only-remote-hash-page-evidence',
  'support-only-release-no-go',
]);
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

test('RPP-0771 variant 4 benchmark command reports runtime, resources, and pass/fail gates', () => {
  const result = runBenchmarkCommand([
    `--resource-count=${successResourceCount}`,
    `--batch-size=${successBatchSize}`,
    `--max-duration-ms=${successMaxDurationMs}`,
    `--max-heap-used-bytes=${successMaxHeapUsedBytes}`,
  ]);

  assert.equal(result.status, 0, result.stdout);
  const report = parseBenchmarkReport(result);

  assertBenchmarkReportShape(report, {
    resourceCount: successResourceCount,
    batchSize: successBatchSize,
    maxDurationMs: successMaxDurationMs,
    maxHeapUsedBytes: successMaxHeapUsedBytes,
  });
  assert.equal(report.ok, true);
  assert.deepEqual([...new Set(report.gates.map((gate) => gate.status))], ['pass']);

  const proof = buildSupportOnlyRemoteHashPaginationProof(report, {
    resourceCount: successResourceCount,
    batchSize: successBatchSize,
  });
  assert.equal(proof.rppId, 'RPP-0771');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0751');
  assert.equal(proof.builtOn.sourceRppId, 'RPP-0711');
  assert.equal(proof.builtOn.benchmark, REMOTE_HASH_PAGINATION_BENCHMARK_ID);
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, hexSha256Pattern);

  assert.equal(proof.command.reportsRuntime, true);
  assert.equal(proof.command.reportsResources, true);
  assert.equal(proof.command.reportsPassFailGates, true);
  assert.equal(proof.command.runtimeBeforeResourcesBeforeGates, true);
  assert.equal(proof.command.passFailStatusesOnly, true);
  assert.equal(proof.command.gateCount, requiredBenchmarkGateIds.length);
  assert.deepEqual(proof.command.gateStatuses, ['pass']);
  assert.match(proof.command.reportHash, hexSha256Pattern);

  assert.equal(proof.storagePerformance.runtimeReported, true);
  assert.equal(proof.storagePerformance.resourcesReported, true);
  assert.equal(proof.storagePerformance.passFailGatesReported, true);
  assert.equal(proof.storagePerformance.resourceCount, successResourceCount);
  assert.equal(proof.storagePerformance.requestedBatchSize, successBatchSize);
  assert.equal(proof.storagePerformance.pageCount, 9);
  assert.equal(proof.storagePerformance.cursorCount, 8);
  assert.equal(proof.storagePerformance.uniqueResourceCount, successResourceCount);
  assert.equal(proof.storagePerformance.duplicateResourceKeyCount, 0);
  assert.equal(proof.storagePerformance.completePageCount, 1);
  assert.equal(proof.storagePerformance.rawValueEvidenceLeaks, 0);
  assert.equal(proof.storagePerformance.productionStorageReceipts, 'not-claimed');
  assert.equal(proof.storagePerformance.productionRowBatchExecution, 'not-claimed');
  assert.equal(proof.storagePerformance.productionAtomicGroupCommit, 'not-claimed');
  assert.equal(proof.storagePerformance.liveTopology, 'not-claimed');
  assert.equal(proof.storagePerformance.credentialMaterial, 'not-claimed');
  assert.equal(proof.storagePerformance.finalReleaseReadiness, 'not-claimed');
  assert.match(proof.storagePerformance.snapshotHashSetHash, sha256Pattern);
  assert.match(proof.storagePerformance.sourceHash, hexSha256Pattern);
  assert.match(proof.storagePerformance.scopeHash, hexSha256Pattern);
  assert.match(proof.storagePerformance.storagePerformanceHash, hexSha256Pattern);

  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');
  assert.deepEqual(proof.gates.map((gate) => gate.id), supportProofGateIds);
  assert.deepEqual([...new Set(proof.gates.map((gate) => gate.status))], ['pass']);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertNoRawOrPrivateEvidence(report);
  assertNoRawOrPrivateEvidence(proof);
});

test('RPP-0771 variant 4 benchmark command exposes fail gates with runtime and resources', () => {
  const result = runBenchmarkCommand([
    `--resource-count=${failResourceCount}`,
    `--batch-size=${failBatchSize}`,
    `--max-duration-ms=${failMaxDurationMs}`,
    `--max-heap-used-bytes=${failMaxHeapUsedBytes}`,
  ]);

  assert.equal(result.status, 1, result.stdout);
  const report = parseBenchmarkReport(result);

  assertBenchmarkReportShape(report, {
    resourceCount: failResourceCount,
    batchSize: failBatchSize,
    maxDurationMs: failMaxDurationMs,
    maxHeapUsedBytes: failMaxHeapUsedBytes,
  });
  assert.equal(report.ok, false);
  assert.equal(report.mode, 'deterministic-no-live-remote');
  assert.equal(hasRuntimeReport(report), true);
  assert.equal(hasResourceReport(report), true);
  assert.equal(hasPassFailGateReport(report), true);
  assert.equal(objectKeyBefore(report, 'runtime', 'resources'), true);
  assert.equal(objectKeyBefore(report, 'resources', 'gates'), true);

  const runtimeBudgetGate = gateById(report, 'runtime-resource-budget');
  assert.equal(runtimeBudgetGate.status, 'fail');
  assert.equal(runtimeBudgetGate.evidence.maxHeapUsedBytes, failMaxHeapUsedBytes);
  assert.ok(runtimeBudgetGate.evidence.heapUsedBytes > failMaxHeapUsedBytes);
  assertNonNegativeNumber(runtimeBudgetGate.evidence.durationMs);

  for (const id of requiredBenchmarkGateIds.filter((gateId) => gateId !== 'runtime-resource-budget')) {
    assert.equal(gateById(report, id).status, 'pass', `${id} gate should remain pass`);
  }
  assertNoRawOrPrivateEvidence(report);
});

function runBenchmarkCommand(args) {
  const result = spawnSync(process.execPath, [benchmarkScript, ...args], {
    encoding: 'utf8',
    env: sanitizedBenchmarkEnv(),
    timeout: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '');
  return result;
}

function sanitizedBenchmarkEnv() {
  const env = {
    LC_ALL: 'C',
    LANG: 'C',
  };
  if (process.env.PATH) {
    env.PATH = process.env.PATH;
  }
  return env;
}

function parseBenchmarkReport(result) {
  assert.ok(result.stdout.trim().length > 0, 'benchmark command did not emit JSON');
  return JSON.parse(result.stdout);
}

function assertBenchmarkReportShape(report, options) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0711');
  assert.equal(report.benchmark, REMOTE_HASH_PAGINATION_BENCHMARK_ID);
  assert.equal(report.mode, 'deterministic-no-live-remote');
  assert.equal(Date.parse(report.runtime.generatedAt) > 0, true);
  assertNonNegativeNumber(report.runtime.durationMs);
  assert.match(report.runtime.node, /^v\d+\.\d+\.\d+/);
  assert.equal(typeof report.runtime.platform, 'string');
  assert.equal(report.runtime.budgets.maxDurationMs, options.maxDurationMs);
  assert.equal(report.runtime.budgets.maxHeapUsedBytes, options.maxHeapUsedBytes);
  assert.equal(report.runtime.liveRemoteService.status, 'unavailable');
  assert.deepEqual(report.runtime.liveRemoteService.unavailableCapabilities, ['live-wordpress-remote-service']);

  assert.equal(report.resources.remoteHashes.cursorFormat, REMOTE_HASH_CURSOR_FORMAT);
  assert.equal(report.resources.remoteHashes.maxBatchSize, REMOTE_HASH_MAX_BATCH_SIZE);
  assert.equal(report.resources.remoteHashes.requestedBatchSize, options.batchSize);
  assert.equal(report.resources.remoteHashes.resourceCount, options.resourceCount);
  assert.equal(report.resources.remoteHashes.pageCount, Math.ceil(options.resourceCount / options.batchSize));
  assert.equal(report.resources.remoteHashes.complete, true);
  assert.deepEqual(report.resources.remoteHashes.duplicateResourceKeys, []);
  assert.match(report.resources.remoteHashes.sourceHash, hexSha256Pattern);
  assert.match(report.resources.remoteHashes.scopeHash, hexSha256Pattern);
  assert.match(report.resources.remoteHashes.snapshotHashSetHash, sha256Pattern);

  assert.equal(report.resources.process.heapUsedBytes > 0, true);
  assertNonNegativeNumber(report.resources.process.rssBytes);
  assertNonNegativeNumber(report.resources.process.userCpuMs);
  assertNonNegativeNumber(report.resources.process.systemCpuMs);

  assert.deepEqual(report.gates.map((gate) => gate.id).sort(), [...requiredBenchmarkGateIds].sort());
  assert.equal(report.gates.every((gate) => ['pass', 'fail'].includes(gate.status)), true);
  assert.equal(report.gates.every((gate) => typeof gate.evidence === 'object'), true);

  assert.equal(report.deterministicCoverage.pageCount, Math.ceil(options.resourceCount / options.batchSize));
  assert.equal(report.deterministicCoverage.resourceCount, options.resourceCount);
  assert.equal(report.deterministicCoverage.uniqueResourceCount, options.resourceCount);
  assert.deepEqual(report.deterministicCoverage.duplicateResourceKeys, []);
  assert.equal(report.deterministicCoverage.emptyPageCount, 0);
  assert.equal(report.deterministicCoverage.completePageCount, 1);
  assert.equal(report.deterministicCoverage.cursorCount, report.deterministicCoverage.pageCount - 1);
  assert.equal(report.deterministicCoverage.pageHashesStable, true);
  assert.equal(report.deterministicCoverage.planningOnlyPages, report.deterministicCoverage.pageCount);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.equal(report.deterministicCoverage.errorPaths.invalidCursorFormat.code, 'INVALID_CURSOR_FORMAT');
  assert.equal(report.deterministicCoverage.errorPaths.cursorSourceMismatch.code, 'INVALID_CURSOR_SOURCE');
  assert.equal(report.deterministicCoverage.errorPaths.cursorScopeMismatch.code, 'INVALID_CURSOR_SCOPE');
  assert.equal(report.deterministicCoverage.errorPaths.batchSizeTooSmall.code, 'INVALID_BATCH_SIZE');
  assert.equal(report.deterministicCoverage.errorPaths.batchSizeTooLarge.code, 'INVALID_BATCH_SIZE');
  assert.equal(report.deterministicCoverage.errorPaths.cursorOutsideComparisonSet.code, 'INVALID_CURSOR_OFFSET');
}

function buildSupportOnlyRemoteHashPaginationProof(report, options) {
  const commandReportProjection = publicCommandReportProjection(report);
  const storageCountsMatch = report.resources.remoteHashes.resourceCount === options.resourceCount
    && report.resources.remoteHashes.requestedBatchSize === options.batchSize
    && report.resources.remoteHashes.pageCount === Math.ceil(options.resourceCount / options.batchSize)
    && report.resources.remoteHashes.complete === true
    && report.resources.remoteHashes.duplicateResourceKeys.length === 0
    && report.deterministicCoverage.uniqueResourceCount === options.resourceCount
    && report.deterministicCoverage.completePageCount === 1
    && report.deterministicCoverage.cursorCount === report.resources.remoteHashes.pageCount - 1;
  const proof = {
    rppId: 'RPP-0771',
    proofId,
    variant: 4,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0751',
      sourceRppId: 'RPP-0711',
      benchmark: report.benchmark,
      ok: report.ok,
      evidenceHash: digest(commandReportProjection),
    },
    command: {
      reportsRuntime: hasRuntimeReport(report),
      reportsResources: hasResourceReport(report),
      reportsPassFailGates: hasPassFailGateReport(report),
      runtimeBeforeResourcesBeforeGates: objectKeyBefore(report, 'runtime', 'resources')
        && objectKeyBefore(report, 'resources', 'gates'),
      passFailStatusesOnly: report.gates.every((gate) => ['pass', 'fail'].includes(gate.status)),
      gateCount: report.gates.length,
      gateStatuses: [...new Set(report.gates.map((gate) => gate.status))],
      reportHash: digest(commandReportProjection),
    },
    storagePerformance: {
      mode: 'hash-and-count-only-remote-hash-pagination-storage-performance',
      benchmarkId: report.benchmark,
      runtimeReported: hasRuntimeReport(report),
      resourcesReported: hasResourceReport(report),
      passFailGatesReported: hasPassFailGateReport(report),
      resourceCount: report.resources.remoteHashes.resourceCount,
      requestedBatchSize: report.resources.remoteHashes.requestedBatchSize,
      maxBatchSize: report.resources.remoteHashes.maxBatchSize,
      pageCount: report.resources.remoteHashes.pageCount,
      cursorCount: report.deterministicCoverage.cursorCount,
      uniqueResourceCount: report.deterministicCoverage.uniqueResourceCount,
      duplicateResourceKeyCount: report.resources.remoteHashes.duplicateResourceKeys.length,
      completePageCount: report.deterministicCoverage.completePageCount,
      rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
      sourceHash: report.resources.remoteHashes.sourceHash,
      scopeHash: report.resources.remoteHashes.scopeHash,
      snapshotHashSetHash: report.resources.remoteHashes.snapshotHashSetHash,
      durationMs: report.runtime.durationMs,
      heapUsedBytes: report.resources.process.heapUsedBytes,
      maxDurationMs: report.runtime.budgets.maxDurationMs,
      maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
      productionStorageReceipts: 'not-claimed',
      productionRowBatchExecution: 'not-claimed',
      productionAtomicGroupCommit: 'not-claimed',
      liveTopology: 'not-claimed',
      credentialMaterial: 'not-claimed',
      finalReleaseReadiness: 'not-claimed',
      storagePerformanceHash: digest(commandReportProjection),
    },
    supportOnly: true,
    productionBacked: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    gates: [],
  };

  proof.gates = [
    localGate('benchmark-command-reports-runtime-resources-gates',
      proof.command.reportsRuntime
        && proof.command.reportsResources
        && proof.command.reportsPassFailGates
        && proof.command.runtimeBeforeResourcesBeforeGates,
      {
        runtimeReported: proof.command.reportsRuntime,
        resourcesReported: proof.command.reportsResources,
        gateCount: proof.command.gateCount,
      }),
    localGate('complete-remote-hash-pagination-report',
      storageCountsMatch,
      {
        resourceCount: proof.storagePerformance.resourceCount,
        pageCount: proof.storagePerformance.pageCount,
        cursorCount: proof.storagePerformance.cursorCount,
      }),
    localGate('deterministic-remote-hash-page-coverage',
      report.ok
        && gateById(report, 'complete-resource-set').status === 'pass'
        && gateById(report, 'cursor-binds-source-and-scope').status === 'pass'
        && gateById(report, 'configuration-bounds-enforced').status === 'pass'
        && gateById(report, 'page-hashes-deterministic').status === 'pass'
        && gateById(report, 'planning-only-not-write-authority').status === 'pass',
      {
        uniqueResourceCount: report.deterministicCoverage.uniqueResourceCount,
        pageHashesStable: report.deterministicCoverage.pageHashesStable,
      }),
    localGate('hash-only-remote-hash-page-evidence',
      gateById(report, 'hash-only-page-evidence').status === 'pass'
        && report.deterministicCoverage.rawValueEvidenceLeaks === 0
        && !containsRawOrPrivateEvidence(report),
      {
        rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
        publicReportHash: proof.command.reportHash,
      }),
    localGate('support-only-release-no-go',
      proof.supportOnly
        && proof.productionBacked === false
        && proof.finalReleaseStatus === 'NO-GO'
        && proof.integrationRecommendation === 'NO-GO'
        && proof.storagePerformance.productionStorageReceipts === 'not-claimed'
        && proof.storagePerformance.productionRowBatchExecution === 'not-claimed'
        && proof.storagePerformance.productionAtomicGroupCommit === 'not-claimed'
        && proof.storagePerformance.liveTopology === 'not-claimed'
        && proof.storagePerformance.credentialMaterial === 'not-claimed'
        && proof.storagePerformance.finalReleaseReadiness === 'not-claimed',
      {
        productionBacked: proof.productionBacked,
        finalReleaseStatus: proof.finalReleaseStatus,
        integrationRecommendation: proof.integrationRecommendation,
      }),
  ];
  proof.status = proof.gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return {
    ...proof,
    evidenceHash: digest(proof),
  };
}

function publicCommandReportProjection(report) {
  return {
    benchmark: report.benchmark,
    ok: report.ok,
    mode: report.mode,
    runtime: {
      durationMs: report.runtime.durationMs,
      budgets: report.runtime.budgets,
      liveRemoteService: report.runtime.liveRemoteService.status,
    },
    resources: {
      remoteHashes: {
        cursorFormat: report.resources.remoteHashes.cursorFormat,
        maxBatchSize: report.resources.remoteHashes.maxBatchSize,
        requestedBatchSize: report.resources.remoteHashes.requestedBatchSize,
        resourceCount: report.resources.remoteHashes.resourceCount,
        pageCount: report.resources.remoteHashes.pageCount,
        complete: report.resources.remoteHashes.complete,
        duplicateResourceKeyCount: report.resources.remoteHashes.duplicateResourceKeys.length,
        sourceHash: report.resources.remoteHashes.sourceHash,
        scopeHash: report.resources.remoteHashes.scopeHash,
        snapshotHashSetHash: report.resources.remoteHashes.snapshotHashSetHash,
      },
      process: report.resources.process,
    },
    gates: report.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
      evidenceHash: digest(gate.evidence),
    })),
    deterministicCoverage: {
      pageCount: report.deterministicCoverage.pageCount,
      resourceCount: report.deterministicCoverage.resourceCount,
      uniqueResourceCount: report.deterministicCoverage.uniqueResourceCount,
      duplicateResourceKeyCount: report.deterministicCoverage.duplicateResourceKeys.length,
      emptyPageCount: report.deterministicCoverage.emptyPageCount,
      completePageCount: report.deterministicCoverage.completePageCount,
      cursorCount: report.deterministicCoverage.cursorCount,
      pageHashesStable: report.deterministicCoverage.pageHashesStable,
      planningOnlyPages: report.deterministicCoverage.planningOnlyPages,
      rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
      errorPathCodes: Object.fromEntries(
        Object.entries(report.deterministicCoverage.errorPaths)
          .map(([name, value]) => [name, value.code]),
      ),
    },
  };
}

function hasRuntimeReport(report) {
  return report.runtime
    && typeof report.runtime.generatedAt === 'string'
    && typeof report.runtime.durationMs === 'number'
    && report.runtime.budgets
    && typeof report.runtime.budgets.maxDurationMs === 'number'
    && typeof report.runtime.budgets.maxHeapUsedBytes === 'number'
    && report.runtime.liveRemoteService
    && typeof report.runtime.liveRemoteService.status === 'string';
}

function hasResourceReport(report) {
  return report.resources
    && report.resources.remoteHashes
    && report.resources.process
    && typeof report.resources.remoteHashes.resourceCount === 'number'
    && typeof report.resources.remoteHashes.pageCount === 'number'
    && typeof report.resources.process.heapUsedBytes === 'number'
    && typeof report.resources.process.rssBytes === 'number'
    && typeof report.resources.process.userCpuMs === 'number'
    && typeof report.resources.process.systemCpuMs === 'number';
}

function hasPassFailGateReport(report) {
  return Array.isArray(report.gates)
    && report.gates.length === requiredBenchmarkGateIds.length
    && report.gates.every((gate) => requiredBenchmarkGateIds.includes(gate.id)
      && ['pass', 'fail'].includes(gate.status)
      && Object.hasOwn(gate, 'evidence'));
}

function localGate(id, ok, metrics = {}) {
  return {
    id,
    status: ok ? 'pass' : 'fail',
    metrics,
  };
}

function gateById(report, id) {
  const gate = report.gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `missing ${id} gate`);
  return gate;
}

function objectKeyBefore(object, leftKey, rightKey) {
  const keys = Object.keys(object);
  return keys.indexOf(leftKey) !== -1
    && keys.indexOf(rightKey) !== -1
    && keys.indexOf(leftKey) < keys.indexOf(rightKey);
}

function assertNoRawOrPrivateEvidence(value) {
  assert.equal(containsRawOrPrivateEvidence(value), false);
}

function containsRawOrPrivateEvidence(value) {
  const lower = JSON.stringify(value).toLowerCase();
  return [
    'resource_key',
    'wp-content',
    'wp_posts',
    'wp_postmeta',
    'wp_options',
    'pagination-secret',
    'private row value',
    'forms-',
    'asset-',
    'id:',
    'sourceurlhash',
    'restnamespace',
    'routeprofile',
    'bearer ',
    'basic ',
    'cookie=',
    'password',
    'token=',
    'http://',
    'https://',
  ].some((token) => lower.includes(token));
}

function assertNonNegativeNumber(value) {
  assertFiniteNumber(value);
  assert.ok(value >= 0);
}

function assertFiniteNumber(value) {
  assert.equal(typeof value, 'number');
  assert.ok(Number.isFinite(value));
}
