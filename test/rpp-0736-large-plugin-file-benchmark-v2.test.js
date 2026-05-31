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
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0736-large-plugin-file-benchmark-v2';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const chunkSizeBytes = 32 * 1024;
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const expectedGateIds = Object.freeze([
  'benchmark-command-reports-runtime-resources-gates',
  'complete-storage-performance-report',
  'chunk-receipts-cover-large-plugin-files',
  'atomic-group-visibility-order',
  'filesystem-fsync-before-fast-path-lane',
  'backpressure-runtime-resource-budget',
  'deterministic-storage-performance-evidence',
  'hash-only-storage-performance-evidence',
  'support-only-release-no-go',
]);

test('RPP-0736 variant 2 proves large plugin file benchmark storage performance gates', {
  concurrency: false,
}, () => {
  const proof = buildVariant2Proof();

  assert.equal(proof.rppId, 'RPP-0736');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0716');
  assert.equal(proof.builtOn.benchmark, LARGE_PLUGIN_FILE_BENCHMARK_ID);
  assert.equal(proof.builtOn.variant, 1);
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.command.reportsRuntime, true);
  assert.equal(proof.command.reportsResources, true);
  assert.equal(proof.command.reportsGates, true);
  assert.equal(proof.command.runtimeBeforeResourcesBeforeGates, true);
  assert.equal(proof.command.runtimeResourceGateReported, true);
  assert.equal(proof.command.passFailStatusesOnly, true);
  assert.deepEqual([...new Set(proof.command.gateStatuses)], ['pass']);
  assert.equal(proof.command.gateCount, 10);
  assert.match(proof.command.reportHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationMs >= 0, true);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.workload.pluginFiles, 4);
  assert.equal(proof.resources.workload.totalPluginFileBytes, 229_376);
  assert.equal(proof.resources.workload.largestPluginFileBytes, 131_072);
  assert.equal(proof.resources.workload.expectedChunks, 8);
  assert.equal(proof.resources.storage.boundary, LARGE_PLUGIN_FILE_BOUNDARY);
  assert.equal(proof.resources.storage.adapter, FILESYSTEM_FSYNC_BOUNDARY);
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
  assert.equal(proof.resources.chunks.duplicateReceiptKeys, 0);
  assert.equal(proof.resources.bytes.liveVisibleBeforeCommitBytes, 0);
  assert.equal(proof.resources.bytes.liveVisibleAfterCommitBytes, 229_376);

  assert.equal(proof.storagePerformance.atomicGroup.idHash, digest(LARGE_PLUGIN_FILE_GROUP_ID));
  assert.equal(proof.storagePerformance.atomicGroup.canonicalVisibleBeforeCommit, false);
  assert.equal(proof.storagePerformance.atomicGroup.finalized, true);
  assert.equal(proof.storagePerformance.atomicGroup.committed, true);
  assert.equal(proof.storagePerformance.atomicGroup.allFilesVisibleAfterCommit, true);
  assert.equal(proof.storagePerformance.deterministicCoverage.files.length, 4);
  assert.equal(proof.storagePerformance.deterministicCoverage.storageEvidenceSamples.length, 8);
  assert.equal(proof.storagePerformance.deterministicCoverage.chunkReceiptSamples.length, 8);
  assert.match(proof.storagePerformance.storagePerformanceHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.storagePerformance.outputHash, /^sha256:[a-f0-9]{64}$/);

  assert.deepEqual(proof.correctness.gateIds, expectedGateIds);
  assert.deepEqual(proof.correctness.recomputedGateVector.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.storageOutputEmittedAfterGates, true);
  assert.equal(proof.correctness.hashOnlyStorageOutput, true);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.shortReceiptSet.updated, false);
  assert.equal(proof.unsafe.shortReceiptSet.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.shortReceiptSet.blockedBy.includes('chunk-receipts-cover-large-plugin-files'));
  assert.equal(proof.unsafe.visibleBeforeCommit.updated, false);
  assert.equal(proof.unsafe.visibleBeforeCommit.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.visibleBeforeCommit.blockedBy.includes('atomic-group-visibility-order'));
  assert.equal(proof.unsafe.failedFsyncEvidence.updated, false);
  assert.equal(proof.unsafe.failedFsyncEvidence.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.failedFsyncEvidence.blockedBy.includes('filesystem-fsync-before-fast-path-lane'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.equal(proof.unsafe.prematurePassStatus.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertHashOnlyLargePluginEvidence(proof);
});

test('RPP-0736 variant 2 fails closed for incomplete, visible, failed, and premature evidence', () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveLargePluginFileBenchmarkProof(evidence, { repeatedEvidence });
  const shortReceiptSet = withPassedStatus(clone(evidence));
  shortReceiptSet.storagePerformance.chunks.receipts -= 1;
  shortReceiptSet.storagePerformance.deterministicCoverage.chunkReceiptSamples.pop();
  const visibleBeforeCommit = withPassedStatus(clone(evidence));
  visibleBeforeCommit.storagePerformance.atomicGroup.canonicalVisibleBeforeCommit = true;
  visibleBeforeCommit.storagePerformance.bytes.liveVisibleBeforeCommitBytes = 1024;
  visibleBeforeCommit.storagePerformance.storage.unsafeLiveVisibleBeforeCommit = 1;
  const failedFsyncEvidence = withPassedStatus(clone(evidence));
  failedFsyncEvidence.storagePerformance.deterministicCoverage.storageEvidenceSamples[0].fsyncEvidence.tempFile.status = 'failed';
  failedFsyncEvidence.storagePerformance.deterministicCoverage.storageEvidenceSamples[0].correctnessGates[0].status = 'fail';
  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];
  const unsafeDecisions = {
    shortReceiptSet: resolveLargePluginFileBenchmarkProof(shortReceiptSet, { repeatedEvidence }),
    visibleBeforeCommit: resolveLargePluginFileBenchmarkProof(visibleBeforeCommit, { repeatedEvidence }),
    failedFsyncEvidence: resolveLargePluginFileBenchmarkProof(failedFsyncEvidence, { repeatedEvidence }),
    prematurePassStatus: resolveLargePluginFileBenchmarkProof(prematurePassStatus, { repeatedEvidence }),
  };

  assert.equal(safeDecision.updated, true);
  assert.equal(safeDecision.outputEmitted, true);
  assert.deepEqual(safeDecision.blockedBy, []);
  assert.deepEqual(safeDecision.recomputedGates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(unsafeDecisions.shortReceiptSet.updated, false);
  assert.ok(unsafeDecisions.shortReceiptSet.blockedBy.includes('chunk-receipts-cover-large-plugin-files'));
  assert.equal(unsafeDecisions.visibleBeforeCommit.updated, false);
  assert.ok(unsafeDecisions.visibleBeforeCommit.blockedBy.includes('atomic-group-visibility-order'));
  assert.equal(unsafeDecisions.failedFsyncEvidence.updated, false);
  assert.ok(unsafeDecisions.failedFsyncEvidence.blockedBy.includes('filesystem-fsync-before-fast-path-lane'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyLargePluginEvidence(decision);
  }
});

function buildVariant2Proof() {
  const { benchmark, commandReport, evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveLargePluginFileBenchmarkProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeStorageEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'storagePerformance',
  );
  const benchmarkGatesPass = benchmark.gates.every((gate) => gate.status === 'pass');
  const commandShape = commandReportShape(commandReport);
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('benchmark-command-runtime-resources-gates-pass', benchmark.ok
      && benchmarkGatesPass
      && commandShape.reportsRuntime
      && commandShape.reportsResources
      && commandShape.reportsGates
      && commandShape.allGatesPass, {
      benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
      commandGateStatuses: commandShape.gateStatuses,
      durationMs: benchmark.runtime.durationMs,
      heapUsedBytes: benchmark.resources.process.heapUsedBytes,
    }),
    proofGate('storage-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-storage-evidence-fails-closed', Object.values(unsafe).every((decision) => (
      decision.updated === false
        && decision.outputEmitted === false
        && decision.attemptedPassBlocked === true
    )), {
      blockedDecisionHashes: Object.values(unsafe).map((decision) => decision.decisionHash),
    }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicProof = {
    rppId: 'RPP-0736',
    proofId,
    variant: 2,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0716',
      benchmark: benchmark.benchmark,
      variant: benchmark.variant,
      ok: benchmark.ok,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    command: commandShape,
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      workload: workloadProjection(benchmark.resources.workload),
      storage: storageProjection(benchmark.resources.storage),
      chunks: benchmark.resources.chunks,
      bytes: benchmark.resources.bytes,
      process: benchmark.resources.process,
    },
    benchmark: publicBenchmarkProjection(benchmark),
    storagePerformance: {
      ...evidence.storagePerformance,
      outputHash: safeDecision.outputHash,
    },
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyStorageOutput: safeDecision.hashOnlyStorageOutput,
      storageOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-storage-performance',
      rawValueEvidenceLeaks: largePluginEvidenceHasNoRawValues(evidence.storagePerformance) ? 0 : 1,
      publicStoragePerformanceHash: digest(publicStoragePerformanceProjection(evidence)),
      repeatedStoragePerformanceHash: digest(publicStoragePerformanceProjection(repeatedEvidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidencePair() {
  const benchmark = runLargePluginFileBenchmark(benchmarkOptions());
  const repeatedBenchmark = runLargePluginFileBenchmark(benchmarkOptions());
  const commandReport = runBenchmarkCommand();
  const evidence = buildStoragePerformanceEvidence({ benchmark, commandReport });
  const repeatedEvidence = buildStoragePerformanceEvidence({
    benchmark: repeatedBenchmark,
    commandReport,
  });

  recordCorrectnessGates(evidence, repeatedEvidence);
  recordCorrectnessGates(repeatedEvidence, evidence);
  return { benchmark, commandReport, evidence, repeatedEvidence };
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

function runBenchmarkCommand() {
  const stdout = execFileSync(process.execPath, [
    'scripts/bench/large-plugin-file-benchmark.js',
    '--profile=unit',
    `--chunk-size-bytes=${chunkSizeBytes}`,
    `--max-duration-ms=${maxDurationMs}`,
    `--max-heap-used-bytes=${maxHeapUsedBytes}`,
  ], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });

  return JSON.parse(stdout);
}

function buildStoragePerformanceEvidence({ benchmark, commandReport }) {
  const storagePerformance = collectStoragePerformanceEvidence({ benchmark, commandReport });
  return {
    schemaVersion: 1,
    rppId: 'RPP-0736',
    proofId,
    variant: 2,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0716',
      benchmark: benchmark.benchmark,
      variant: benchmark.variant,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    correctnessGates: [],
    storagePerformance,
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      process: benchmark.resources.process,
    },
    release: supportOnlyReleasePosture(),
  };
}

function collectStoragePerformanceEvidence({ benchmark, commandReport }) {
  const deterministicCoverage = benchmark.deterministicCoverage;
  const core = {
    benchmark: {
      id: benchmark.benchmark,
      rppId: benchmark.rppId,
      variant: benchmark.variant,
      profile: benchmark.profile,
      ok: benchmark.ok,
      gateIds: benchmark.gates.map((gate) => gate.id),
      gateStatuses: benchmark.gates.map((gate) => gate.status),
    },
    commandReport: commandReportShape(commandReport),
    workload: workloadProjection(benchmark.resources.workload),
    storage: storageProjection(benchmark.resources.storage),
    chunks: benchmark.resources.chunks,
    fastPathLane: benchmark.resources.fastPathLane,
    bytes: benchmark.resources.bytes,
    atomicGroup: atomicGroupProjection(benchmark.atomicGroup),
    deterministicCoverage: {
      workload: workloadProjection(deterministicCoverage.workload),
      chunks: deterministicCoverage.chunks,
      writes: deterministicCoverage.writes,
      fastPathLane: deterministicCoverage.fastPathLane,
      group: atomicGroupProjection(deterministicCoverage.group),
      bytes: deterministicCoverage.bytes,
      files: deterministicCoverage.files,
      storageEvidenceSamples: deterministicCoverage.evidenceSamples.map(storageEvidenceSampleSummary),
      chunkReceiptSamples: deterministicCoverage.chunkReceiptSamples,
      failures: deterministicCoverage.failures,
      tempLeaks: deterministicCoverage.tempLeaks,
      rawValueEvidenceLeaks: deterministicCoverage.rawValueEvidenceLeaks,
    },
  };

  return {
    ...core,
    storagePerformanceHash: sha256(core),
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeLargePluginFileStorageGates(evidence, repeatedEvidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveLargePluginFileBenchmarkProof(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeLargePluginFileStorageGates(evidence, repeatedEvidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedGateIds);
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
        gateVectorHash: sha256(recomputedGates),
        commandReportHash: evidence.storagePerformance.commandReport.reportHash,
        storagePerformanceHash: evidence.storagePerformance.storagePerformanceHash,
        storageEvidenceHashSetHash: sha256(
          evidence.storagePerformance.deterministicCoverage.storageEvidenceSamples
            .map((sample) => sample.sampleHash),
        ),
        chunkReceiptHashSetHash: sha256(
          evidence.storagePerformance.deterministicCoverage.chunkReceiptSamples
            .map((sample) => sample.receiptKeyHash),
        ),
        releaseStatus: evidence.release.finalReleaseStatus,
      }
    : null;
  const publicDecision = {
    updated: correctnessGatesHold,
    outputEmitted: Boolean(output),
    attemptedPassBlocked: evidence.status === 'passed' && !correctnessGatesHold,
    correctnessGatesHold,
    recordedGateIdsComplete,
    recordedGateStatusesHold,
    hashOnlyStorageOutput: output ? largePluginEvidenceHasNoRawValues(output) : false,
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

function recomputeLargePluginFileStorageGates(evidence, repeatedEvidence) {
  const storagePerformance = evidence.storagePerformance || {};
  const workload = storagePerformance.workload || {};
  const storage = storagePerformance.storage || {};
  const chunks = storagePerformance.chunks || {};
  const fastPathLane = storagePerformance.fastPathLane || {};
  const bytes = storagePerformance.bytes || {};
  const atomicGroup = storagePerformance.atomicGroup || {};
  const deterministicCoverage = storagePerformance.deterministicCoverage || {};
  const storageEvidenceSamples = deterministicCoverage.storageEvidenceSamples || [];
  const command = storagePerformance.commandReport || {};
  const runtime = evidence.runtime || {};
  const processResources = evidence.resources?.process || {};
  const release = evidence.release || {};
  const storagePerformanceHashMatches = storagePerformance.storagePerformanceHash === sha256(
    storagePerformanceCore(storagePerformance),
  );
  const deterministicProjection = Boolean(repeatedEvidence)
    && digest(publicStoragePerformanceProjection(evidence)) === digest(
      publicStoragePerformanceProjection(repeatedEvidence),
    );

  return [
    proofGate('benchmark-command-reports-runtime-resources-gates', command.reportsRuntime === true
      && command.reportsResources === true
      && command.reportsGates === true
      && command.runtimeBeforeResourcesBeforeGates === true
      && command.passFailStatusesOnly === true
      && command.allGatesPass === true
      && command.runtimeResourceGateReported === true, {
      reportsRuntime: command.reportsRuntime,
      reportsResources: command.reportsResources,
      reportsGates: command.reportsGates,
      runtimeBeforeResourcesBeforeGates: command.runtimeBeforeResourcesBeforeGates,
      gateStatuses: command.gateStatuses,
    }),
    proofGate('complete-storage-performance-report', storagePerformanceHashMatches
      && storage.boundary === LARGE_PLUGIN_FILE_BOUNDARY
      && storage.adapter === FILESYSTEM_FSYNC_BOUNDARY
      && storage.guardedWritesAttempted === workload.expectedGuardedWrites
      && storage.stagedWrites === workload.expectedStagingWrites
      && storage.committedWrites === workload.expectedCommitWrites
      && storage.groupFinalizeRecords === 1
      && storage.atomicGroupCommits === 1
      && storageEvidenceSamples.length === workload.expectedGuardedWrites, {
      storagePerformanceHashMatches,
      guardedWritesAttempted: storage.guardedWritesAttempted,
      expectedGuardedWrites: workload.expectedGuardedWrites,
      stagedWrites: storage.stagedWrites,
      committedWrites: storage.committedWrites,
      storageEvidenceSamples: storageEvidenceSamples.length,
    }),
    proofGate('chunk-receipts-cover-large-plugin-files', chunks.receipts === chunks.expectedReceipts
      && chunks.receipts === workload.expectedChunks
      && chunks.bytesReceipted === workload.totalPluginFileBytes
      && chunks.exactPlanScopedReceipts === chunks.expectedReceipts
      && chunks.duplicateReceiptKeys === 0
      && chunks.receiptOnlyResumeSkips === chunks.expectedReceipts
      && chunks.missingReceiptBlocksResume === true
      && chunks.mismatchedReceiptBlocksResume === true
      && deterministicCoverage.chunkReceiptSamples?.length === Math.min(8, chunks.expectedReceipts), {
      receipts: chunks.receipts,
      expectedReceipts: chunks.expectedReceipts,
      bytesReceipted: chunks.bytesReceipted,
      totalPluginFileBytes: workload.totalPluginFileBytes,
      duplicateReceiptKeys: chunks.duplicateReceiptKeys,
      chunkReceiptSamples: deterministicCoverage.chunkReceiptSamples?.length || 0,
    }),
    proofGate('atomic-group-visibility-order', atomicGroup.canonicalVisibleBeforeCommit === false
      && atomicGroup.finalized === true
      && atomicGroup.committed === true
      && atomicGroup.allFilesVisibleAfterCommit === true
      && storage.unsafeLiveVisibleBeforeCommit === 0
      && bytes.liveVisibleBeforeCommitBytes === 0
      && bytes.liveVisibleAfterCommitBytes === workload.totalPluginFileBytes, {
      canonicalVisibleBeforeCommit: atomicGroup.canonicalVisibleBeforeCommit,
      finalized: atomicGroup.finalized,
      committed: atomicGroup.committed,
      unsafeLiveVisibleBeforeCommit: storage.unsafeLiveVisibleBeforeCommit,
      liveVisibleBeforeCommitBytes: bytes.liveVisibleBeforeCommitBytes,
      liveVisibleAfterCommitBytes: bytes.liveVisibleAfterCommitBytes,
    }),
    proofGate('filesystem-fsync-before-fast-path-lane', fastPathLane.updates === workload.expectedGuardedWrites
      && fastPathLane.unsafeUpdatesBeforeGates === 0
      && fastPathLane.updatesWithFailedGate === 0
      && storageEvidenceSamples.every((sample) => (
        sample.boundary === FILESYSTEM_FSYNC_BOUNDARY
          && sample.fsyncEvidence.tempFile.status === 'passed'
          && sample.fsyncEvidence.targetDirectory.status === 'passed'
          && sample.fastPathLane.updated === true
          && sample.fastPathLane.correctnessGatesEvaluatedBeforeUpdate === true
          && sample.correctnessGates.every((gate) => gate.status === 'pass')
      )), {
      fastPathLaneUpdates: fastPathLane.updates,
      expectedGuardedWrites: workload.expectedGuardedWrites,
      unsafeUpdatesBeforeGates: fastPathLane.unsafeUpdatesBeforeGates,
      updatesWithFailedGate: fastPathLane.updatesWithFailedGate,
      storageEvidenceSamples: storageEvidenceSamples.length,
    }),
    proofGate('backpressure-runtime-resource-budget', runtime.durationMs <= runtime.budgets?.maxDurationMs
      && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
      && chunks.maxInFlightUploadBytes <= chunks.maxBufferedUploadBytes
      && chunks.maxUploadConcurrency <= runtime.budgets?.maxUploadConcurrency, {
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
      maxInFlightUploadBytes: chunks.maxInFlightUploadBytes,
      maxBufferedUploadBytes: chunks.maxBufferedUploadBytes,
      maxUploadConcurrency: chunks.maxUploadConcurrency,
    }),
    proofGate('deterministic-storage-performance-evidence', deterministicProjection, {
      firstEvidenceHash: digest(publicStoragePerformanceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicStoragePerformanceProjection(repeatedEvidence)) : '',
    }),
    proofGate('hash-only-storage-performance-evidence', largePluginEvidenceHasNoRawValues({
      command,
      storagePerformance,
    }), {
      rawValueEvidenceLeaks: largePluginEvidenceHasNoRawValues({ command, storagePerformance }) ? 0 : 1,
      storageEvidenceSamples: storageEvidenceSamples.length,
      chunkReceiptSamples: deterministicCoverage.chunkReceiptSamples?.length || 0,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.productionThroughput === 'not-claimed'
      && release.speedClaimsAllowed === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO', {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      productionThroughput: release.productionThroughput,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function unsafeStorageEvidenceDecisions(evidence, repeatedEvidence) {
  const shortReceiptSet = withPassedStatus(clone(evidence));
  shortReceiptSet.storagePerformance.chunks.receipts -= 1;
  shortReceiptSet.storagePerformance.deterministicCoverage.chunkReceiptSamples.pop();

  const visibleBeforeCommit = withPassedStatus(clone(evidence));
  visibleBeforeCommit.storagePerformance.atomicGroup.canonicalVisibleBeforeCommit = true;
  visibleBeforeCommit.storagePerformance.bytes.liveVisibleBeforeCommitBytes = 1024;
  visibleBeforeCommit.storagePerformance.storage.unsafeLiveVisibleBeforeCommit = 1;

  const failedFsyncEvidence = withPassedStatus(clone(evidence));
  failedFsyncEvidence.storagePerformance.deterministicCoverage.storageEvidenceSamples[0].fsyncEvidence.tempFile.status = 'failed';
  failedFsyncEvidence.storagePerformance.deterministicCoverage.storageEvidenceSamples[0].correctnessGates[0].status = 'fail';

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    shortReceiptSet: resolveLargePluginFileBenchmarkProof(shortReceiptSet, { repeatedEvidence }),
    visibleBeforeCommit: resolveLargePluginFileBenchmarkProof(visibleBeforeCommit, { repeatedEvidence }),
    failedFsyncEvidence: resolveLargePluginFileBenchmarkProof(failedFsyncEvidence, { repeatedEvidence }),
    prematurePassStatus: resolveLargePluginFileBenchmarkProof(prematurePassStatus, { repeatedEvidence }),
  };
}

function commandReportShape(report) {
  const rootKeys = Object.keys(report || {});
  const gateStatuses = Array.isArray(report?.gates)
    ? report.gates.map((gate) => gate.status)
    : [];
  const passFailStatusesOnly = gateStatuses.every((status) => status === 'pass' || status === 'fail');
  return {
    benchmark: report?.benchmark || '',
    profile: report?.profile || '',
    ok: report?.ok === true,
    reportsRuntime: typeof report?.runtime?.durationMs === 'number'
      && typeof report?.runtime?.budgets?.maxDurationMs === 'number',
    reportsResources: Boolean(report?.resources?.workload)
      && Boolean(report?.resources?.storage)
      && Boolean(report?.resources?.chunks)
      && Boolean(report?.resources?.process),
    reportsGates: Array.isArray(report?.gates)
      && report.gates.length > 0
      && report.gates.every((gate) => typeof gate.id === 'string' && typeof gate.status === 'string'),
    runtimeBeforeResourcesBeforeGates: rootKeys.indexOf('runtime') !== -1
      && rootKeys.indexOf('resources') !== -1
      && rootKeys.indexOf('gates') !== -1
      && rootKeys.indexOf('runtime') < rootKeys.indexOf('resources')
      && rootKeys.indexOf('resources') < rootKeys.indexOf('gates'),
    runtimeResourceGateReported: Array.isArray(report?.gates)
      && report.gates.some((gate) => gate.id === 'runtime-resource-budget'),
    gateCount: gateStatuses.length,
    gateIds: Array.isArray(report?.gates) ? report.gates.map((gate) => gate.id) : [],
    gateStatuses,
    passFailStatusesOnly,
    allGatesPass: gateStatuses.length > 0 && gateStatuses.every((status) => status === 'pass'),
    reportHash: digest(publicBenchmarkProjection(report)),
  };
}

function publicBenchmarkProjection(report) {
  return {
    rppId: report.rppId,
    benchmark: report.benchmark,
    variant: report.variant,
    profile: report.profile,
    ok: report.ok,
    runtime: {
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
      chunks: report.resources?.chunks,
      bytes: report.resources?.bytes,
      fastPathLane: report.resources?.fastPathLane,
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

function publicStoragePerformanceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    storagePerformance: evidence.storagePerformance,
    release: evidence.release,
  };
}

function storagePerformanceCore(storagePerformance) {
  return {
    benchmark: storagePerformance.benchmark,
    commandReport: storagePerformance.commandReport,
    workload: storagePerformance.workload,
    storage: storagePerformance.storage,
    chunks: storagePerformance.chunks,
    fastPathLane: storagePerformance.fastPathLane,
    bytes: storagePerformance.bytes,
    atomicGroup: storagePerformance.atomicGroup,
    deterministicCoverage: storagePerformance.deterministicCoverage,
  };
}

function workloadProjection(workload) {
  const { atomicGroupId, ...rest } = workload;
  return {
    ...rest,
    atomicGroupIdHash: atomicGroupId ? digest(atomicGroupId) : null,
  };
}

function storageProjection(storage) {
  const { atomicGroupId, ...rest } = storage;
  return {
    ...rest,
    atomicGroupIdHash: atomicGroupId ? digest(atomicGroupId) : null,
  };
}

function atomicGroupProjection(group) {
  const { id, ...rest } = group;
  return {
    ...rest,
    idHash: id ? digest(id) : null,
  };
}

function storageEvidenceSampleSummary(sample) {
  const summary = {
    boundary: sample.boundary,
    adapter: sample.adapter,
    engine: sample.engine,
    operation: sample.operation,
    comparedFields: sample.comparedFields,
    expectedResourceHash: sample.expectedResourceHash,
    expectedStorageHash: sample.expectedStorageHash,
    actualStorageHash: sample.actualStorageHash,
    plannedStorageHash: sample.plannedStorageHash,
    postRenameStorageHash: sample.postRenameStorageHash,
    outcome: sample.outcome,
    sameDirectoryTemp: sample.sameDirectoryTemp,
    compareBeforeRename: sample.compareBeforeRename,
    liveStorageMatched: sample.liveStorageMatched,
    renameAttempted: sample.renameAttempted,
    tempRemovedOnBlockedWrite: sample.tempRemovedOnBlockedWrite,
    atomicVisibilityBoundary: sample.atomicVisibilityBoundary,
    fsyncEvidence: sample.fsyncEvidence,
    correctnessGates: sample.correctnessGates.map((gate) => ({
      id: gate.id,
      status: gate.status,
      blocker: gate.blocker,
      evidenceHash: digest(gate.evidence),
    })),
    fastPathLane: sample.fastPathLane,
    bytesCompared: sample.bytesCompared,
    bytesWrittenToTemp: sample.bytesWrittenToTemp,
    stepsHash: digest(sample.steps),
  };

  return {
    ...summary,
    sampleHash: digest(summary),
  };
}

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: [
      'live-production-service-not-supplied',
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
      'release-verifier-carry-through-not-claimed',
    ],
  };
}

function projectUnsafeDecisions(unsafe) {
  return Object.fromEntries(
    Object.entries(unsafe).map(([name, decision]) => [
      name,
      {
        updated: decision.updated,
        outputEmitted: decision.outputEmitted,
        attemptedPassBlocked: decision.attemptedPassBlocked,
        correctnessGatesHold: decision.correctnessGatesHold,
        blockedBy: decision.blockedBy,
        decisionHash: decision.decisionHash,
      },
    ]),
  );
}

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  return evidence;
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function assertHashOnlyLargePluginEvidence(value) {
  assert.equal(largePluginEvidenceHasNoRawValues(value), true);
}

function largePluginEvidenceHasNoRawValues(value) {
  return !rawLargePluginEvidencePattern().test(JSON.stringify(value));
}

function rawLargePluginEvidencePattern() {
  return /logicalPath|wp-content\/plugins|payments\.php|admin\.js|commerce\.php|catalog\.dat|search-index\.dat|plugin-file-(?:base|planned)-payload|large plugin file raw fixture|install-commerce-stack|plan-rpp-0716|benchmark-large-plugin-file-(?:stage|commit)|"driver"\s*:/i;
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function objectKeyBefore(object, leftKey, rightKey) {
  const keys = Object.keys(object);
  return keys.indexOf(leftKey) !== -1
    && keys.indexOf(rightKey) !== -1
    && keys.indexOf(leftKey) < keys.indexOf(rightKey);
}

function sameArray(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
