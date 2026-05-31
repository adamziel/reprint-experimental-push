import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  LARGE_PLUGIN_FILE_BENCHMARK_ID,
  LARGE_PLUGIN_FILE_BOUNDARY,
  LARGE_PLUGIN_FILE_GROUP_ID,
  runLargePluginFileBenchmark,
} from '../scripts/bench/large-plugin-file-benchmark.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { FILESYSTEM_FSYNC_BOUNDARY } from '../src/filesystem-fsync-evidence.js';
import { digest } from '../src/stable-json.js';

const benchmarkScript = fileURLToPath(new URL('../scripts/bench/large-plugin-file-benchmark.js', import.meta.url));
const rppId = 'RPP-0796';
const proofId = 'rpp-0796-large-plugin-file-benchmark-release-verifier-v5';
const evidenceSource = 'large-plugin-file-benchmark-release-verifier-v5';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const chunkSizeBytes = 32 * 1024;
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const impossibleHeapUsedBytes = 1;
const expectedCommandGateCount = 10;
const expectedBenchmarkGateIds = Object.freeze([
  'deterministic-plugin-file-workload',
  'chunk-receipts-cover-large-plugin-files',
  'plugin-files-invisible-before-group-commit',
  'group-finalize-rechecks-live-preconditions',
  'atomic-group-commit-publishes-all-plugin-files',
  'filesystem-fsync-gates-before-fast-path-lane',
  'backpressure-budgets-bound-in-flight-plugin-bytes',
  'temp-cleanup',
  'hash-only-evidence',
  'runtime-resource-budget',
]);
const expectedReleaseVerifierGateIds = Object.freeze([
  'release-verifier-benchmark-command-reports-runtime-resources-gates',
  'release-verifier-benchmark-command-pass-fail-statuses-only',
  'runtime-resource-budget-reported-and-passing',
  'built-on-large-plugin-file-benchmark-v4',
  'workload-resource-counts-carried-through',
  'storage-receipts-atomic-group-carried-through',
  'deterministic-hash-count-only-release-verifier-evidence',
  'support-only-release-no-go',
]);
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
let recordedEvidencePair;

test('RPP-0796 release verifier v5 carries large plugin benchmark runtime resources and gates', {
  concurrency: false,
}, () => {
  const proof = buildReleaseVerifierProof();

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.rppId, rppId);
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.supportOnly, true);
  assert.equal(proof.productionBacked, false);
  assert.equal(proof.releaseEligible, false);
  assert.equal(proof.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.integrationRecommendation, 'NO-GO');

  assert.equal(proof.builtOn.rppId, 'RPP-0776');
  assert.equal(proof.builtOn.proofId, 'rpp-0776-large-plugin-file-benchmark-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceLargePluginFileBenchmark.rppId, 'RPP-0716');
  assert.equal(proof.builtOn.sourceLargePluginFileBenchmark.benchmark, LARGE_PLUGIN_FILE_BENCHMARK_ID);
  assert.equal(proof.builtOn.sourceLargePluginFileBenchmark.variant, 1);
  assert.equal(proof.builtOn.sourceLargePluginFileBenchmark.ok, true);
  assert.equal(proof.builtOn.previousVariant.rppId, 'RPP-0756');
  assert.equal(proof.builtOn.previousVariant.variant, 3);
  assert.match(proof.builtOn.evidenceHash, hexSha256Pattern);

  assert.equal(proof.releaseVerifier.command, 'node scripts/bench/large-plugin-file-benchmark.js');
  assert.equal(proof.releaseVerifier.benchmarkId, LARGE_PLUGIN_FILE_BENCHMARK_ID);
  assert.equal(proof.releaseVerifier.runtimeReported, true);
  assert.equal(proof.releaseVerifier.resourcesReported, true);
  assert.equal(proof.releaseVerifier.passFailGatesReported, true);
  assert.equal(proof.releaseVerifier.runtimeBeforeResourcesBeforeGates, true);
  assert.equal(proof.releaseVerifier.runtimeBudgetReported, true);
  assert.equal(proof.releaseVerifier.passFailStatusesOnly, true);
  assert.equal(proof.releaseVerifier.gateCount, expectedCommandGateCount);
  assert.deepEqual(proof.releaseVerifier.summary, { pass: expectedCommandGateCount, fail: 0 });
  assert.deepEqual([...proof.releaseVerifier.passGateIds].sort(), [...expectedBenchmarkGateIds].sort());
  assert.deepEqual(proof.releaseVerifier.failGateIds, []);
  assert.equal(proof.releaseVerifier.runtimeResourceGateStatus, 'pass');
  assert.equal(proof.releaseVerifier.productionGateEvidence, 'not-present');
  assert.equal(proof.releaseVerifier.carryThrough, 'support-only-local-release-verifier');
  assert.match(proof.releaseVerifier.commandReportHash, hexSha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'unit');
  assert.equal(proof.runtime.durationReported, true);
  assert.equal(proof.runtime.durationWithinBudget, true);
  assert.equal(proof.runtime.budgetStatus, 'passed');
  assert.equal(proof.runtime.budgets.maxDurationMs, maxDurationMs);
  assert.equal(proof.runtime.budgets.maxHeapUsedBytes, maxHeapUsedBytes);
  assert.equal(proof.runtime.budgets.maxBufferedUploadBytes, 128 * 1024);
  assert.equal(proof.runtime.budgets.maxUploadConcurrency, 2);
  assert.match(proof.runtime.budgetHash, sha256Pattern);

  assert.equal(proof.resources.workload.pluginFiles, 4);
  assert.equal(proof.resources.workload.totalPluginFileBytes, 229_376);
  assert.equal(proof.resources.workload.largestPluginFileBytes, 131_072);
  assert.equal(proof.resources.workload.chunkSizeBytes, chunkSizeBytes);
  assert.equal(proof.resources.workload.expectedChunks, 8);
  assert.equal(proof.resources.workload.expectedGuardedWrites, 8);
  assert.equal(proof.resources.storage.boundaryHash, digest(LARGE_PLUGIN_FILE_BOUNDARY));
  assert.equal(proof.resources.storage.adapterHash, digest(FILESYSTEM_FSYNC_BOUNDARY));
  assert.equal(proof.resources.storage.atomicGroupIdHash, digest(LARGE_PLUGIN_FILE_GROUP_ID));
  assert.equal(proof.resources.storage.guardedWritesAttempted, 8);
  assert.equal(proof.resources.storage.stagedWrites, 4);
  assert.equal(proof.resources.storage.committedWrites, 4);
  assert.equal(proof.resources.storage.appliedFsyncCompleteWrites, 8);
  assert.equal(proof.resources.storage.groupFinalizeRecords, 1);
  assert.equal(proof.resources.storage.atomicGroupCommits, 1);
  assert.equal(proof.resources.storage.unsafeLiveVisibleBeforeCommit, 0);
  assert.equal(proof.resources.chunks.receipts, 8);
  assert.equal(proof.resources.chunks.expectedReceipts, 8);
  assert.equal(proof.resources.chunks.bytesReceipted, 229_376);
  assert.equal(proof.resources.chunks.exactPlanScopedReceipts, 8);
  assert.equal(proof.resources.chunks.duplicateReceiptKeys, 0);
  assert.equal(proof.resources.chunks.receiptOnlyResumeSkips, 8);
  assert.equal(proof.resources.chunks.maxInFlightWithinBufferedBudget, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.fastPathLane.updates, 8);
  assert.equal(proof.resources.fastPathLane.unsafeUpdatesBeforeGates, 0);
  assert.equal(proof.resources.fastPathLane.updatesWithFailedGate, 0);
  assert.equal(proof.resources.bytes.liveVisibleBeforeCommitBytes, 0);
  assert.equal(proof.resources.bytes.liveVisibleAfterCommitBytes, 229_376);
  assert.equal(proof.resources.atomicGroup.finalized, true);
  assert.equal(proof.resources.atomicGroup.committed, true);
  assert.equal(proof.resources.atomicGroup.allFilesVisibleAfterCommit, true);
  assert.equal(proof.resources.tempLeaks, 0);

  assert.equal(proof.storagePerformance.productionStorageDurability, 'not-claimed');
  assert.match(proof.storagePerformance.storagePerformanceHash, sha256Pattern);
  assert.equal(proof.storagePerformance.fileHashCount, 4);
  assert.equal(proof.storagePerformance.storageEvidenceSampleCount, 8);
  assert.equal(proof.storagePerformance.chunkReceiptSampleCount, 8);

  assert.equal(proof.deterministicEvidence.match, true);
  assert.equal(proof.deterministicEvidence.profile, 'unit');
  assert.equal(proof.deterministicEvidence.fileHashCount, 4);
  assert.equal(proof.deterministicEvidence.storageEvidenceSampleCount, 8);
  assert.equal(proof.deterministicEvidence.chunkReceiptSampleCount, 8);
  assert.equal(proof.deterministicEvidence.rawValueEvidenceLeaks, 0);
  assert.equal(proof.deterministicEvidence.tempLeaks, 0);
  assert.match(proof.deterministicEvidence.firstProjectionHash, sha256Pattern);
  assert.match(proof.deterministicEvidence.repeatedProjectionHash, sha256Pattern);
  assert.equal(proof.deterministicEvidence.firstProjectionHash, proof.deterministicEvidence.repeatedProjectionHash);
  assert.match(proof.deterministicEvidence.publicEvidenceHash, sha256Pattern);

  assert.deepEqual(proof.correctness.gateIds, expectedReleaseVerifierGateIds);
  assert.deepEqual(
    proof.correctness.recomputedGateVector.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.equal(proof.correctness.hashCountOnlyOutput, true);
  assert.match(proof.outputHash, sha256Pattern);
  assert.deepEqual(proof.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass']);

  assert.equal(proof.unsafe.missingRuntimeReport.updated, false);
  assert.ok(proof.unsafe.missingRuntimeReport.blockedBy
    .includes('release-verifier-benchmark-command-reports-runtime-resources-gates'));
  assert.equal(proof.unsafe.missingResourcesReport.updated, false);
  assert.ok(proof.unsafe.missingResourcesReport.blockedBy
    .includes('release-verifier-benchmark-command-reports-runtime-resources-gates'));
  assert.equal(proof.unsafe.missingPassFailGates.updated, false);
  assert.ok(proof.unsafe.missingPassFailGates.blockedBy
    .includes('release-verifier-benchmark-command-reports-runtime-resources-gates'));
  assert.equal(proof.unsafe.nonPassFailGateStatus.updated, false);
  assert.ok(proof.unsafe.nonPassFailGateStatus.blockedBy
    .includes('release-verifier-benchmark-command-pass-fail-statuses-only'));
  assert.equal(proof.unsafe.failedRuntimeResourceGate.updated, false);
  assert.ok(proof.unsafe.failedRuntimeResourceGate.blockedBy
    .includes('runtime-resource-budget-reported-and-passing'));
  assert.equal(proof.unsafe.staleBuiltOnVariant.updated, false);
  assert.ok(proof.unsafe.staleBuiltOnVariant.blockedBy.includes('built-on-large-plugin-file-benchmark-v4'));
  assert.equal(proof.unsafe.rawValueLeak.updated, false);
  assert.ok(proof.unsafe.rawValueLeak.blockedBy
    .includes('deterministic-hash-count-only-release-verifier-evidence'));
  assert.equal(proof.unsafe.productionGoClaim.updated, false);
  assert.ok(proof.unsafe.productionGoClaim.blockedBy.includes('support-only-release-no-go'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.releaseEligible, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.releaseVerifierCarryThrough, 'support-only-local-release-verifier');
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));

  assert.equal(proof.redaction.mode, 'hash-count-only-large-plugin-file-release-verifier-v5');
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.redaction.publicEvidenceHash, hexSha256Pattern);
  assert.match(proof.redaction.laneDecisionHash, hexSha256Pattern);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashCountOnlyLargePluginEvidence(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0796 large plugin file release verifier proof' }));
});

test('RPP-0796 release verifier v5 blocks incomplete large plugin carry-through evidence', {
  concurrency: false,
}, () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeReleaseVerifierDecisions(evidence, repeatedEvidence);

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(
    safeDecision.recomputedGates.map((gate) => gate.status),
    Array(expectedReleaseVerifierGateIds.length).fill('pass'),
  );

  assert.equal(unsafeDecisions.missingRuntimeReport.updated, false);
  assert.ok(unsafeDecisions.missingRuntimeReport.blockedBy
    .includes('release-verifier-benchmark-command-reports-runtime-resources-gates'));
  assert.equal(unsafeDecisions.missingResourcesReport.updated, false);
  assert.ok(unsafeDecisions.missingResourcesReport.blockedBy
    .includes('release-verifier-benchmark-command-reports-runtime-resources-gates'));
  assert.equal(unsafeDecisions.missingPassFailGates.updated, false);
  assert.ok(unsafeDecisions.missingPassFailGates.blockedBy
    .includes('release-verifier-benchmark-command-reports-runtime-resources-gates'));
  assert.equal(unsafeDecisions.nonPassFailGateStatus.updated, false);
  assert.ok(unsafeDecisions.nonPassFailGateStatus.blockedBy
    .includes('release-verifier-benchmark-command-pass-fail-statuses-only'));
  assert.equal(unsafeDecisions.failedRuntimeResourceGate.updated, false);
  assert.ok(unsafeDecisions.failedRuntimeResourceGate.blockedBy
    .includes('runtime-resource-budget-reported-and-passing'));
  assert.equal(unsafeDecisions.staleBuiltOnVariant.updated, false);
  assert.ok(unsafeDecisions.staleBuiltOnVariant.blockedBy.includes('built-on-large-plugin-file-benchmark-v4'));
  assert.equal(unsafeDecisions.rawValueLeak.updated, false);
  assert.ok(unsafeDecisions.rawValueLeak.blockedBy
    .includes('deterministic-hash-count-only-release-verifier-evidence'));
  assert.equal(unsafeDecisions.productionGoClaim.updated, false);
  assert.ok(unsafeDecisions.productionGoClaim.blockedBy.includes('support-only-release-no-go'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
    assertHashCountOnlyLargePluginEvidence(decision);
  }
});

test('RPP-0796 benchmark command exposes fail gates with runtime and resources', {
  concurrency: false,
}, () => {
  const { status, report } = runBenchmarkCommandResult({
    maxHeapUsedBytes: impossibleHeapUsedBytes,
  });

  assert.ok([0, 1].includes(status));
  assertBenchmarkCommandReportShape(report, {
    maxHeapUsedBytes: impossibleHeapUsedBytes,
  });
  assert.equal(report.ok, false);
  assert.equal(hasRuntimeReport(report), true);
  assert.equal(hasResourceReport(report), true);
  assert.equal(hasPassFailGateReport(report), true);

  const runtimeBudgetGate = gateById(report, 'runtime-resource-budget');
  assert.equal(runtimeBudgetGate.status, 'fail');
  assert.equal(runtimeBudgetGate.evidence.maxHeapUsedBytes, impossibleHeapUsedBytes);
  assert.equal(runtimeBudgetGate.evidence.heapUsedBytes > impossibleHeapUsedBytes, true);
  assertNonNegativeNumber(runtimeBudgetGate.evidence.durationMs);

  for (const id of expectedBenchmarkGateIds.filter((gateId) => gateId !== 'runtime-resource-budget')) {
    assert.equal(gateById(report, id).status, 'pass', `${id} gate should remain pass`);
  }

  const failGateProof = buildFailGateReleaseVerifierProof(report);
  assert.equal(failGateProof.rppId, rppId);
  assert.equal(failGateProof.proofId, proofId);
  assert.equal(failGateProof.variant, 5);
  assert.equal(failGateProof.evidenceSource, evidenceSource);
  assert.deepEqual(failGateProof.releaseVerifier.failGateIds, ['runtime-resource-budget']);
  assert.equal(failGateProof.releaseVerifier.runtimeReported, true);
  assert.equal(failGateProof.releaseVerifier.resourcesReported, true);
  assert.equal(failGateProof.releaseVerifier.passFailGatesReported, true);
  assert.equal(failGateProof.releaseVerifier.passFailStatusesOnly, true);
  assert.equal(failGateProof.supportOnly, true);
  assert.equal(failGateProof.productionBacked, false);
  assert.equal(failGateProof.releaseEligible, false);
  assert.equal(failGateProof.finalReleaseStatus, 'NO-GO');
  assert.equal(failGateProof.integrationRecommendation, 'NO-GO');
  assert.match(failGateProof.commandReportHash, hexSha256Pattern);
  assert.match(failGateProof.proofHash, hexSha256Pattern);
  assertHashCountOnlyLargePluginEvidence(failGateProof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(failGateProof, { label: 'RPP-0796 fail-gate release verifier proof' }));
});

function buildReleaseVerifierProof() {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeReleaseVerifierDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(evidence, 'correctnessGates', 'resources');
  const supportOnlyRelease = evidence.release;
  const deterministicEvidence = deterministicEvidenceProjection(evidence, repeatedEvidence);
  const proofGates = [
    proofGate('release-verifier-command-runtime-resources-gates-pass', safeDecision.updated
      && evidence.releaseVerifier.runtimeReported
      && evidence.releaseVerifier.resourcesReported
      && evidence.releaseVerifier.passFailGatesReported
      && evidence.releaseVerifier.runtimeResourceGateStatus === 'pass', {
      gateCount: evidence.releaseVerifier.gateCount,
      summary: evidence.releaseVerifier.summary,
      commandReportHash: evidence.releaseVerifier.commandReportHash,
    }),
    proofGate('release-verifier-output-after-correctness-gates', safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-release-verifier-evidence-fails-closed', Object.values(unsafe).every((decision) => (
      decision.updated === false
        && decision.outputEmitted === false
        && decision.attemptedPassBlocked === true
    )), {
      blockedDecisionHashes: Object.values(unsafe).map((decision) => decision.decisionHash),
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
    rppId,
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
    storagePerformance: evidence.storagePerformance,
    deterministicEvidence,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      outputEmittedAfterGates: safeDecision.outputEmitted,
      hashCountOnlyOutput: safeDecision.hashCountOnlyOutput,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-count-only-large-plugin-file-release-verifier-v5',
      rawValueEvidenceLeaks: largePluginEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence)) ? 0 : 1,
      publicEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(evidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidencePair() {
  if (recordedEvidencePair) {
    return recordedEvidencePair;
  }

  const benchmark = runLargePluginFileBenchmark(benchmarkOptions());
  const repeatedBenchmark = runLargePluginFileBenchmark(benchmarkOptions());
  const commandReport = runBenchmarkCommand();
  const evidence = buildReleaseVerifierEvidence({ benchmark, commandReport });
  const repeatedEvidence = buildReleaseVerifierEvidence({
    benchmark: repeatedBenchmark,
    commandReport,
  });

  recordCorrectnessGates(evidence, { repeatedEvidence });
  recordCorrectnessGates(repeatedEvidence, { repeatedEvidence: evidence });
  recordedEvidencePair = {
    benchmark,
    repeatedBenchmark,
    commandReport,
    evidence,
    repeatedEvidence,
  };
  return recordedEvidencePair;
}

function benchmarkOptions() {
  return {
    profile: 'unit',
    now: fixedNow,
    chunkSizeBytes,
    maxDurationMs,
    maxHeapUsedBytes,
  };
}

function buildReleaseVerifierEvidence({ benchmark, commandReport }) {
  const resources = resourcesProjection(benchmark.resources, benchmark.atomicGroup, benchmark.deterministicCoverage);
  const storagePerformance = storagePerformanceProjection(benchmark);
  return {
    schemaVersion: 1,
    rppId,
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0776',
      proofId: 'rpp-0776-large-plugin-file-benchmark-v4',
      variant: 4,
      status: 'passed',
      sourceLargePluginFileBenchmark: {
        rppId: 'RPP-0716',
        benchmark: benchmark.benchmark,
        variant: benchmark.variant,
        ok: benchmark.ok,
      },
      previousVariant: {
        rppId: 'RPP-0756',
        proofId: 'rpp-0756-large-plugin-file-benchmark-v3',
        variant: 3,
      },
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    releaseVerifier: commandReportShape(commandReport),
    correctnessGates: [],
    runtime: runtimeProjection(benchmark),
    resources,
    storagePerformance,
    deterministicEvidence: localDeterministicEvidenceProjection({ benchmark, resources, storagePerformance }),
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence, options = {}) {
  const gates = recomputeReleaseVerifierGates(evidence, options);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveReleaseVerifierCarryThrough(evidence, options = {}) {
  const recomputedGates = recomputeReleaseVerifierGates(evidence, options);
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
        commandReportHash: evidence.releaseVerifier.commandReportHash,
        commandGateIdsHash: evidence.releaseVerifier.gateIdsHash,
        runtimeBudgetHash: evidence.runtime.budgetHash,
        workloadHash: evidence.deterministicEvidence.workloadHash,
        storagePerformanceHash: evidence.storagePerformance.storagePerformanceHash,
        fileHashSetHash: evidence.deterministicEvidence.fileHashSetHash,
        storageEvidenceHashSetHash: evidence.deterministicEvidence.storageEvidenceHashSetHash,
        chunkReceiptHashSetHash: evidence.deterministicEvidence.chunkReceiptHashSetHash,
        commandGateCount: evidence.releaseVerifier.gateCount,
        commandPassGateCount: evidence.releaseVerifier.summary.pass,
        commandFailGateCount: evidence.releaseVerifier.summary.fail,
        pluginFileCount: evidence.resources.workload.pluginFiles,
        chunkReceiptCount: evidence.resources.chunks.receipts,
        guardedWritesAttempted: evidence.resources.storage.guardedWritesAttempted,
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
    hashCountOnlyOutput: output ? largePluginEvidenceHasNoRawValues(output) : false,
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

function recomputeReleaseVerifierGates(evidence, options = {}) {
  const releaseVerifier = evidence.releaseVerifier || {};
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const workload = resources.workload || {};
  const storage = resources.storage || {};
  const chunks = resources.chunks || {};
  const fastPathLane = resources.fastPathLane || {};
  const bytes = resources.bytes || {};
  const processResources = resources.process || {};
  const atomicGroup = resources.atomicGroup || {};
  const deterministicEvidence = evidence.deterministicEvidence || {};
  const release = evidence.release || {};
  const deterministicMatch = options.repeatedEvidence
    ? digest(releaseVerifierDeterministicProjection(evidence))
      === digest(releaseVerifierDeterministicProjection(options.repeatedEvidence))
    : false;
  const hashCountOnlyEvidence = largePluginEvidenceHasNoRawValues(publicReleaseVerifierEvidenceProjection(evidence));

  return [
    proofGate('release-verifier-benchmark-command-reports-runtime-resources-gates',
      releaseVerifier.runtimeReported === true
        && releaseVerifier.resourcesReported === true
        && releaseVerifier.passFailGatesReported === true
        && releaseVerifier.runtimeBeforeResourcesBeforeGates === true
        && releaseVerifier.runtimeBudgetReported === true
        && releaseVerifier.gateCount === expectedCommandGateCount
        && runtime.durationReported === true
        && typeof runtime.durationMs === 'number'
        && typeof processResources.heapUsedBytes === 'number', {
      runtimeReported: releaseVerifier.runtimeReported,
      resourcesReported: releaseVerifier.resourcesReported,
      passFailGatesReported: releaseVerifier.passFailGatesReported,
      runtimeBeforeResourcesBeforeGates: releaseVerifier.runtimeBeforeResourcesBeforeGates,
      runtimeBudgetReported: releaseVerifier.runtimeBudgetReported,
      gateCount: releaseVerifier.gateCount,
    }),
    proofGate('release-verifier-benchmark-command-pass-fail-statuses-only',
      releaseVerifier.passFailStatusesOnly === true
        && releaseVerifier.gateCount === expectedCommandGateCount
        && releaseVerifier.summary?.pass === expectedCommandGateCount
        && releaseVerifier.summary?.fail === 0
        && sameArray([...releaseVerifier.passGateIds || []].sort(), [...expectedBenchmarkGateIds].sort())
        && Array.isArray(releaseVerifier.failGateIds)
        && releaseVerifier.failGateIds.length === 0, {
      passFailStatusesOnly: releaseVerifier.passFailStatusesOnly,
      gateCount: releaseVerifier.gateCount,
      summary: releaseVerifier.summary,
      passGateIds: releaseVerifier.passGateIds,
      failGateIds: releaseVerifier.failGateIds,
    }),
    proofGate('runtime-resource-budget-reported-and-passing',
      releaseVerifier.runtimeResourceGateStatus === 'pass'
        && runtime.budgetStatus === 'passed'
        && runtime.durationWithinBudget === true
        && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
        && chunks.maxInFlightWithinBufferedBudget === true
        && chunks.maxUploadConcurrencyWithinBudget === true, {
      runtimeResourceGateStatus: releaseVerifier.runtimeResourceGateStatus,
      budgetStatus: runtime.budgetStatus,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
    }),
    proofGate('built-on-large-plugin-file-benchmark-v4',
      evidence.builtOn?.rppId === 'RPP-0776'
        && evidence.builtOn?.proofId === 'rpp-0776-large-plugin-file-benchmark-v4'
        && evidence.builtOn?.variant === 4
        && evidence.builtOn?.status === 'passed'
        && evidence.builtOn?.sourceLargePluginFileBenchmark?.rppId === 'RPP-0716'
        && evidence.builtOn?.sourceLargePluginFileBenchmark?.benchmark === LARGE_PLUGIN_FILE_BENCHMARK_ID
        && evidence.builtOn?.sourceLargePluginFileBenchmark?.variant === 1
        && evidence.builtOn?.sourceLargePluginFileBenchmark?.ok === true
        && evidence.builtOn?.previousVariant?.rppId === 'RPP-0756'
        && evidence.builtOn?.previousVariant?.variant === 3
        && hexSha256Pattern.test(evidence.builtOn?.evidenceHash || ''), {
      builtOn: evidence.builtOn,
    }),
    proofGate('workload-resource-counts-carried-through',
      workload.pluginFiles === 4
        && workload.totalPluginFileBytes === 229_376
        && workload.largestPluginFileBytes === 131_072
        && workload.chunkSizeBytes === chunkSizeBytes
        && workload.expectedChunks === 8
        && workload.expectedGuardedWrites === 8
        && workload.expectedStagingWrites === 4
        && workload.expectedCommitWrites === 4
        && deterministicEvidence.fileHashCount === workload.pluginFiles, {
      pluginFiles: workload.pluginFiles,
      totalPluginFileBytes: workload.totalPluginFileBytes,
      largestPluginFileBytes: workload.largestPluginFileBytes,
      expectedChunks: workload.expectedChunks,
      expectedGuardedWrites: workload.expectedGuardedWrites,
      fileHashCount: deterministicEvidence.fileHashCount,
    }),
    proofGate('storage-receipts-atomic-group-carried-through',
      storage.boundaryHash === digest(LARGE_PLUGIN_FILE_BOUNDARY)
        && storage.adapterHash === digest(FILESYSTEM_FSYNC_BOUNDARY)
        && storage.atomicGroupIdHash === digest(LARGE_PLUGIN_FILE_GROUP_ID)
        && storage.guardedWritesAttempted === workload.expectedGuardedWrites
        && storage.stagedWrites === workload.expectedStagingWrites
        && storage.committedWrites === workload.expectedCommitWrites
        && storage.appliedFsyncCompleteWrites === workload.expectedGuardedWrites
        && storage.groupFinalizeRecords === 1
        && storage.atomicGroupCommits === 1
        && storage.unsafeLiveVisibleBeforeCommit === 0
        && chunks.receipts === chunks.expectedReceipts
        && chunks.receipts === workload.expectedChunks
        && chunks.bytesReceipted === workload.totalPluginFileBytes
        && chunks.exactPlanScopedReceipts === chunks.expectedReceipts
        && chunks.duplicateReceiptKeys === 0
        && chunks.receiptOnlyResumeSkips === chunks.expectedReceipts
        && fastPathLane.updates === workload.expectedGuardedWrites
        && fastPathLane.unsafeUpdatesBeforeGates === 0
        && fastPathLane.updatesWithFailedGate === 0
        && bytes.liveVisibleBeforeCommitBytes === 0
        && bytes.liveVisibleAfterCommitBytes === workload.totalPluginFileBytes
        && atomicGroup.finalized === true
        && atomicGroup.committed === true
        && atomicGroup.allFilesVisibleAfterCommit === true, {
      guardedWritesAttempted: storage.guardedWritesAttempted,
      stagedWrites: storage.stagedWrites,
      committedWrites: storage.committedWrites,
      receipts: chunks.receipts,
      expectedReceipts: chunks.expectedReceipts,
      unsafeLiveVisibleBeforeCommit: storage.unsafeLiveVisibleBeforeCommit,
      liveVisibleAfterCommitBytes: bytes.liveVisibleAfterCommitBytes,
    }),
    proofGate('deterministic-hash-count-only-release-verifier-evidence',
      deterministicMatch === true
        && hashCountOnlyEvidence === true
        && deterministicEvidence.rawValueEvidenceLeaks === 0
        && deterministicEvidence.tempLeaks === 0
        && deterministicEvidence.storageEvidenceSampleCount === workload.expectedGuardedWrites
        && deterministicEvidence.chunkReceiptSampleCount === Math.min(8, chunks.expectedReceipts || 0), {
      deterministicHash: digest(releaseVerifierDeterministicProjection(evidence)),
      repeatedHash: options.repeatedEvidence
        ? digest(releaseVerifierDeterministicProjection(options.repeatedEvidence))
        : null,
      rawValueEvidenceLeaks: deterministicEvidence.rawValueEvidenceLeaks,
      tempLeaks: deterministicEvidence.tempLeaks,
      storageEvidenceSampleCount: deterministicEvidence.storageEvidenceSampleCount,
      chunkReceiptSampleCount: deterministicEvidence.chunkReceiptSampleCount,
    }),
    proofGate('support-only-release-no-go',
      release.supportOnly === true
        && release.productionBacked === false
        && release.releaseEligible === false
        && release.productionThroughput === 'not-claimed'
        && release.speedClaimsAllowed === false
        && release.releaseVerifierCarryThrough === 'support-only-local-release-verifier'
        && release.finalReleaseStatus === 'NO-GO'
        && release.integrationRecommendation === 'NO-GO', {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      releaseEligible: release.releaseEligible,
      productionThroughput: release.productionThroughput,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function unsafeReleaseVerifierDecisions(evidence, repeatedEvidence) {
  const missingRuntimeReport = withPassedStatus(clone(evidence));
  missingRuntimeReport.releaseVerifier.runtimeReported = false;
  missingRuntimeReport.releaseVerifier.runtimeBeforeResourcesBeforeGates = false;
  missingRuntimeReport.runtime.durationReported = false;

  const missingResourcesReport = withPassedStatus(clone(evidence));
  missingResourcesReport.releaseVerifier.resourcesReported = false;
  missingResourcesReport.resources.process.heapUsedBytes = null;

  const missingPassFailGates = withPassedStatus(clone(evidence));
  missingPassFailGates.releaseVerifier.passFailGatesReported = false;
  missingPassFailGates.releaseVerifier.gateCount = 0;
  missingPassFailGates.releaseVerifier.passGateIds = [];
  missingPassFailGates.releaseVerifier.summary = { pass: 0, fail: 0 };

  const nonPassFailGateStatus = withPassedStatus(clone(evidence));
  nonPassFailGateStatus.releaseVerifier.passFailStatusesOnly = false;
  nonPassFailGateStatus.releaseVerifier.summary = { pass: 9, fail: 0, skipped: 1 };

  const failedRuntimeResourceGate = withPassedStatus(clone(evidence));
  failedRuntimeResourceGate.releaseVerifier.runtimeResourceGateStatus = 'fail';
  failedRuntimeResourceGate.releaseVerifier.summary = { pass: 9, fail: 1 };
  failedRuntimeResourceGate.releaseVerifier.passGateIds = expectedBenchmarkGateIds
    .filter((gateId) => gateId !== 'runtime-resource-budget');
  failedRuntimeResourceGate.releaseVerifier.failGateIds = ['runtime-resource-budget'];
  failedRuntimeResourceGate.runtime.budgetStatus = 'failed';
  failedRuntimeResourceGate.runtime.durationWithinBudget = false;
  failedRuntimeResourceGate.resources.process.heapUsedBytes = failedRuntimeResourceGate.runtime.budgets.maxHeapUsedBytes + 1;

  const staleBuiltOnVariant = withPassedStatus(clone(evidence));
  staleBuiltOnVariant.builtOn.rppId = 'RPP-0756';
  staleBuiltOnVariant.builtOn.proofId = 'rpp-0756-large-plugin-file-benchmark-v3';
  staleBuiltOnVariant.builtOn.variant = 3;

  const rawValueLeak = withPassedStatus(clone(evidence));
  rawValueLeak.deterministicEvidence.rawValueEvidenceLeaks = 1;
  rawValueLeak.deterministicEvidence.rawFixtureMarker = 'wp-content/plugins/payments/payments.php';

  const productionGoClaim = withPassedStatus(clone(evidence));
  productionGoClaim.release.supportOnly = false;
  productionGoClaim.release.productionBacked = true;
  productionGoClaim.release.releaseEligible = true;
  productionGoClaim.release.productionThroughput = 'claimed';
  productionGoClaim.release.speedClaimsAllowed = true;
  productionGoClaim.release.finalReleaseStatus = 'GO';
  productionGoClaim.release.integrationRecommendation = 'GO';

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingRuntimeReport: resolveReleaseVerifierCarryThrough(missingRuntimeReport, { repeatedEvidence }),
    missingResourcesReport: resolveReleaseVerifierCarryThrough(missingResourcesReport, { repeatedEvidence }),
    missingPassFailGates: resolveReleaseVerifierCarryThrough(missingPassFailGates, { repeatedEvidence }),
    nonPassFailGateStatus: resolveReleaseVerifierCarryThrough(nonPassFailGateStatus, { repeatedEvidence }),
    failedRuntimeResourceGate: resolveReleaseVerifierCarryThrough(failedRuntimeResourceGate, { repeatedEvidence }),
    staleBuiltOnVariant: resolveReleaseVerifierCarryThrough(staleBuiltOnVariant, { repeatedEvidence }),
    rawValueLeak: resolveReleaseVerifierCarryThrough(rawValueLeak, { repeatedEvidence }),
    productionGoClaim: resolveReleaseVerifierCarryThrough(productionGoClaim, { repeatedEvidence }),
    prematurePassStatus: resolveReleaseVerifierCarryThrough(prematurePassStatus, { repeatedEvidence }),
  };
}

function buildFailGateReleaseVerifierProof(report) {
  const releaseVerifier = commandReportShape(report);
  const runtimeBudgetGate = gateById(report, 'runtime-resource-budget');
  const proof = {
    schemaVersion: 1,
    rppId,
    proofId,
    variant: 5,
    evidenceSource,
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    releaseVerifier,
    runtime: {
      durationMs: report.runtime.durationMs,
      budgets: {
        profile: report.runtime.budgets.profile,
        maxDurationMs: report.runtime.budgets.maxDurationMs,
        maxHeapUsedBytes: report.runtime.budgets.maxHeapUsedBytes,
        maxBufferedUploadBytes: report.runtime.budgets.maxBufferedUploadBytes,
        maxUploadConcurrency: report.runtime.budgets.maxUploadConcurrency,
      },
    },
    resources: {
      workload: workloadProjection(report.resources.workload),
      process: {
        heapUsedBytes: report.resources.process.heapUsedBytes,
        maxRssBytes: report.resources.process.maxRssBytes,
      },
    },
    failedGate: {
      id: runtimeBudgetGate.id,
      durationMs: runtimeBudgetGate.evidence.durationMs,
      maxDurationMs: runtimeBudgetGate.evidence.maxDurationMs,
      heapUsedBytes: runtimeBudgetGate.evidence.heapUsedBytes,
      maxHeapUsedBytes: runtimeBudgetGate.evidence.maxHeapUsedBytes,
    },
    commandReportHash: releaseVerifier.commandReportHash,
  };

  return {
    ...proof,
    proofHash: digest(proof),
  };
}

function commandReportShape(report) {
  const rootKeys = Object.keys(report || {});
  const gates = Array.isArray(report?.gates) ? report.gates : [];
  const gateStatuses = gates.map((gate) => gate.status);
  const runtimeResourceGate = gates.find((gate) => gate.id === 'runtime-resource-budget');
  const commandProjection = publicCommandProjection(report);

  return {
    command: 'node scripts/bench/large-plugin-file-benchmark.js',
    benchmarkId: report?.benchmark || '',
    runtimeReported: hasRuntimeReport(report),
    resourcesReported: hasResourceReport(report),
    passFailGatesReported: hasPassFailGateReport(report),
    runtimeBeforeResourcesBeforeGates: rootKeys.indexOf('runtime') !== -1
      && rootKeys.indexOf('resources') !== -1
      && rootKeys.indexOf('gates') !== -1
      && rootKeys.indexOf('runtime') < rootKeys.indexOf('resources')
      && rootKeys.indexOf('resources') < rootKeys.indexOf('gates'),
    runtimeBudgetReported: Boolean(runtimeResourceGate)
      && typeof report?.runtime?.budgets?.maxDurationMs === 'number'
      && typeof report?.runtime?.budgets?.maxHeapUsedBytes === 'number',
    passFailStatusesOnly: gateStatuses.every((status) => status === 'pass' || status === 'fail'),
    gateIds: gates.map((gate) => gate.id),
    gateIdsHash: sha256(gates.map((gate) => gate.id)),
    gateCount: gates.length,
    passGateIds: gates.filter((gate) => gate.status === 'pass').map((gate) => gate.id),
    failGateIds: gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id),
    summary: gateStatusCounts(gates),
    runtimeResourceGateStatus: runtimeResourceGate?.status || 'missing',
    productionGateEvidence: 'not-present',
    carryThrough: 'support-only-local-release-verifier',
    commandReportHash: digest(commandProjection),
  };
}

function runtimeProjection(benchmark) {
  const budget = benchmark.runtime.budgets;
  return {
    generatedAt: benchmark.runtime.generatedAt,
    profile: benchmark.profile,
    durationMs: benchmark.runtime.durationMs,
    durationReported: typeof benchmark.runtime.durationMs === 'number',
    durationWithinBudget: benchmark.runtime.durationMs <= budget.maxDurationMs,
    budgetStatus: benchmark.runtime.durationMs <= budget.maxDurationMs
      && benchmark.resources.process.heapUsedBytes <= budget.maxHeapUsedBytes
      ? 'passed'
      : 'failed',
    budgets: {
      profile: budget.profile,
      maxDurationMs: budget.maxDurationMs,
      maxHeapUsedBytes: budget.maxHeapUsedBytes,
      maxBufferedUploadBytes: budget.maxBufferedUploadBytes,
      maxUploadConcurrency: budget.maxUploadConcurrency,
    },
    budgetHash: sha256({
      profile: budget.profile,
      maxDurationMs: budget.maxDurationMs,
      maxHeapUsedBytes: budget.maxHeapUsedBytes,
      maxBufferedUploadBytes: budget.maxBufferedUploadBytes,
      maxUploadConcurrency: budget.maxUploadConcurrency,
    }),
  };
}

function resourcesProjection(resources, atomicGroup, coverage) {
  const chunks = resources.chunks || {};
  return {
    workload: workloadProjection(resources.workload || {}),
    storage: storageProjection(resources.storage || {}),
    chunks: {
      receipts: chunks.receipts,
      expectedReceipts: chunks.expectedReceipts,
      bytesReceipted: chunks.bytesReceipted,
      exactPlanScopedReceipts: chunks.exactPlanScopedReceipts,
      duplicateReceiptKeys: chunks.duplicateReceiptKeys,
      receiptOnlyResumeSkips: chunks.receiptOnlyResumeSkips,
      missingReceiptBlocksResume: chunks.missingReceiptBlocksResume,
      mismatchedReceiptBlocksResume: chunks.mismatchedReceiptBlocksResume,
      maxChunkSizeBytes: chunks.maxChunkSizeBytes,
      maxBufferedUploadBytes: chunks.maxBufferedUploadBytes,
      maxUploadConcurrency: chunks.maxUploadConcurrency,
      maxInFlightUploadBytes: chunks.maxInFlightUploadBytes,
      maxInFlightWithinBufferedBudget: chunks.maxInFlightUploadBytes <= chunks.maxBufferedUploadBytes,
      maxUploadConcurrencyWithinBudget: chunks.maxUploadConcurrency <= resources.runtimeBudget?.maxUploadConcurrency,
    },
    fastPathLane: fastPathLaneProjection(resources.fastPathLane || {}),
    bytes: bytesProjection(resources.bytes || {}),
    process: processProjection(resources.process || {}),
    atomicGroup: atomicGroupProjection(atomicGroup || coverage?.group || {}),
    tempLeaks: resources.tempLeaks,
  };
}

function storagePerformanceProjection(benchmark) {
  const coverage = benchmark.deterministicCoverage;
  const projection = {
    productionStorageDurability: 'not-claimed',
    workload: workloadProjection(benchmark.resources.workload),
    storage: storageProjection(benchmark.resources.storage),
    chunks: chunkCountProjection(benchmark.resources.chunks),
    fastPathLane: fastPathLaneProjection(benchmark.resources.fastPathLane),
    bytes: bytesProjection(benchmark.resources.bytes),
    atomicGroup: atomicGroupProjection(benchmark.atomicGroup),
    fileHashCount: coverage.files.length,
    storageEvidenceSampleCount: coverage.evidenceSamples.length,
    chunkReceiptSampleCount: coverage.chunkReceiptSamples.length,
    fileHashSetHash: sha256(coverage.files.map((file) => file.resourceKeyHash)),
    storageEvidenceHashSetHash: sha256(coverage.evidenceSamples.map(storageEvidenceSampleHash)),
    chunkReceiptHashSetHash: sha256(coverage.chunkReceiptSamples.map((sample) => sample.receiptKeyHash)),
    failureCount: coverage.failures.length,
    tempLeaks: coverage.tempLeaks,
    rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
  };

  return {
    ...projection,
    storagePerformanceHash: sha256(projection),
  };
}

function localDeterministicEvidenceProjection({ benchmark, resources, storagePerformance }) {
  const coverage = benchmark.deterministicCoverage;
  const core = {
    source: {
      rppId,
      evidenceSource,
      builtOnRppId: 'RPP-0776',
      benchmarkHash: digest(benchmark.benchmark),
      benchmarkVariant: benchmark.variant,
    },
    profile: benchmark.profile,
    workload: resources.workload,
    commandGateCount: benchmark.gates.length,
    commandGateStatusCounts: gateStatusCounts(benchmark.gates),
    fileHashCount: coverage.files.length,
    storageEvidenceSampleCount: coverage.evidenceSamples.length,
    chunkReceiptSampleCount: coverage.chunkReceiptSamples.length,
    fileHashSetHash: storagePerformance.fileHashSetHash,
    storageEvidenceHashSetHash: storagePerformance.storageEvidenceHashSetHash,
    chunkReceiptHashSetHash: storagePerformance.chunkReceiptHashSetHash,
    workloadHash: sha256(resources.workload),
    rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
    tempLeaks: coverage.tempLeaks,
  };

  return {
    ...core,
    publicEvidenceHash: sha256(core),
  };
}

function deterministicEvidenceProjection(evidence, repeatedEvidence) {
  return {
    ...evidence.deterministicEvidence,
    match: digest(releaseVerifierDeterministicProjection(evidence))
      === digest(releaseVerifierDeterministicProjection(repeatedEvidence)),
    firstProjectionHash: sha256(releaseVerifierDeterministicProjection(evidence)),
    repeatedProjectionHash: sha256(releaseVerifierDeterministicProjection(repeatedEvidence)),
  };
}

function publicBenchmarkProjection(report) {
  return {
    schemaVersion: report.schemaVersion,
    rppId: report.rppId,
    benchmark: report.benchmark,
    variant: report.variant,
    profile: report.profile,
    ok: report.ok,
    runtime: {
      generatedAt: report.runtime?.generatedAt,
      budgetProfile: report.runtime?.budgets?.profile,
      maxDurationMs: report.runtime?.budgets?.maxDurationMs,
      maxHeapUsedBytes: report.runtime?.budgets?.maxHeapUsedBytes,
      maxBufferedUploadBytes: report.runtime?.budgets?.maxBufferedUploadBytes,
      maxUploadConcurrency: report.runtime?.budgets?.maxUploadConcurrency,
      durationReported: typeof report.runtime?.durationMs === 'number',
    },
    resources: {
      workload: workloadProjection(report.resources?.workload || {}),
      storage: storageProjection(report.resources?.storage || {}),
      chunks: chunkCountProjection(report.resources?.chunks || {}),
      fastPathLane: fastPathLaneProjection(report.resources?.fastPathLane || {}),
      bytes: bytesProjection(report.resources?.bytes || {}),
      tempLeaks: report.resources?.tempLeaks,
    },
    atomicGroup: atomicGroupProjection(report.atomicGroup || {}),
    gates: Array.isArray(report.gates)
      ? report.gates.map((gate) => ({
          id: gate.id,
          status: gate.status,
        }))
      : [],
  };
}

function publicCommandProjection(report) {
  const gates = Array.isArray(report?.gates) ? report.gates : [];
  return {
    schemaVersion: report?.schemaVersion,
    rppId: report?.rppId,
    benchmark: report?.benchmark,
    variant: report?.variant,
    profile: report?.profile,
    ok: report?.ok,
    rootKeysHash: sha256(Object.keys(report || {})),
    runtime: {
      present: Boolean(report?.runtime),
      generatedAtHash: digest(report?.runtime?.generatedAt || ''),
      durationReported: typeof report?.runtime?.durationMs === 'number',
      budgetHash: sha256(report?.runtime?.budgets || {}),
      nodeMajorReported: typeof report?.runtime?.node === 'string',
      platformReported: typeof report?.runtime?.platform === 'string',
      cpuCountReported: typeof report?.runtime?.cpuCount === 'number',
    },
    resources: resourcesProjection(
      report?.resources || {},
      report?.atomicGroup || {},
      report?.deterministicCoverage || {},
    ),
    gates: {
      present: Array.isArray(report?.gates),
      count: gates.length,
      statusCounts: gateStatusCounts(gates),
      idsHash: sha256(gates.map((gate) => gate.id)),
      runtimeResourceGateStatus: gates.find((gate) => gate.id === 'runtime-resource-budget')?.status || 'missing',
    },
  };
}

function publicReleaseVerifierEvidenceProjection(evidence) {
  return {
    schemaVersion: evidence.schemaVersion,
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    evidenceSource: evidence.evidenceSource,
    status: evidence.status,
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    runtime: evidence.runtime,
    resources: evidence.resources,
    storagePerformance: evidence.storagePerformance,
    deterministicEvidence: evidence.deterministicEvidence,
    release: evidence.release,
  };
}

function releaseVerifierDeterministicProjection(evidence) {
  return {
    builtOn: evidence.builtOn,
    releaseVerifier: {
      command: evidence.releaseVerifier.command,
      benchmarkId: evidence.releaseVerifier.benchmarkId,
      runtimeReported: evidence.releaseVerifier.runtimeReported,
      resourcesReported: evidence.releaseVerifier.resourcesReported,
      passFailGatesReported: evidence.releaseVerifier.passFailGatesReported,
      gateIds: evidence.releaseVerifier.gateIds,
      gateCount: evidence.releaseVerifier.gateCount,
      passGateIds: evidence.releaseVerifier.passGateIds,
      failGateIds: evidence.releaseVerifier.failGateIds,
      summary: evidence.releaseVerifier.summary,
      productionGateEvidence: evidence.releaseVerifier.productionGateEvidence,
      carryThrough: evidence.releaseVerifier.carryThrough,
    },
    runtime: {
      profile: evidence.runtime.profile,
      budgetStatus: evidence.runtime.budgetStatus,
      budgets: evidence.runtime.budgets,
    },
    resources: {
      workload: evidence.resources.workload,
      storage: evidence.resources.storage,
      chunks: evidence.resources.chunks,
      fastPathLane: evidence.resources.fastPathLane,
      bytes: evidence.resources.bytes,
      atomicGroup: evidence.resources.atomicGroup,
      tempLeaks: evidence.resources.tempLeaks,
    },
    storagePerformance: evidence.storagePerformance,
    deterministicEvidence: evidence.deterministicEvidence,
    release: evidence.release,
  };
}

function workloadProjection(workload) {
  return {
    planIdHash: workload.planIdHash || null,
    atomicGroupIdHash: workload.atomicGroupId ? digest(workload.atomicGroupId) : null,
    pluginFiles: workload.pluginFiles,
    totalPluginFileBytes: workload.totalPluginFileBytes,
    largestPluginFileBytes: workload.largestPluginFileBytes,
    chunkSizeBytes: workload.chunkSizeBytes,
    expectedChunks: workload.expectedChunks,
    expectedGuardedWrites: workload.expectedGuardedWrites,
    expectedStagingWrites: workload.expectedStagingWrites,
    expectedCommitWrites: workload.expectedCommitWrites,
  };
}

function storageProjection(storage) {
  return {
    boundaryHash: storage.boundary ? digest(storage.boundary) : null,
    engineHash: storage.engine ? digest(storage.engine) : null,
    adapterHash: storage.adapter ? digest(storage.adapter) : null,
    atomicGroupIdHash: storage.atomicGroupId ? digest(storage.atomicGroupId) : null,
    commitPolicyHash: storage.commitPolicy ? digest(storage.commitPolicy) : null,
    guardedWritesAttempted: storage.guardedWritesAttempted,
    stagedWrites: storage.stagedWrites,
    committedWrites: storage.committedWrites,
    appliedFsyncCompleteWrites: storage.appliedFsyncCompleteWrites,
    livePreconditionChecks: storage.livePreconditionChecks,
    groupFinalizeRecords: storage.groupFinalizeRecords,
    atomicGroupCommits: storage.atomicGroupCommits,
    unsafeLiveVisibleBeforeCommit: storage.unsafeLiveVisibleBeforeCommit,
  };
}

function chunkCountProjection(chunks) {
  return {
    receipts: chunks.receipts,
    expectedReceipts: chunks.expectedReceipts,
    bytesReceipted: chunks.bytesReceipted,
    exactPlanScopedReceipts: chunks.exactPlanScopedReceipts,
    duplicateReceiptKeys: chunks.duplicateReceiptKeys,
    receiptOnlyResumeSkips: chunks.receiptOnlyResumeSkips,
    missingReceiptBlocksResume: chunks.missingReceiptBlocksResume,
    mismatchedReceiptBlocksResume: chunks.mismatchedReceiptBlocksResume,
    maxChunkSizeBytes: chunks.maxChunkSizeBytes,
    maxBufferedUploadBytes: chunks.maxBufferedUploadBytes,
    maxUploadConcurrency: chunks.maxUploadConcurrency,
    maxInFlightUploadBytes: chunks.maxInFlightUploadBytes,
  };
}

function fastPathLaneProjection(fastPathLane) {
  return {
    idHash: fastPathLane.id ? digest(fastPathLane.id) : null,
    updatePolicyHash: fastPathLane.updatePolicy ? digest(fastPathLane.updatePolicy) : null,
    updates: fastPathLane.updates,
    blocked: fastPathLane.blocked,
    unsafeUpdatesBeforeGates: fastPathLane.unsafeUpdatesBeforeGates,
    updatesWithFailedGate: fastPathLane.updatesWithFailedGate,
  };
}

function bytesProjection(bytes) {
  return {
    plannedPluginFileBytes: bytes.plannedPluginFileBytes,
    stagedBytes: bytes.stagedBytes,
    committedBytes: bytes.committedBytes,
    tempWrittenBytes: bytes.tempWrittenBytes,
    comparedBytes: bytes.comparedBytes,
    liveVisibleBeforeCommitBytes: bytes.liveVisibleBeforeCommitBytes,
    liveVisibleAfterCommitBytes: bytes.liveVisibleAfterCommitBytes,
  };
}

function atomicGroupProjection(group) {
  return {
    idHash: group.id ? digest(group.id) : null,
    commitPolicyHash: group.commitPolicy ? digest(group.commitPolicy) : null,
    canonicalVisibleBeforeCommit: group.canonicalVisibleBeforeCommit,
    finalized: group.finalized,
    committed: group.committed,
    requiredChunkReceipts: group.requiredChunkReceipts,
    requiredStagedFiles: group.requiredStagedFiles,
    livePreconditionsRechecked: group.livePreconditionsRechecked,
    allFilesVisibleAfterCommit: group.allFilesVisibleAfterCommit,
  };
}

function processProjection(processResources) {
  return {
    userCpuMs: processResources.userCpuMs,
    systemCpuMs: processResources.systemCpuMs,
    maxRssBytes: processResources.maxRssBytes,
    heapUsedBytes: processResources.heapUsedBytes,
    heapDeltaBytes: processResources.heapDeltaBytes,
  };
}

function storageEvidenceSampleHash(sample) {
  return digest({
    boundary: sample.boundary,
    adapter: sample.adapter,
    engine: sample.engine,
    operation: sample.operation,
    outcome: sample.outcome,
    expectedResourceHash: sample.expectedResourceHash,
    expectedStorageHash: sample.expectedStorageHash,
    actualStorageHash: sample.actualStorageHash,
    plannedStorageHash: sample.plannedStorageHash,
    postRenameStorageHash: sample.postRenameStorageHash,
    fsyncEvidence: sample.fsyncEvidence,
    correctnessGateStatuses: sample.correctnessGates?.map((gate) => ({
      id: gate.id,
      status: gate.status,
      blocker: gate.blocker,
    })) || [],
    fastPathLane: sample.fastPathLane,
    bytesCompared: sample.bytesCompared,
    bytesWrittenToTemp: sample.bytesWrittenToTemp,
  });
}

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    releaseEligible: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    liveProductionRemoteService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'support-only-local-release-verifier',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'live-production-service-not-supplied',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
    ],
  };
}

function runBenchmarkCommand(options = {}) {
  return runBenchmarkCommandResult(options).report;
}

function runBenchmarkCommandResult(options = {}) {
  const heapBudget = options.maxHeapUsedBytes ?? maxHeapUsedBytes;
  const result = spawnSync(process.execPath, [
    benchmarkScript,
    '--profile=unit',
    `--chunk-size-bytes=${chunkSizeBytes}`,
    `--max-duration-ms=${maxDurationMs}`,
    `--max-heap-used-bytes=${heapBudget}`,
  ], {
    encoding: 'utf8',
    env: sanitizedBenchmarkEnv(),
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.trim().length > 0, 'large plugin benchmark command did not emit JSON');

  return {
    status: result.status,
    report: JSON.parse(result.stdout),
  };
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

function assertBenchmarkCommandReportShape(report, options = {}) {
  const heapBudget = options.maxHeapUsedBytes ?? maxHeapUsedBytes;

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.rppId, 'RPP-0716');
  assert.equal(report.benchmark, LARGE_PLUGIN_FILE_BENCHMARK_ID);
  assert.equal(report.variant, 1);
  assert.equal(report.profile, 'unit');
  assert.equal(report.runtime.benchmarkId, LARGE_PLUGIN_FILE_BENCHMARK_ID);
  assert.equal(Date.parse(report.runtime.generatedAt) > 0, true);
  assertNonNegativeNumber(report.runtime.durationMs);
  assert.match(report.runtime.node, /^v\d+\.\d+\.\d+/);
  assert.equal(typeof report.runtime.platform, 'string');
  assert.equal(typeof report.runtime.arch, 'string');
  assert.equal(typeof report.runtime.cpuCount, 'number');
  assert.equal(report.runtime.budgets.profile, 'unit');
  assert.equal(report.runtime.budgets.maxDurationMs, maxDurationMs);
  assert.equal(report.runtime.budgets.maxHeapUsedBytes, heapBudget);
  assert.equal(report.runtime.budgets.maxBufferedUploadBytes, 128 * 1024);
  assert.equal(report.runtime.budgets.maxUploadConcurrency, 2);

  assert.equal(report.resources.workload.pluginFiles, 4);
  assert.equal(report.resources.workload.totalPluginFileBytes, 229_376);
  assert.equal(report.resources.workload.largestPluginFileBytes, 131_072);
  assert.equal(report.resources.workload.chunkSizeBytes, chunkSizeBytes);
  assert.equal(report.resources.workload.expectedChunks, 8);
  assert.equal(report.resources.workload.expectedGuardedWrites, 8);
  assert.equal(report.resources.storage.boundary, LARGE_PLUGIN_FILE_BOUNDARY);
  assert.equal(report.resources.storage.adapter, FILESYSTEM_FSYNC_BOUNDARY);
  assert.equal(report.resources.storage.atomicGroupId, LARGE_PLUGIN_FILE_GROUP_ID);
  assert.equal(report.resources.storage.guardedWritesAttempted, 8);
  assert.equal(report.resources.storage.stagedWrites, 4);
  assert.equal(report.resources.storage.committedWrites, 4);
  assert.equal(report.resources.storage.appliedFsyncCompleteWrites, 8);
  assert.equal(report.resources.storage.groupFinalizeRecords, 1);
  assert.equal(report.resources.storage.atomicGroupCommits, 1);
  assert.equal(report.resources.storage.unsafeLiveVisibleBeforeCommit, 0);
  assert.equal(report.resources.chunks.receipts, 8);
  assert.equal(report.resources.chunks.expectedReceipts, 8);
  assert.equal(report.resources.chunks.bytesReceipted, 229_376);
  assert.equal(report.resources.chunks.duplicateReceiptKeys, 0);
  assert.equal(report.resources.bytes.liveVisibleBeforeCommitBytes, 0);
  assert.equal(report.resources.bytes.liveVisibleAfterCommitBytes, 229_376);
  assert.equal(typeof report.resources.process.heapUsedBytes, 'number');
  assert.equal(typeof report.resources.process.maxRssBytes, 'number');
  assert.equal(typeof report.resources.process.userCpuMs, 'number');
  assert.equal(typeof report.resources.process.systemCpuMs, 'number');
  assert.equal(report.resources.tempLeaks, 0);

  assert.equal(hasPassFailGateReport(report), true);
  assert.deepEqual(report.gates.map((gate) => gate.id), [...expectedBenchmarkGateIds]);
  assert.equal(report.deterministicCoverage.rawValueEvidenceLeaks, 0);
  assert.equal(report.deterministicCoverage.tempLeaks, 0);
  assert.equal(report.deterministicCoverage.files.length, 4);
  assert.equal(report.deterministicCoverage.evidenceSamples.length, 8);
  assert.equal(report.deterministicCoverage.chunkReceiptSamples.length, 8);
}

function hasRuntimeReport(report) {
  return Boolean(report?.runtime
    && report.runtime.benchmarkId === LARGE_PLUGIN_FILE_BENCHMARK_ID
    && typeof report.runtime.generatedAt === 'string'
    && typeof report.runtime.durationMs === 'number'
    && typeof report.runtime.node === 'string'
    && typeof report.runtime.platform === 'string'
    && typeof report.runtime.arch === 'string'
    && typeof report.runtime.cpuCount === 'number'
    && report.runtime.budgets
    && typeof report.runtime.budgets.maxDurationMs === 'number'
    && typeof report.runtime.budgets.maxHeapUsedBytes === 'number');
}

function hasResourceReport(report) {
  return Boolean(report?.resources
    && report.resources.workload
    && report.resources.storage
    && report.resources.chunks
    && report.resources.process
    && typeof report.resources.workload.pluginFiles === 'number'
    && typeof report.resources.storage.guardedWritesAttempted === 'number'
    && typeof report.resources.chunks.receipts === 'number'
    && typeof report.resources.process.heapUsedBytes === 'number');
}

function hasPassFailGateReport(report) {
  return Array.isArray(report?.gates)
    && report.gates.length === expectedBenchmarkGateIds.length
    && report.gates.every((gate) => expectedBenchmarkGateIds.includes(gate.id)
      && ['pass', 'fail'].includes(gate.status));
}

function projectUnsafeDecisions(decisions) {
  return Object.fromEntries(Object.entries(decisions).map(([key, decision]) => [key, {
    updated: decision.updated,
    outputEmitted: decision.outputEmitted,
    attemptedPassBlocked: decision.attemptedPassBlocked,
    blockedBy: decision.blockedBy,
    decisionHash: decision.decisionHash,
  }]));
}

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  evidence.correctnessGates = expectedReleaseVerifierGateIds.map((id) => ({
    id,
    status: 'passed',
    evidenceHash: digest({ id, forced: 'unsafe-pass-attempt' }),
  }));
  return evidence;
}

function gateStatusCounts(gates) {
  const counts = { pass: 0, fail: 0 };
  for (const gate of gates || []) {
    counts[gate.status] = (counts[gate.status] || 0) + 1;
  }
  return counts;
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function gateById(report, id) {
  const gate = report.gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `missing ${id} gate`);
  return gate;
}

function assertNonNegativeNumber(value) {
  assert.equal(typeof value, 'number');
  assert.equal(Number.isFinite(value), true);
  assert.equal(value >= 0, true);
}

function objectKeyBefore(object, beforeKey, afterKey) {
  const keys = Object.keys(object);
  return keys.indexOf(beforeKey) !== -1
    && keys.indexOf(afterKey) !== -1
    && keys.indexOf(beforeKey) < keys.indexOf(afterKey);
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function largePluginEvidenceHasNoRawValues(value) {
  return !JSON.stringify(value).match(
    /logicalPath|wp-content\/plugins|payments\.php|admin\.js|commerce\.php|catalog\.dat|search-index\.dat|plugin-file-(?:base|planned)-payload|large plugin file raw fixture|install-commerce-stack|plan-rpp-0716|benchmark-large-plugin-file-(?:stage|commit)|"driver"\s*:|\/tmp\/reprint-rpp|[A-Za-z]:\\/i,
  );
}

function assertHashCountOnlyLargePluginEvidence(value) {
  assert.equal(largePluginEvidenceHasNoRawValues(value), true);
}
