import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REMOTE_HASH_CURSOR_FORMAT,
  REMOTE_HASH_MAX_BATCH_SIZE,
  REMOTE_HASH_PAGINATION_BENCHMARK_ID,
} from '../scripts/bench/remote-hash-pagination.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const benchmarkScript = fileURLToPath(new URL('../scripts/bench/remote-hash-pagination.js', import.meta.url));
const proofId = 'rpp-0791-remote-hash-pagination-release-verifier-v5';
const evidenceSource = 'remote-hash-pagination-release-verifier-v5';
const successResourceCount = 229;
const successBatchSize = 37;
const successMaxDurationMs = 5000;
const successMaxHeapUsedBytes = 256 * 1024 * 1024;
const failResourceCount = 47;
const failBatchSize = 11;
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
const expectedReleaseVerifierGateIds = Object.freeze([
  'release-verifier-command-reports-runtime-resources-gates',
  'built-on-remote-hash-pagination-v4',
  'complete-remote-hash-pagination-report-carried-through',
  'deterministic-remote-hash-page-coverage-carried-through',
  'cursor-binding-and-configuration-errors-carried-through',
  'runtime-resource-budget-pass-fail-carried-through',
  'hash-count-only-release-verifier-evidence',
  'support-only-release-no-go',
]);
const expectedErrorPathCodes = Object.freeze({
  invalidCursorFormat: 'INVALID_CURSOR_FORMAT',
  cursorSourceMismatch: 'INVALID_CURSOR_SOURCE',
  cursorScopeMismatch: 'INVALID_CURSOR_SCOPE',
  batchSizeTooSmall: 'INVALID_BATCH_SIZE',
  batchSizeTooLarge: 'INVALID_BATCH_SIZE',
  cursorOutsideComparisonSet: 'INVALID_CURSOR_OFFSET',
});
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

let recordedEvidence;

test('RPP-0791 release verifier v5 carries remote hash pagination benchmark runtime resources and gates', {
  concurrency: false,
}, () => {
  const proof = buildReleaseVerifierProof();

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, 'RPP-0791');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0771');
  assert.equal(proof.builtOn.proofId, 'rpp-0771-remote-hash-pagination-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceRppId, 'RPP-0711');
  assert.equal(proof.builtOn.benchmark, REMOTE_HASH_PAGINATION_BENCHMARK_ID);
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, hexSha256Pattern);

  assert.equal(proof.releaseVerifier.evidenceSource, evidenceSource);
  assert.equal(proof.releaseVerifier.command.reportsRuntime, true);
  assert.equal(proof.releaseVerifier.command.reportsResources, true);
  assert.equal(proof.releaseVerifier.command.reportsPassFailGates, true);
  assert.equal(proof.releaseVerifier.command.runtimeBeforeResourcesBeforeGates, true);
  assert.equal(proof.releaseVerifier.command.passFailStatusesOnly, true);
  assert.equal(proof.releaseVerifier.command.successExitStatus, 0);
  assert.equal(proof.releaseVerifier.command.failExitStatus, 1);
  assert.equal(proof.releaseVerifier.command.gateCount, requiredBenchmarkGateIds.length);
  assert.deepEqual(proof.releaseVerifier.command.passGateIds.sort(), [...requiredBenchmarkGateIds].sort());
  assert.deepEqual(proof.releaseVerifier.command.failGateIds, []);
  assert.deepEqual(proof.releaseVerifier.command.gateStatuses, ['pass']);
  assert.equal(proof.releaseVerifier.command.failingCommandReportsRuntime, true);
  assert.equal(proof.releaseVerifier.command.failingCommandReportsResources, true);
  assert.equal(proof.releaseVerifier.command.failingCommandReportsPassFailGates, true);
  assert.deepEqual(proof.releaseVerifier.command.failingCommandFailGateIds, ['runtime-resource-budget']);
  assert.match(proof.releaseVerifier.command.reportHash, hexSha256Pattern);
  assert.match(proof.releaseVerifier.command.failingReportHash, hexSha256Pattern);

  assert.equal(proof.releaseVerifier.carryThrough.status, 'claimed-support-only');
  assert.equal(proof.releaseVerifier.carryThrough.fromRpp, 'RPP-0771');
  assert.equal(proof.releaseVerifier.carryThrough.sourceProofId, 'rpp-0771-remote-hash-pagination-v4');
  assert.equal(proof.releaseVerifier.carryThrough.sourceVariant, 4);
  assert.equal(proof.releaseVerifier.carryThrough.benchmarkId, REMOTE_HASH_PAGINATION_BENCHMARK_ID);
  assert.equal(proof.releaseVerifier.carryThrough.commandReportsRuntimeResourcesGates, true);
  assert.equal(proof.releaseVerifier.carryThrough.failGateCoverage, true);
  assert.equal(proof.releaseVerifier.carryThrough.outputAfterCorrectnessGates, true);
  assert.match(proof.releaseVerifier.carryThrough.proofHash, sha256Pattern);

  assert.equal(proof.runtime.mode, 'deterministic-no-live-remote');
  assert.equal(Date.parse(proof.runtime.generatedAt) > 0, true);
  assert.equal(proof.runtime.durationMs <= successMaxDurationMs, true);
  assert.equal(proof.runtime.budgets.maxDurationMs, successMaxDurationMs);
  assert.equal(proof.runtime.budgets.maxHeapUsedBytes, successMaxHeapUsedBytes);
  assert.equal(proof.runtime.liveRemoteService.status, 'unavailable');
  assert.deepEqual(proof.runtime.liveRemoteService.unavailableCapabilities, ['live-wordpress-remote-service']);
  assert.match(proof.runtime.node, /^v\d+\.\d+\.\d+/);
  assert.equal(typeof proof.runtime.platform, 'string');

  assert.equal(proof.resources.remoteHashes.cursorFormat, REMOTE_HASH_CURSOR_FORMAT);
  assert.equal(proof.resources.remoteHashes.maxBatchSize, REMOTE_HASH_MAX_BATCH_SIZE);
  assert.equal(proof.resources.remoteHashes.requestedBatchSize, successBatchSize);
  assert.equal(proof.resources.remoteHashes.resourceCount, successResourceCount);
  assert.equal(proof.resources.remoteHashes.pageCount, 7);
  assert.equal(proof.resources.remoteHashes.complete, true);
  assert.equal(proof.resources.remoteHashes.duplicateResourceKeyCount, 0);
  assert.match(proof.resources.remoteHashes.sourceHash, hexSha256Pattern);
  assert.match(proof.resources.remoteHashes.scopeHash, hexSha256Pattern);
  assert.match(proof.resources.remoteHashes.snapshotHashSetHash, sha256Pattern);
  assert.equal(proof.resources.process.heapUsedBytes <= successMaxHeapUsedBytes, true);
  assertNonNegativeNumber(proof.resources.process.rssBytes);
  assertNonNegativeNumber(proof.resources.process.userCpuMs);
  assertNonNegativeNumber(proof.resources.process.systemCpuMs);

  assert.equal(proof.paginationCoverage.resourceCount, successResourceCount);
  assert.equal(proof.paginationCoverage.requestedBatchSize, successBatchSize);
  assert.equal(proof.paginationCoverage.pageCount, 7);
  assert.equal(proof.paginationCoverage.cursorCount, 6);
  assert.equal(proof.paginationCoverage.uniqueResourceCount, successResourceCount);
  assert.equal(proof.paginationCoverage.duplicateResourceKeyCount, 0);
  assert.equal(proof.paginationCoverage.completePageCount, 1);
  assert.equal(proof.paginationCoverage.emptyPageCount, 0);
  assert.equal(proof.paginationCoverage.planningOnlyPages, 7);
  assert.equal(proof.paginationCoverage.pageHashesStable, true);
  assert.equal(proof.paginationCoverage.repeatedPageCoverageStable, true);
  assert.equal(proof.paginationCoverage.rawValueEvidenceLeaks, 0);
  assert.deepEqual(proof.paginationCoverage.errorPathCodes, expectedErrorPathCodes);
  assert.match(proof.paginationCoverage.coverageHash, sha256Pattern);
  assert.match(proof.paginationCoverage.repeatedCoverageHash, sha256Pattern);

  assert.equal(proof.failGateCoverage.ok, false);
  assert.equal(proof.failGateCoverage.exitStatus, 1);
  assert.equal(proof.failGateCoverage.resourceCount, failResourceCount);
  assert.equal(proof.failGateCoverage.requestedBatchSize, failBatchSize);
  assert.equal(proof.failGateCoverage.pageCount, 5);
  assert.equal(proof.failGateCoverage.cursorCount, 4);
  assert.equal(proof.failGateCoverage.runtimeReported, true);
  assert.equal(proof.failGateCoverage.resourcesReported, true);
  assert.equal(proof.failGateCoverage.passFailGatesReported, true);
  assert.equal(proof.failGateCoverage.runtimeBeforeResourcesBeforeGates, true);
  assert.deepEqual(proof.failGateCoverage.failGateIds, ['runtime-resource-budget']);
  assert.deepEqual(proof.failGateCoverage.passGateIds.sort(), requiredBenchmarkGateIds
    .filter((id) => id !== 'runtime-resource-budget')
    .sort());
  assert.equal(proof.failGateCoverage.runtimeResourceBudgetGate.status, 'fail');
  assert.equal(proof.failGateCoverage.runtimeResourceBudgetGate.maxHeapUsedBytes, failMaxHeapUsedBytes);
  assert.equal(
    proof.failGateCoverage.runtimeResourceBudgetGate.heapUsedBytes > failMaxHeapUsedBytes,
    true,
  );

  assert.deepEqual(proof.correctness.gateIds, expectedReleaseVerifierGateIds);
  assert.deepEqual(
    proof.correctness.recomputedGateVector.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.hashCountOnlyOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.match(proof.outputHash, sha256Pattern);
  assert.deepEqual(proof.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass', 'pass']);

  assert.equal(proof.unsafe.missingCommandReport.updated, false);
  assert.ok(proof.unsafe.missingCommandReport.blockedBy
    .includes('release-verifier-command-reports-runtime-resources-gates'));
  assert.equal(proof.unsafe.missingFailGateReport.updated, false);
  assert.ok(proof.unsafe.missingFailGateReport.blockedBy
    .includes('runtime-resource-budget-pass-fail-carried-through'));
  assert.equal(proof.unsafe.incompletePaginationCoverage.updated, false);
  assert.ok(proof.unsafe.incompletePaginationCoverage.blockedBy
    .includes('complete-remote-hash-pagination-report-carried-through'));
  assert.equal(proof.unsafe.missingCursorErrorCoverage.updated, false);
  assert.ok(proof.unsafe.missingCursorErrorCoverage.blockedBy
    .includes('cursor-binding-and-configuration-errors-carried-through'));
  assert.equal(proof.unsafe.rawEvidenceLeak.updated, false);
  assert.ok(proof.unsafe.rawEvidenceLeak.blockedBy
    .includes('hash-count-only-release-verifier-evidence'));
  assert.equal(proof.unsafe.productionBackedClaim.updated, false);
  assert.ok(proof.unsafe.productionBackedClaim.blockedBy.includes('support-only-release-no-go'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.releaseEligible, false);
  assert.equal(proof.release.releaseVerifierCarryThrough, 'claimed-support-only');
  assert.equal(proof.release.productionStorageReceipts, 'not-claimed');
  assert.equal(proof.release.productionRowBatchExecution, 'not-claimed');
  assert.equal(proof.release.productionAtomicGroupCommit, 'not-claimed');
  assert.equal(proof.release.liveRemoteService, 'not-claimed');
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));
  assert.ok(proof.release.blockers.includes('live-remote-service-not-measured'));

  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.redaction.publicEvidenceHash, sha256Pattern);
  assert.match(proof.redaction.laneDecisionHash, hexSha256Pattern);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashCountOnlyReleaseVerifierEvidence(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0791 remote hash pagination release verifier proof' }));
});

test('RPP-0791 release verifier v5 fails closed for stale remote hash pagination carry-through evidence', {
  concurrency: false,
}, () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveRemoteHashReleaseVerifierCarryThrough(evidence);
  const unsafeDecisions = unsafeRemoteHashReleaseVerifierDecisions(evidence);

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(
    safeDecision.recomputedGates.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.updated, false);
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
    assertHashCountOnlyReleaseVerifierEvidence(decision);
  }
});

function buildReleaseVerifierProof() {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveRemoteHashReleaseVerifierCarryThrough(evidence);
  const unsafe = projectUnsafeDecisions(unsafeRemoteHashReleaseVerifierDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'releaseVerifier',
  ) && objectKeyBefore(evidence, 'correctnessGates', 'paginationCoverage');
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('benchmark-command-pass-fail-reporting-proved',
      evidence.releaseVerifier.command.reportsRuntime
        && evidence.releaseVerifier.command.reportsResources
        && evidence.releaseVerifier.command.reportsPassFailGates
        && evidence.failGateCoverage.runtimeReported
        && evidence.failGateCoverage.resourcesReported
        && evidence.failGateCoverage.passFailGatesReported, {
        passGateIds: evidence.releaseVerifier.command.passGateIds,
        failGateIds: evidence.failGateCoverage.failGateIds,
      }),
    proofGate('release-verifier-output-after-correctness-gates',
      safeDecision.updated && safeDecision.outputEmitted && correctnessGatesRecordedBeforeOutput, {
        outputEmitted: safeDecision.outputEmitted,
        correctnessGatesRecordedBeforeOutput,
        blockedBy: safeDecision.blockedBy,
      }),
    proofGate('unsafe-release-verifier-evidence-fails-closed',
      Object.values(unsafe).every((decision) => (
        decision.updated === false
          && decision.outputEmitted === false
          && decision.attemptedPassBlocked === true
      )), {
        blockedDecisionHashes: Object.values(unsafe).map((decision) => decision.decisionHash),
      }),
    proofGate('hash-count-only-release-verifier-proof',
      releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)), {
        rawValueEvidenceLeaks:
          releaseVerifierEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)) ? 0 : 1,
      }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.releaseEligible === false
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicProof = {
    schemaVersion: 1,
    rppId: 'RPP-0791',
    proofId,
    variant: 5,
    evidenceSource,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
    integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    runtime: evidence.runtime,
    resources: evidence.resources,
    paginationCoverage: evidence.paginationCoverage,
    failGateCoverage: evidence.failGateCoverage,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashCountOnlyOutput: safeDecision.hashCountOnlyOutput,
      outputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-count-only-remote-hash-pagination-release-verifier-v5',
      rawValueEvidenceLeaks: releaseVerifierEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: sha256(publicReleaseVerifierEvidenceProjection(evidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidence() {
  if (recordedEvidence) {
    return recordedEvidence;
  }

  const successArgs = [
    `--resource-count=${successResourceCount}`,
    `--batch-size=${successBatchSize}`,
    `--max-duration-ms=${successMaxDurationMs}`,
    `--max-heap-used-bytes=${successMaxHeapUsedBytes}`,
  ];
  const repeatedSuccessArgs = [...successArgs];
  const failArgs = [
    `--resource-count=${failResourceCount}`,
    `--batch-size=${failBatchSize}`,
    `--max-duration-ms=${failMaxDurationMs}`,
    `--max-heap-used-bytes=${failMaxHeapUsedBytes}`,
  ];
  const successResult = runBenchmarkCommand(successArgs);
  const repeatedSuccessResult = runBenchmarkCommand(repeatedSuccessArgs);
  const failResult = runBenchmarkCommand(failArgs);
  assert.equal(successResult.status, 0, successResult.stdout);
  assert.equal(repeatedSuccessResult.status, 0, repeatedSuccessResult.stdout);
  assert.equal(failResult.status, 1, failResult.stdout);

  const successReport = parseBenchmarkReport(successResult);
  const repeatedSuccessReport = parseBenchmarkReport(repeatedSuccessResult);
  const failReport = parseBenchmarkReport(failResult);
  assertBenchmarkReportShape(successReport, {
    resourceCount: successResourceCount,
    batchSize: successBatchSize,
    maxDurationMs: successMaxDurationMs,
    maxHeapUsedBytes: successMaxHeapUsedBytes,
  });
  assertBenchmarkReportShape(repeatedSuccessReport, {
    resourceCount: successResourceCount,
    batchSize: successBatchSize,
    maxDurationMs: successMaxDurationMs,
    maxHeapUsedBytes: successMaxHeapUsedBytes,
  });
  assertBenchmarkReportShape(failReport, {
    resourceCount: failResourceCount,
    batchSize: failBatchSize,
    maxDurationMs: failMaxDurationMs,
    maxHeapUsedBytes: failMaxHeapUsedBytes,
  });

  const evidence = buildRemoteHashReleaseVerifierEvidence({
    successReport,
    repeatedSuccessReport,
    failReport,
    successExitStatus: successResult.status,
    failExitStatus: failResult.status,
    successArgs,
    failArgs,
  });
  recordCorrectnessGates(evidence);

  recordedEvidence = {
    successReport,
    repeatedSuccessReport,
    failReport,
    evidence,
  };
  return recordedEvidence;
}

function buildRemoteHashReleaseVerifierEvidence({
  successReport,
  repeatedSuccessReport,
  failReport,
  successExitStatus,
  failExitStatus,
  successArgs,
  failArgs,
}) {
  const commandProjection = publicCommandReportProjection(successReport);
  const failingCommandProjection = publicCommandReportProjection(failReport);
  const paginationCoverage = paginationCoverageProjection(successReport, repeatedSuccessReport);
  const failGateCoverage = failGateCoverageProjection(failReport, failExitStatus);
  const release = supportOnlyReleasePosture();
  const evidence = {
    schemaVersion: 1,
    rppId: 'RPP-0791',
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0771',
      proofId: 'rpp-0771-remote-hash-pagination-v4',
      variant: 4,
      status: successReport.ok ? 'passed' : 'blocked',
      sourceRppId: 'RPP-0711',
      benchmark: successReport.benchmark,
      ok: successReport.ok,
      evidenceHash: digest(commandProjection),
    },
    correctnessGates: [],
    releaseVerifier: {
      evidenceSource,
      command: {
        successCommand: benchmarkCommandString(successArgs),
        failGateCommand: benchmarkCommandString(failArgs),
        reportsRuntime: hasRuntimeReport(successReport),
        reportsResources: hasResourceReport(successReport),
        reportsPassFailGates: hasPassFailGateReport(successReport),
        runtimeBeforeResourcesBeforeGates: objectKeyBefore(successReport, 'runtime', 'resources')
          && objectKeyBefore(successReport, 'resources', 'gates'),
        passFailStatusesOnly: successReport.gates.every((gate) => ['pass', 'fail'].includes(gate.status))
          && failReport.gates.every((gate) => ['pass', 'fail'].includes(gate.status)),
        gateCount: successReport.gates.length,
        gateStatuses: [...new Set(successReport.gates.map((gate) => gate.status))],
        passGateIds: successReport.gates
          .filter((gate) => gate.status === 'pass')
          .map((gate) => gate.id),
        failGateIds: successReport.gates
          .filter((gate) => gate.status === 'fail')
          .map((gate) => gate.id),
        successExitStatus,
        failExitStatus,
        failingCommandReportsRuntime: hasRuntimeReport(failReport),
        failingCommandReportsResources: hasResourceReport(failReport),
        failingCommandReportsPassFailGates: hasPassFailGateReport(failReport),
        failingCommandFailGateIds: failGateCoverage.failGateIds,
        reportHash: digest(commandProjection),
        failingReportHash: digest(failingCommandProjection),
      },
    },
    runtime: {
      generatedAt: successReport.runtime.generatedAt,
      mode: successReport.mode,
      durationMs: successReport.runtime.durationMs,
      node: successReport.runtime.node,
      platform: successReport.runtime.platform,
      budgets: successReport.runtime.budgets,
      liveRemoteService: {
        status: successReport.runtime.liveRemoteService.status,
        unavailableCapabilities: successReport.runtime.liveRemoteService.unavailableCapabilities,
      },
    },
    resources: {
      remoteHashes: {
        cursorFormat: successReport.resources.remoteHashes.cursorFormat,
        maxBatchSize: successReport.resources.remoteHashes.maxBatchSize,
        requestedBatchSize: successReport.resources.remoteHashes.requestedBatchSize,
        resourceCount: successReport.resources.remoteHashes.resourceCount,
        pageCount: successReport.resources.remoteHashes.pageCount,
        complete: successReport.resources.remoteHashes.complete,
        duplicateResourceKeyCount: successReport.resources.remoteHashes.duplicateResourceKeys.length,
        sourceHash: successReport.resources.remoteHashes.sourceHash,
        scopeHash: successReport.resources.remoteHashes.scopeHash,
        snapshotHashSetHash: successReport.resources.remoteHashes.snapshotHashSetHash,
      },
      process: successReport.resources.process,
    },
    paginationCoverage,
    failGateCoverage,
    release,
  };

  evidence.releaseVerifier.carryThrough = releaseVerifierCarryThroughProjection(evidence);
  return evidence;
}

function releaseVerifierCarryThroughProjection(evidence) {
  const command = evidence.releaseVerifier.command;
  const failGateCoverage = evidence.failGateCoverage;
  const commandReportsRuntimeResourcesGates = command.reportsRuntime === true
    && command.reportsResources === true
    && command.reportsPassFailGates === true
    && command.runtimeBeforeResourcesBeforeGates === true;
  const failGateCoverageComplete = failGateCoverage.runtimeReported === true
    && failGateCoverage.resourcesReported === true
    && failGateCoverage.passFailGatesReported === true
    && sameArray(failGateCoverage.failGateIds, ['runtime-resource-budget']);
  const carryThrough = {
    status: 'claimed-support-only',
    fromRpp: 'RPP-0771',
    sourceProofId: 'rpp-0771-remote-hash-pagination-v4',
    sourceVariant: 4,
    benchmarkId: evidence.builtOn.benchmark,
    commandReportsRuntimeResourcesGates,
    failGateCoverage: failGateCoverageComplete,
    outputAfterCorrectnessGates: true,
    releaseStatus: evidence.release.finalReleaseStatus,
    integrationRecommendation: evidence.release.integrationRecommendation,
  };

  return {
    ...carryThrough,
    proofHash: sha256(carryThrough),
  };
}

function paginationCoverageProjection(report, repeatedReport) {
  const repeatedPageCoverageStable = digest(paginationDeterminismProjection(report))
    === digest(paginationDeterminismProjection(repeatedReport));
  const coverage = {
    sourceRppId: 'RPP-0771',
    sourceBenchmarkRppId: 'RPP-0711',
    benchmarkId: report.benchmark,
    mode: report.mode,
    resourceCount: report.resources.remoteHashes.resourceCount,
    requestedBatchSize: report.resources.remoteHashes.requestedBatchSize,
    maxBatchSize: report.resources.remoteHashes.maxBatchSize,
    pageCount: report.deterministicCoverage.pageCount,
    cursorCount: report.deterministicCoverage.cursorCount,
    uniqueResourceCount: report.deterministicCoverage.uniqueResourceCount,
    duplicateResourceKeyCount: report.deterministicCoverage.duplicateResourceKeys.length,
    completePageCount: report.deterministicCoverage.completePageCount,
    emptyPageCount: report.deterministicCoverage.emptyPageCount,
    planningOnlyPages: report.deterministicCoverage.planningOnlyPages,
    pageHashesStable: report.deterministicCoverage.pageHashesStable,
    repeatedPageCoverageStable,
    rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
    sourceHash: report.resources.remoteHashes.sourceHash,
    scopeHash: report.resources.remoteHashes.scopeHash,
    snapshotHashSetHash: report.resources.remoteHashes.snapshotHashSetHash,
    errorPathCodes: Object.fromEntries(
      Object.entries(report.deterministicCoverage.errorPaths)
        .map(([name, value]) => [name, value.code]),
    ),
  };

  return {
    ...coverage,
    coverageHash: sha256(coverage),
    repeatedCoverageHash: sha256(paginationDeterminismProjection(repeatedReport)),
  };
}

function failGateCoverageProjection(report, exitStatus) {
  const runtimeResourceBudgetGate = gateById(report, 'runtime-resource-budget');
  const projection = {
    ok: report.ok,
    exitStatus,
    mode: report.mode,
    resourceCount: report.resources.remoteHashes.resourceCount,
    requestedBatchSize: report.resources.remoteHashes.requestedBatchSize,
    pageCount: report.deterministicCoverage.pageCount,
    cursorCount: report.deterministicCoverage.cursorCount,
    runtimeReported: hasRuntimeReport(report),
    resourcesReported: hasResourceReport(report),
    passFailGatesReported: hasPassFailGateReport(report),
    runtimeBeforeResourcesBeforeGates: objectKeyBefore(report, 'runtime', 'resources')
      && objectKeyBefore(report, 'resources', 'gates'),
    passGateIds: report.gates
      .filter((gate) => gate.status === 'pass')
      .map((gate) => gate.id),
    failGateIds: report.gates
      .filter((gate) => gate.status === 'fail')
      .map((gate) => gate.id),
    runtimeResourceBudgetGate: {
      status: runtimeResourceBudgetGate.status,
      durationMs: runtimeResourceBudgetGate.evidence.durationMs,
      heapUsedBytes: runtimeResourceBudgetGate.evidence.heapUsedBytes,
      maxDurationMs: runtimeResourceBudgetGate.evidence.maxDurationMs,
      maxHeapUsedBytes: runtimeResourceBudgetGate.evidence.maxHeapUsedBytes,
    },
    rawValueEvidenceLeaks: report.deterministicCoverage.rawValueEvidenceLeaks,
  };

  return {
    ...projection,
    coverageHash: sha256(projection),
  };
}

function recordCorrectnessGates(evidence) {
  const gates = recomputeRemoteHashReleaseVerifierGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveRemoteHashReleaseVerifierCarryThrough(evidence) {
  const recomputedGates = recomputeRemoteHashReleaseVerifierGates(evidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedReleaseVerifierGateIds);
  const recordedGateStatusesHold = recordedGateIdsComplete
    && evidence.correctnessGates.every((gate) => gate.status === 'passed');
  const blockedBy = unique([
    ...failedGateIds,
    ...(!recordedGateIdsComplete ? ['correctness-gates-not-recorded'] : []),
    ...(!recordedGateStatusesHold ? ['correctness-gates-not-passed'] : []),
  ]);
  const correctnessGatesHold = blockedBy.length === 0;
  const output = correctnessGatesHold
    ? {
        proofId,
        evidenceSource,
        gateVectorHash: sha256(recomputedGates),
        commandReportHash: evidence.releaseVerifier.command.reportHash,
        failingCommandReportHash: evidence.releaseVerifier.command.failingReportHash,
        paginationCoverageHash: evidence.paginationCoverage.coverageHash,
        failGateCoverageHash: evidence.failGateCoverage.coverageHash,
        pageCount: evidence.paginationCoverage.pageCount,
        cursorCount: evidence.paginationCoverage.cursorCount,
        resourceCount: evidence.paginationCoverage.resourceCount,
        commandPassGateCount: evidence.releaseVerifier.command.passGateIds.length,
        commandFailGateIds: evidence.failGateCoverage.failGateIds,
        supportOnly: evidence.release.supportOnly,
        productionBacked: evidence.release.productionBacked,
        releaseStatus: evidence.release.finalReleaseStatus,
        integrationRecommendation: evidence.release.integrationRecommendation,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: evidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    hashCountOnlyOutput: output ? releaseVerifierEvidenceHasNoRawValues(output) : false,
    blockedBy,
    recomputedGates,
    outputHash: output ? sha256(output) : null,
  };

  return {
    ...publicDecision,
    output,
    decisionHash: digest(publicDecision),
  };
}

function recomputeRemoteHashReleaseVerifierGates(evidence) {
  const releaseVerifier = evidence.releaseVerifier || {};
  const command = releaseVerifier.command || {};
  const carryThrough = releaseVerifier.carryThrough || {};
  const resources = evidence.resources || {};
  const remoteHashes = resources.remoteHashes || {};
  const processResources = resources.process || {};
  const runtime = evidence.runtime || {};
  const paginationCoverage = evidence.paginationCoverage || {};
  const failGateCoverage = evidence.failGateCoverage || {};
  const release = evidence.release || {};
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const commandReportsRuntimeResourcesGates = command.reportsRuntime === true
    && command.reportsResources === true
    && command.reportsPassFailGates === true
    && command.runtimeBeforeResourcesBeforeGates === true
    && command.passFailStatusesOnly === true
    && command.gateCount === requiredBenchmarkGateIds.length
    && command.successExitStatus === 0
    && command.failExitStatus === 1
    && sameArray(command.passGateIds || [], requiredBenchmarkGateIds)
    && sameArray(command.failGateIds || [], [])
    && sameArray(command.gateStatuses || [], ['pass'])
    && isSha256Hash(command.reportHash)
    && isSha256Hash(command.failingReportHash);
  const builtOnV4 = evidence.builtOn?.rppId === 'RPP-0771'
    && evidence.builtOn?.proofId === 'rpp-0771-remote-hash-pagination-v4'
    && evidence.builtOn?.variant === 4
    && evidence.builtOn?.status === 'passed'
    && evidence.builtOn?.sourceRppId === 'RPP-0711'
    && evidence.builtOn?.benchmark === REMOTE_HASH_PAGINATION_BENCHMARK_ID
    && evidence.builtOn?.ok === true
    && isSha256Hash(evidence.builtOn?.evidenceHash);
  const completeRemoteHashReport = runtime.mode === 'deterministic-no-live-remote'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && runtime.liveRemoteService?.status === 'unavailable'
    && sameArray(runtime.liveRemoteService?.unavailableCapabilities || [], ['live-wordpress-remote-service'])
    && remoteHashes.cursorFormat === REMOTE_HASH_CURSOR_FORMAT
    && remoteHashes.maxBatchSize === REMOTE_HASH_MAX_BATCH_SIZE
    && remoteHashes.requestedBatchSize === paginationCoverage.requestedBatchSize
    && remoteHashes.resourceCount === paginationCoverage.resourceCount
    && remoteHashes.pageCount === paginationCoverage.pageCount
    && remoteHashes.complete === true
    && remoteHashes.duplicateResourceKeyCount === 0
    && isSha256Hash(remoteHashes.sourceHash)
    && isSha256Hash(remoteHashes.scopeHash)
    && sha256Pattern.test(remoteHashes.snapshotHashSetHash || '');
  const deterministicPageCoverage = paginationCoverage.sourceRppId === 'RPP-0771'
    && paginationCoverage.sourceBenchmarkRppId === 'RPP-0711'
    && paginationCoverage.benchmarkId === REMOTE_HASH_PAGINATION_BENCHMARK_ID
    && paginationCoverage.mode === 'deterministic-no-live-remote'
    && paginationCoverage.resourceCount === successResourceCount
    && paginationCoverage.requestedBatchSize === successBatchSize
    && paginationCoverage.pageCount === Math.ceil(successResourceCount / successBatchSize)
    && paginationCoverage.cursorCount === paginationCoverage.pageCount - 1
    && paginationCoverage.uniqueResourceCount === paginationCoverage.resourceCount
    && paginationCoverage.duplicateResourceKeyCount === 0
    && paginationCoverage.completePageCount === 1
    && paginationCoverage.emptyPageCount === 0
    && paginationCoverage.planningOnlyPages === paginationCoverage.pageCount
    && paginationCoverage.pageHashesStable === true
    && paginationCoverage.repeatedPageCoverageStable === true
    && paginationCoverage.rawValueEvidenceLeaks === 0
    && sha256Pattern.test(paginationCoverage.coverageHash || '')
    && sha256Pattern.test(paginationCoverage.repeatedCoverageHash || '');
  const cursorAndConfigErrors = Object.entries(expectedErrorPathCodes)
    .every(([name, code]) => paginationCoverage.errorPathCodes?.[name] === code);
  const runtimeBudgetPassFailCarried = failGateCoverage.ok === false
    && failGateCoverage.exitStatus === 1
    && failGateCoverage.runtimeReported === true
    && failGateCoverage.resourcesReported === true
    && failGateCoverage.passFailGatesReported === true
    && failGateCoverage.runtimeBeforeResourcesBeforeGates === true
    && failGateCoverage.resourceCount === failResourceCount
    && failGateCoverage.requestedBatchSize === failBatchSize
    && failGateCoverage.pageCount === Math.ceil(failResourceCount / failBatchSize)
    && failGateCoverage.cursorCount === failGateCoverage.pageCount - 1
    && sameArray(failGateCoverage.failGateIds || [], ['runtime-resource-budget'])
    && sameArray(
      failGateCoverage.passGateIds || [],
      requiredBenchmarkGateIds.filter((gateId) => gateId !== 'runtime-resource-budget'),
    )
    && failGateCoverage.runtimeResourceBudgetGate?.status === 'fail'
    && failGateCoverage.runtimeResourceBudgetGate?.maxHeapUsedBytes === failMaxHeapUsedBytes
    && failGateCoverage.runtimeResourceBudgetGate?.heapUsedBytes > failMaxHeapUsedBytes
    && isSha256PrefixedHash(failGateCoverage.coverageHash);
  const releaseVerifierCarryThroughClaimed = releaseVerifier.evidenceSource === evidenceSource
    && carryThrough.status === 'claimed-support-only'
    && carryThrough.fromRpp === 'RPP-0771'
    && carryThrough.sourceProofId === 'rpp-0771-remote-hash-pagination-v4'
    && carryThrough.sourceVariant === 4
    && carryThrough.benchmarkId === REMOTE_HASH_PAGINATION_BENCHMARK_ID
    && carryThrough.commandReportsRuntimeResourcesGates === true
    && carryThrough.failGateCoverage === true
    && carryThrough.outputAfterCorrectnessGates === true
    && carryThrough.releaseStatus === release.finalReleaseStatus
    && carryThrough.integrationRecommendation === release.integrationRecommendation
    && isSha256PrefixedHash(carryThrough.proofHash);
  const evidenceIsHashOnly = releaseVerifierEvidenceHasNoRawValues({
    builtOn: evidence.builtOn,
    releaseVerifier,
    runtime,
    resources,
    paginationCoverage,
    failGateCoverage,
    release,
  });

  return [
    proofGate('release-verifier-command-reports-runtime-resources-gates',
      commandReportsRuntimeResourcesGates && releaseVerifierCarryThroughClaimed, {
        reportsRuntime: command.reportsRuntime,
        reportsResources: command.reportsResources,
        reportsPassFailGates: command.reportsPassFailGates,
        gateCount: command.gateCount,
        successExitStatus: command.successExitStatus,
        failExitStatus: command.failExitStatus,
      }),
    proofGate('built-on-remote-hash-pagination-v4', builtOnV4, {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      sourceRppId: evidence.builtOn?.sourceRppId,
      benchmark: evidence.builtOn?.benchmark,
    }),
    proofGate('complete-remote-hash-pagination-report-carried-through',
      completeRemoteHashReport, {
        resourceCount: remoteHashes.resourceCount,
        pageCount: remoteHashes.pageCount,
        requestedBatchSize: remoteHashes.requestedBatchSize,
        duplicateResourceKeyCount: remoteHashes.duplicateResourceKeyCount,
      }),
    proofGate('deterministic-remote-hash-page-coverage-carried-through',
      deterministicPageCoverage, {
        resourceCount: paginationCoverage.resourceCount,
        pageCount: paginationCoverage.pageCount,
        cursorCount: paginationCoverage.cursorCount,
        repeatedPageCoverageStable: paginationCoverage.repeatedPageCoverageStable,
      }),
    proofGate('cursor-binding-and-configuration-errors-carried-through',
      cursorAndConfigErrors, {
        errorPathCodes: paginationCoverage.errorPathCodes,
      }),
    proofGate('runtime-resource-budget-pass-fail-carried-through',
      runtimeBudgetPassFailCarried, {
        failGateIds: failGateCoverage.failGateIds,
        passGateIds: failGateCoverage.passGateIds,
        runtimeResourceBudgetGate: failGateCoverage.runtimeResourceBudgetGate,
      }),
    proofGate('hash-count-only-release-verifier-evidence', evidenceIsHashOnly, {
      rawValueEvidenceLeaks: evidenceIsHashOnly ? 0 : 1,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.releaseEligible === false
      && release.releaseVerifierCarryThrough === 'claimed-support-only'
      && release.productionStorageReceipts === 'not-claimed'
      && release.productionRowBatchExecution === 'not-claimed'
      && release.productionAtomicGroupCommit === 'not-claimed'
      && release.liveRemoteService === 'not-claimed'
      && release.productionThroughput === 'not-claimed'
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO'
      && releaseBlockers.includes('production-storage-receipts-not-measured')
      && releaseBlockers.includes('production-row-batch-executor-not-measured')
      && releaseBlockers.includes('production-atomic-group-commit-not-measured')
      && releaseBlockers.includes('live-remote-service-not-measured'), {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      releaseEligible: release.releaseEligible,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function unsafeRemoteHashReleaseVerifierDecisions(evidence) {
  const missingCommandReport = withPassedStatus(clone(evidence));
  missingCommandReport.releaseVerifier.command.reportsRuntime = false;
  missingCommandReport.releaseVerifier.carryThrough.commandReportsRuntimeResourcesGates = false;

  const missingFailGateReport = withPassedStatus(clone(evidence));
  missingFailGateReport.failGateCoverage.passFailGatesReported = false;
  missingFailGateReport.failGateCoverage.failGateIds = [];
  missingFailGateReport.releaseVerifier.command.failingCommandReportsPassFailGates = false;
  missingFailGateReport.releaseVerifier.command.failingCommandFailGateIds = [];
  missingFailGateReport.releaseVerifier.carryThrough.failGateCoverage = false;

  const incompletePaginationCoverage = withPassedStatus(clone(evidence));
  incompletePaginationCoverage.paginationCoverage.uniqueResourceCount -= 1;
  incompletePaginationCoverage.resources.remoteHashes.complete = false;

  const missingCursorErrorCoverage = withPassedStatus(clone(evidence));
  missingCursorErrorCoverage.paginationCoverage.errorPathCodes.cursorSourceMismatch = 'NO_ERROR_THROWN';

  const rawEvidenceLeak = withPassedStatus(clone(evidence));
  rawEvidenceLeak.paginationCoverage.rawFixtureSample = 'file:wp-content/uploads/rpp-0711/00/asset-00001.bin';

  const productionBackedClaim = withPassedStatus(clone(evidence));
  productionBackedClaim.release.productionBacked = true;
  productionBackedClaim.release.releaseEligible = true;
  productionBackedClaim.release.finalReleaseStatus = 'GO';
  productionBackedClaim.release.integrationRecommendation = 'GO';

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingCommandReport: resolveRemoteHashReleaseVerifierCarryThrough(missingCommandReport),
    missingFailGateReport: resolveRemoteHashReleaseVerifierCarryThrough(missingFailGateReport),
    incompletePaginationCoverage:
      resolveRemoteHashReleaseVerifierCarryThrough(incompletePaginationCoverage),
    missingCursorErrorCoverage:
      resolveRemoteHashReleaseVerifierCarryThrough(missingCursorErrorCoverage),
    rawEvidenceLeak: resolveRemoteHashReleaseVerifierCarryThrough(rawEvidenceLeak),
    productionBackedClaim: resolveRemoteHashReleaseVerifierCarryThrough(productionBackedClaim),
    prematurePassStatus: resolveRemoteHashReleaseVerifierCarryThrough(prematurePassStatus),
  };
}

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
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(report.deterministicCoverage.errorPaths)
        .map(([name, value]) => [name, value.code]),
    ),
    expectedErrorPathCodes,
  );
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

function paginationDeterminismProjection(report) {
  return {
    benchmark: report.benchmark,
    ok: report.ok,
    mode: report.mode,
    remoteHashes: {
      requestedBatchSize: report.resources.remoteHashes.requestedBatchSize,
      resourceCount: report.resources.remoteHashes.resourceCount,
      pageCount: report.resources.remoteHashes.pageCount,
      complete: report.resources.remoteHashes.complete,
      duplicateResourceKeyCount: report.resources.remoteHashes.duplicateResourceKeys.length,
      sourceHash: report.resources.remoteHashes.sourceHash,
      scopeHash: report.resources.remoteHashes.scopeHash,
      snapshotHashSetHash: report.resources.remoteHashes.snapshotHashSetHash,
    },
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

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    releaseVerifierCarryThrough: 'claimed-support-only',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecution: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    liveRemoteService: 'not-claimed',
    productionThroughput: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'live-remote-service-not-measured',
    ],
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

function publicReleaseVerifierEvidenceProjection(evidence) {
  return {
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    runtime: evidence.runtime,
    resources: evidence.resources,
    paginationCoverage: evidence.paginationCoverage,
    failGateCoverage: evidence.failGateCoverage,
    release: evidence.release,
  };
}

function projectUnsafeDecisions(decisions) {
  return Object.fromEntries(
    Object.entries(decisions).map(([name, decision]) => [name, {
      updated: decision.updated,
      outputEmitted: decision.outputEmitted,
      attemptedPassBlocked: decision.attemptedPassBlocked,
      blockedBy: decision.blockedBy,
      decisionHash: decision.decisionHash,
    }]),
  );
}

function proofGate(id, ok, metrics = {}) {
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

function benchmarkCommandString(args) {
  return ['node', 'scripts/bench/remote-hash-pagination.js', ...args].join(' ');
}

function objectKeyBefore(object, leftKey, rightKey) {
  const keys = Object.keys(object);
  return keys.indexOf(leftKey) !== -1
    && keys.indexOf(rightKey) !== -1
    && keys.indexOf(leftKey) < keys.indexOf(rightKey);
}

function assertHashCountOnlyReleaseVerifierEvidence(value) {
  assert.equal(releaseVerifierEvidenceHasNoRawValues(value), true);
}

function releaseVerifierEvidenceHasNoRawValues(value) {
  const lower = JSON.stringify(value).toLowerCase();
  return ![
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

function withPassedStatus(value) {
  value.status = 'passed';
  if (Array.isArray(value.correctnessGates)) {
    value.correctnessGates = expectedReleaseVerifierGateIds.map((id) => ({
      id,
      status: 'passed',
      evidenceHash: digest({ forced: 'unsafe-pass', id }),
    }));
  }
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameArray(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function isSha256Hash(value) {
  return typeof value === 'string' && hexSha256Pattern.test(value);
}

function isSha256PrefixedHash(value) {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function assertNonNegativeNumber(value) {
  assertFiniteNumber(value);
  assert.ok(value >= 0);
}

function assertFiniteNumber(value) {
  assert.equal(typeof value, 'number');
  assert.ok(Number.isFinite(value));
}
