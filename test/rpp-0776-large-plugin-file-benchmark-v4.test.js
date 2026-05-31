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

const proofId = 'rpp-0776-large-plugin-file-benchmark-v4';
const previousVariantRppId = 'RPP-0756';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const chunkSizeBytes = 32 * 1024;
const maxDurationMs = 5_000;
const maxHeapUsedBytes = 128 * 1024 * 1024;
const expectedCommandGateCount = 10;
const expectedCorrectnessGateIds = Object.freeze([
  'benchmark-command-reports-runtime-resources-gates',
  'benchmark-command-pass-fail-statuses-only',
  'runtime-resource-budget-reported-and-passing',
  'workload-resource-counts-match',
  'storage-and-receipt-counts-match',
  'hash-count-only-deterministic-evidence',
  'support-only-release-no-go',
]);
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;

test('RPP-0776 variant 4 proves benchmark command reports runtime resources and pass/fail gates', {
  concurrency: false,
}, () => {
  const proof = buildVariant4Proof();

  assert.equal(proof.rppId, 'RPP-0776');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0716');
  assert.equal(proof.builtOn.previousVariantRppId, previousVariantRppId);
  assert.equal(proof.builtOn.previousVariantProofId, 'rpp-0756-large-plugin-file-benchmark-v3');
  assert.equal(proof.builtOn.benchmark, LARGE_PLUGIN_FILE_BENCHMARK_ID);
  assert.equal(proof.builtOn.variant, 1);
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, hexSha256Pattern);

  assert.equal(proof.command.reportsRuntime, true);
  assert.equal(proof.command.reportsResources, true);
  assert.equal(proof.command.reportsGates, true);
  assert.equal(proof.command.runtimeBeforeResourcesBeforeGates, true);
  assert.equal(proof.command.runtimeDurationReported, true);
  assert.equal(proof.command.resourceCountersReported, true);
  assert.equal(proof.command.runtimeResourceGateReported, true);
  assert.equal(proof.command.runtimeResourceGateStatus, 'pass');
  assert.equal(proof.command.passFailStatusesOnly, true);
  assert.equal(proof.command.allGatesPass, true);
  assert.deepEqual(proof.command.gateStatusCounts, { pass: expectedCommandGateCount, fail: 0 });
  assert.equal(proof.command.gateCount, expectedCommandGateCount);
  assert.match(proof.command.gateIdsHash, sha256Pattern);
  assert.match(proof.command.reportHash, hexSha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationReported, true);
  assert.equal(proof.runtime.durationWithinBudget, true);
  assert.equal(proof.runtime.budgets.profile, 'unit');
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
  assert.equal(proof.resources.workload.expectedStagingWrites, 4);
  assert.equal(proof.resources.workload.expectedCommitWrites, 4);
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
  assert.equal(proof.resources.process.heapUsedReported, true);
  assert.equal(proof.resources.process.heapWithinBudget, true);
  assert.equal(proof.resources.process.cpuCountersReported, true);
  assert.equal(proof.resources.process.rssReported, true);

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
  assert.match(proof.deterministicEvidence.fileHashSetHash, sha256Pattern);
  assert.match(proof.deterministicEvidence.storageEvidenceHashSetHash, sha256Pattern);
  assert.match(proof.deterministicEvidence.chunkReceiptHashSetHash, sha256Pattern);
  assert.match(proof.deterministicEvidence.publicEvidenceHash, sha256Pattern);

  assert.deepEqual(proof.correctness.gateIds, expectedCorrectnessGateIds);
  assert.deepEqual(proof.correctness.recomputedGateVector.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.equal(proof.correctness.hashCountOnlyOutput, true);
  assert.match(proof.correctness.outputHash, sha256Pattern);

  assert.equal(proof.unsafe.missingRuntime.updated, false);
  assert.ok(proof.unsafe.missingRuntime.blockedBy.includes('benchmark-command-reports-runtime-resources-gates'));
  assert.equal(proof.unsafe.missingResources.updated, false);
  assert.ok(proof.unsafe.missingResources.blockedBy.includes('benchmark-command-reports-runtime-resources-gates'));
  assert.equal(proof.unsafe.missingGates.updated, false);
  assert.ok(proof.unsafe.missingGates.blockedBy.includes('benchmark-command-reports-runtime-resources-gates'));
  assert.equal(proof.unsafe.nonPassFailGateStatus.updated, false);
  assert.ok(proof.unsafe.nonPassFailGateStatus.blockedBy.includes('benchmark-command-pass-fail-statuses-only'));
  assert.equal(proof.unsafe.failedRuntimeResourceGate.updated, false);
  assert.ok(proof.unsafe.failedRuntimeResourceGate.blockedBy.includes('runtime-resource-budget-reported-and-passing'));
  for (const decision of Object.values(proof.unsafe)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
    assertHashCountOnlyLargePluginEvidence(decision);
  }

  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.equal(proof.redaction.mode, 'hash-count-only-large-plugin-file-command-benchmark');
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.redaction.publicEvidenceHash, sha256Pattern);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashCountOnlyLargePluginEvidence(proof);
});

test('RPP-0776 variant 4 fails closed when command runtime resources or gate statuses are incomplete', {
  concurrency: false,
}, () => {
  const evidence = buildRecordedEvidence();
  const safeDecision = resolveVariant4Proof(evidence);
  const unsafeDecisions = unsafeCommandEvidenceDecisions(evidence);

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
  ]);

  assert.equal(unsafeDecisions.missingRuntime.updated, false);
  assert.ok(unsafeDecisions.missingRuntime.blockedBy.includes(
    'benchmark-command-reports-runtime-resources-gates',
  ));
  assert.equal(unsafeDecisions.missingResources.updated, false);
  assert.ok(unsafeDecisions.missingResources.blockedBy.includes(
    'benchmark-command-reports-runtime-resources-gates',
  ));
  assert.equal(unsafeDecisions.missingGates.updated, false);
  assert.ok(unsafeDecisions.missingGates.blockedBy.includes(
    'benchmark-command-reports-runtime-resources-gates',
  ));
  assert.equal(unsafeDecisions.nonPassFailGateStatus.updated, false);
  assert.ok(unsafeDecisions.nonPassFailGateStatus.blockedBy.includes(
    'benchmark-command-pass-fail-statuses-only',
  ));
  assert.equal(unsafeDecisions.failedRuntimeResourceGate.updated, false);
  assert.ok(unsafeDecisions.failedRuntimeResourceGate.blockedBy.includes(
    'runtime-resource-budget-reported-and-passing',
  ));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
    assertHashCountOnlyLargePluginEvidence(decision);
  }
});

function buildVariant4Proof() {
  const evidence = buildRecordedEvidence();
  const decision = resolveVariant4Proof(evidence);
  const unsafe = unsafeCommandEvidenceDecisions(evidence);
  const proofGates = [
    proofGate('command-runtime-resources-gates-pass', decision.updated
      && evidence.command.reportsRuntime
      && evidence.command.reportsResources
      && evidence.command.reportsGates
      && evidence.command.passFailStatusesOnly
      && evidence.command.runtimeResourceGateStatus === 'pass', {
      gateStatusCounts: evidence.command.gateStatusCounts,
      commandReportHash: evidence.command.reportHash,
    }),
    proofGate('deterministic-hash-count-only-evidence', evidence.deterministicEvidence.match
      && evidence.deterministicEvidence.rawValueEvidenceLeaks === 0
      && evidence.deterministicEvidence.fileHashCount === evidence.resources.workload.pluginFiles
      && evidence.deterministicEvidence.storageEvidenceSampleCount === evidence.resources.workload.expectedGuardedWrites
      && evidence.deterministicEvidence.chunkReceiptSampleCount === Math.min(8, evidence.resources.chunks.expectedReceipts), {
      firstProjectionHash: evidence.deterministicEvidence.firstProjectionHash,
      repeatedProjectionHash: evidence.deterministicEvidence.repeatedProjectionHash,
      publicEvidenceHash: evidence.deterministicEvidence.publicEvidenceHash,
    }),
    proofGate('unsafe-command-evidence-fails-closed', Object.values(unsafe).every((unsafeDecision) => (
      unsafeDecision.updated === false
        && unsafeDecision.outputEmitted === false
        && unsafeDecision.attemptedPassBlocked === true
    )), {
      blockedDecisionHashes: Object.values(unsafe).map((unsafeDecision) => unsafeDecision.decisionHash),
    }),
    proofGate('support-only-release-no-go', evidence.release.supportOnly === true
      && evidence.release.productionBacked === false
      && evidence.release.finalReleaseStatus === 'NO-GO'
      && evidence.release.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: evidence.release.finalReleaseStatus,
      integrationRecommendation: evidence.release.integrationRecommendation,
    }),
  ];
  const publicProof = {
    rppId: 'RPP-0776',
    proofId,
    variant: 4,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
    command: evidence.command,
    runtime: evidence.runtime,
    resources: evidence.resources,
    deterministicEvidence: evidence.deterministicEvidence,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: decision.recomputedGates,
      correctnessGatesHoldBeforeOutput: decision.correctnessGatesHold,
      outputEmittedAfterGates: decision.outputEmitted,
      hashCountOnlyOutput: decision.hashCountOnlyOutput,
      outputHash: decision.outputHash,
    },
    unsafe,
    gates: proofGates,
    release: evidence.release,
    redaction: {
      mode: 'hash-count-only-large-plugin-file-command-benchmark',
      rawValueEvidenceLeaks: largePluginEvidenceHasNoRawValues({
        command: evidence.command,
        resources: evidence.resources,
        deterministicEvidence: evidence.deterministicEvidence,
        output: decision.output,
      }) ? 0 : 1,
      publicEvidenceHash: evidence.deterministicEvidence.publicEvidenceHash,
      commandReportHash: evidence.command.reportHash,
      laneDecisionHash: decision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidence() {
  const commandReport = runBenchmarkCommand();
  const benchmark = runLargePluginFileBenchmark(benchmarkOptions());
  const repeatedBenchmark = runLargePluginFileBenchmark(benchmarkOptions());
  const command = commandReportShape(commandReport);
  const runtime = runtimeProjection({ report: commandReport, command, benchmark });
  const resources = resourcesProjection(commandReport.resources, commandReport.runtime?.budgets);
  const deterministicEvidence = collectDeterministicEvidence({ benchmark, repeatedBenchmark });
  const evidence = {
    schemaVersion: 1,
    rppId: 'RPP-0776',
    proofId,
    variant: 4,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0716',
      previousVariantRppId,
      previousVariantProofId: 'rpp-0756-large-plugin-file-benchmark-v3',
      benchmark: benchmark.benchmark,
      variant: benchmark.variant,
      ok: benchmark.ok,
      evidenceHash: digest(hashCountBenchmarkProjection(benchmark)),
    },
    command,
    runtime,
    resources,
    deterministicEvidence,
    correctnessGates: [],
    release: supportOnlyReleasePosture(),
  };

  recordCorrectnessGates(evidence);
  return evidence;
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

function recordCorrectnessGates(evidence) {
  const gates = recomputeVariant4Gates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveVariant4Proof(evidence) {
  const recomputedGates = recomputeVariant4Gates(evidence);
  const failedGateIds = recomputedGates
    .filter((gate) => gate.status !== 'pass')
    .map((gate) => gate.id);
  const recordedGateIds = Array.isArray(evidence.correctnessGates)
    ? evidence.correctnessGates.map((gate) => gate.id)
    : [];
  const recordedGateIdsComplete = sameArray(recordedGateIds, expectedCorrectnessGateIds);
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
        commandReportHash: evidence.command.reportHash,
        commandGateIdsHash: evidence.command.gateIdsHash,
        runtimeBudgetHash: evidence.runtime.budgetHash,
        workloadHash: evidence.deterministicEvidence.workloadHash,
        fileHashSetHash: evidence.deterministicEvidence.fileHashSetHash,
        storageEvidenceHashSetHash: evidence.deterministicEvidence.storageEvidenceHashSetHash,
        chunkReceiptHashSetHash: evidence.deterministicEvidence.chunkReceiptHashSetHash,
        publicEvidenceHash: evidence.deterministicEvidence.publicEvidenceHash,
        commandGateCount: evidence.command.gateCount,
        commandPassGateCount: evidence.command.gateStatusCounts.pass,
        commandFailGateCount: evidence.command.gateStatusCounts.fail,
        pluginFileCount: evidence.resources.workload.pluginFiles,
        chunkReceiptCount: evidence.resources.chunks.receipts,
        guardedWritesAttempted: evidence.resources.storage.guardedWritesAttempted,
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

function recomputeVariant4Gates(evidence) {
  const command = evidence.command || {};
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const workload = resources.workload || {};
  const storage = resources.storage || {};
  const chunks = resources.chunks || {};
  const processResources = resources.process || {};
  const deterministicEvidence = evidence.deterministicEvidence || {};
  const release = evidence.release || {};

  return [
    proofGate('benchmark-command-reports-runtime-resources-gates', command.reportsRuntime === true
      && command.reportsResources === true
      && command.reportsGates === true
      && command.runtimeBeforeResourcesBeforeGates === true
      && command.runtimeDurationReported === true
      && command.resourceCountersReported === true, {
      reportsRuntime: command.reportsRuntime,
      reportsResources: command.reportsResources,
      reportsGates: command.reportsGates,
      runtimeBeforeResourcesBeforeGates: command.runtimeBeforeResourcesBeforeGates,
      runtimeDurationReported: command.runtimeDurationReported,
      resourceCountersReported: command.resourceCountersReported,
    }),
    proofGate('benchmark-command-pass-fail-statuses-only', command.passFailStatusesOnly === true
      && command.gateCount === expectedCommandGateCount
      && command.gateStatusCounts?.pass === expectedCommandGateCount
      && command.gateStatusCounts?.fail === 0
      && command.allGatesPass === true, {
      gateCount: command.gateCount,
      gateStatusCounts: command.gateStatusCounts,
      allGatesPass: command.allGatesPass,
    }),
    proofGate('runtime-resource-budget-reported-and-passing', command.runtimeResourceGateReported === true
      && command.runtimeResourceGateStatus === 'pass'
      && runtime.durationReported === true
      && runtime.durationWithinBudget === true
      && processResources.heapUsedReported === true
      && processResources.heapWithinBudget === true, {
      runtimeResourceGateReported: command.runtimeResourceGateReported,
      runtimeResourceGateStatus: command.runtimeResourceGateStatus,
      durationReported: runtime.durationReported,
      durationWithinBudget: runtime.durationWithinBudget,
      heapUsedReported: processResources.heapUsedReported,
      heapWithinBudget: processResources.heapWithinBudget,
    }),
    proofGate('workload-resource-counts-match', workload.pluginFiles === 4
      && workload.totalPluginFileBytes === 229_376
      && workload.largestPluginFileBytes === 131_072
      && workload.chunkSizeBytes === chunkSizeBytes
      && workload.expectedChunks === 8
      && workload.expectedGuardedWrites === 8
      && workload.expectedStagingWrites === 4
      && workload.expectedCommitWrites === 4, {
      pluginFiles: workload.pluginFiles,
      totalPluginFileBytes: workload.totalPluginFileBytes,
      largestPluginFileBytes: workload.largestPluginFileBytes,
      expectedChunks: workload.expectedChunks,
      expectedGuardedWrites: workload.expectedGuardedWrites,
    }),
    proofGate('storage-and-receipt-counts-match', storage.boundaryHash === digest(LARGE_PLUGIN_FILE_BOUNDARY)
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
      && chunks.maxInFlightWithinBufferedBudget === true, {
      guardedWritesAttempted: storage.guardedWritesAttempted,
      stagedWrites: storage.stagedWrites,
      committedWrites: storage.committedWrites,
      receipts: chunks.receipts,
      expectedReceipts: chunks.expectedReceipts,
      duplicateReceiptKeys: chunks.duplicateReceiptKeys,
    }),
    proofGate('hash-count-only-deterministic-evidence', deterministicEvidence.match === true
      && deterministicEvidence.profile === 'unit'
      && deterministicEvidence.fileHashCount === workload.pluginFiles
      && deterministicEvidence.storageEvidenceSampleCount === workload.expectedGuardedWrites
      && deterministicEvidence.chunkReceiptSampleCount === Math.min(8, chunks.expectedReceipts)
      && deterministicEvidence.rawValueEvidenceLeaks === 0
      && deterministicEvidence.tempLeaks === 0
      && deterministicEvidence.firstProjectionHash === deterministicEvidence.repeatedProjectionHash
      && largePluginEvidenceHasNoRawValues(deterministicEvidence), {
      match: deterministicEvidence.match,
      fileHashCount: deterministicEvidence.fileHashCount,
      storageEvidenceSampleCount: deterministicEvidence.storageEvidenceSampleCount,
      chunkReceiptSampleCount: deterministicEvidence.chunkReceiptSampleCount,
      rawValueEvidenceLeaks: deterministicEvidence.rawValueEvidenceLeaks,
      tempLeaks: deterministicEvidence.tempLeaks,
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

function unsafeCommandEvidenceDecisions(evidence) {
  const missingRuntime = withPassedStatus(clone(evidence));
  missingRuntime.command.reportsRuntime = false;
  missingRuntime.command.runtimeBeforeResourcesBeforeGates = false;
  missingRuntime.command.runtimeDurationReported = false;
  missingRuntime.runtime.durationReported = false;

  const missingResources = withPassedStatus(clone(evidence));
  missingResources.command.reportsResources = false;
  missingResources.command.resourceCountersReported = false;
  missingResources.resources.process.heapUsedReported = false;

  const missingGates = withPassedStatus(clone(evidence));
  missingGates.command.reportsGates = false;
  missingGates.command.gateCount = 0;
  missingGates.command.gateStatusCounts = { pass: 0, fail: 0 };
  missingGates.command.allGatesPass = false;

  const nonPassFailGateStatus = withPassedStatus(clone(evidence));
  nonPassFailGateStatus.command.passFailStatusesOnly = false;
  nonPassFailGateStatus.command.gateStatusCounts = { pass: 9, fail: 0, skipped: 1 };
  nonPassFailGateStatus.command.allGatesPass = false;

  const failedRuntimeResourceGate = withPassedStatus(clone(evidence));
  failedRuntimeResourceGate.command.runtimeResourceGateStatus = 'fail';
  failedRuntimeResourceGate.command.allGatesPass = false;
  failedRuntimeResourceGate.command.gateStatusCounts = { pass: 9, fail: 1 };
  failedRuntimeResourceGate.runtime.durationWithinBudget = false;

  return {
    missingRuntime: resolveVariant4Proof(missingRuntime),
    missingResources: resolveVariant4Proof(missingResources),
    missingGates: resolveVariant4Proof(missingGates),
    nonPassFailGateStatus: resolveVariant4Proof(nonPassFailGateStatus),
    failedRuntimeResourceGate: resolveVariant4Proof(failedRuntimeResourceGate),
  };
}

function commandReportShape(report) {
  const rootKeys = Object.keys(report || {});
  const runtimeIndex = rootKeys.indexOf('runtime');
  const resourcesIndex = rootKeys.indexOf('resources');
  const gatesIndex = rootKeys.indexOf('gates');
  const gates = Array.isArray(report?.gates) ? report.gates : [];
  const gateStatuses = gates.map((gate) => gate.status);
  const runtimeResourceGate = gates.find((gate) => gate.id === 'runtime-resource-budget');
  const processResources = report?.resources?.process || {};
  const commandProjection = hashCountCommandProjection(report);

  return {
    reportsRuntime: Boolean(report?.runtime && typeof report.runtime === 'object'),
    reportsResources: Boolean(report?.resources && typeof report.resources === 'object'),
    reportsGates: Array.isArray(report?.gates),
    runtimeBeforeResourcesBeforeGates: runtimeIndex !== -1
      && resourcesIndex !== -1
      && gatesIndex !== -1
      && runtimeIndex < resourcesIndex
      && resourcesIndex < gatesIndex,
    runtimeDurationReported: typeof report?.runtime?.durationMs === 'number',
    resourceCountersReported: typeof processResources.heapUsedBytes === 'number'
      && typeof processResources.maxRssBytes === 'number'
      && typeof processResources.userCpuMs === 'number'
      && typeof processResources.systemCpuMs === 'number',
    runtimeResourceGateReported: Boolean(runtimeResourceGate),
    runtimeResourceGateStatus: runtimeResourceGate?.status || 'missing',
    passFailStatusesOnly: gateStatuses.every((status) => status === 'pass' || status === 'fail'),
    allGatesPass: gates.length > 0 && gateStatuses.every((status) => status === 'pass'),
    gateCount: gates.length,
    gateStatusCounts: gateStatusCounts(gates),
    gateIdsHash: sha256(gates.map((gate) => gate.id)),
    reportHash: digest(commandProjection),
  };
}

function runtimeProjection({ report, command, benchmark }) {
  const budget = report.runtime?.budgets || benchmark.runtime.budgets;
  return {
    generatedAt: benchmark.runtime.generatedAt,
    durationReported: command.runtimeDurationReported,
    durationWithinBudget: typeof report.runtime?.durationMs === 'number'
      && report.runtime.durationMs <= budget.maxDurationMs,
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

function resourcesProjection(resources, runtimeBudget = {}) {
  const chunks = resources?.chunks || {};
  const processResources = resources?.process || {};
  return {
    workload: workloadProjection(resources?.workload || {}),
    storage: storageProjection(resources?.storage || {}),
    chunks: {
      receipts: chunks.receipts,
      expectedReceipts: chunks.expectedReceipts,
      bytesReceipted: chunks.bytesReceipted,
      exactPlanScopedReceipts: chunks.exactPlanScopedReceipts,
      duplicateReceiptKeys: chunks.duplicateReceiptKeys,
      receiptOnlyResumeSkips: chunks.receiptOnlyResumeSkips,
      maxInFlightWithinBufferedBudget: chunks.maxInFlightUploadBytes <= chunks.maxBufferedUploadBytes,
      maxUploadConcurrencyWithinBudget: chunks.maxUploadConcurrency <= runtimeBudget.maxUploadConcurrency,
    },
    process: {
      heapUsedReported: typeof processResources.heapUsedBytes === 'number',
      heapWithinBudget: typeof processResources.heapUsedBytes === 'number'
        && processResources.heapUsedBytes <= runtimeBudget.maxHeapUsedBytes,
      cpuCountersReported: typeof processResources.userCpuMs === 'number'
        && typeof processResources.systemCpuMs === 'number',
      rssReported: typeof processResources.maxRssBytes === 'number',
    },
  };
}

function collectDeterministicEvidence({ benchmark, repeatedBenchmark }) {
  const firstProjection = hashCountBenchmarkProjection(benchmark);
  const repeatedProjection = hashCountBenchmarkProjection(repeatedBenchmark);
  const coverage = benchmark.deterministicCoverage;
  const storageEvidenceHashes = coverage.evidenceSamples.map((sample) => sample.sampleHash);
  const chunkReceiptHashes = coverage.chunkReceiptSamples.map((sample) => sample.receiptKeyHash);
  const fileHashes = coverage.files.map((file) => file.resourceKeyHash);
  const core = {
    source: {
      rppId: 'RPP-0776',
      previousVariantRppId,
      benchmarkHash: digest(benchmark.benchmark),
      benchmarkVariant: benchmark.variant,
    },
    profile: benchmark.profile,
    workload: workloadProjection(benchmark.resources.workload),
    commandGateCount: benchmark.gates.length,
    commandGateStatusCounts: gateStatusCounts(benchmark.gates),
    fileHashCount: fileHashes.length,
    storageEvidenceSampleCount: coverage.evidenceSamples.length,
    chunkReceiptSampleCount: coverage.chunkReceiptSamples.length,
    fileHashSetHash: sha256(fileHashes),
    storageEvidenceHashSetHash: sha256(storageEvidenceHashes),
    chunkReceiptHashSetHash: sha256(chunkReceiptHashes),
    workloadHash: sha256(workloadProjection(benchmark.resources.workload)),
    rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
    tempLeaks: coverage.tempLeaks,
  };

  return {
    ...core,
    match: digest(firstProjection) === digest(repeatedProjection),
    firstProjectionHash: sha256(firstProjection),
    repeatedProjectionHash: sha256(repeatedProjection),
    publicEvidenceHash: sha256(core),
  };
}

function hashCountBenchmarkProjection(report) {
  const coverage = report.deterministicCoverage || {};
  const resources = report.resources || {};
  return {
    schemaVersion: report.schemaVersion,
    rppId: report.rppId,
    benchmarkHash: digest(report.benchmark),
    variant: report.variant,
    profile: report.profile,
    ok: report.ok,
    generatedAt: report.runtime?.generatedAt,
    budgets: report.runtime?.budgets,
    workload: workloadProjection(resources.workload || {}),
    storage: storageProjection(resources.storage || {}),
    chunks: chunkCountProjection(resources.chunks || {}),
    fastPathLane: fastPathLaneProjection(resources.fastPathLane || {}),
    bytes: bytesProjection(resources.bytes || {}),
    atomicGroup: atomicGroupProjection(report.atomicGroup || coverage.group || {}),
    deterministicCoverage: {
      workload: workloadProjection(coverage.workload || resources.workload || {}),
      chunks: chunkCountProjection(coverage.chunks || resources.chunks || {}),
      writes: writeCountProjection(coverage.writes || {}),
      fastPathLane: fastPathLaneProjection(coverage.fastPathLane || resources.fastPathLane || {}),
      group: atomicGroupProjection(coverage.group || report.atomicGroup || {}),
      bytes: bytesProjection(coverage.bytes || resources.bytes || {}),
      fileHashCount: Array.isArray(coverage.files) ? coverage.files.length : 0,
      fileHashSetHash: sha256((coverage.files || []).map((file) => file.resourceKeyHash)),
      storageEvidenceSampleCount: Array.isArray(coverage.evidenceSamples) ? coverage.evidenceSamples.length : 0,
      storageEvidenceHashSetHash: sha256((coverage.evidenceSamples || []).map((sample) => sample.sampleHash)),
      chunkReceiptSampleCount: Array.isArray(coverage.chunkReceiptSamples) ? coverage.chunkReceiptSamples.length : 0,
      chunkReceiptHashSetHash: sha256((coverage.chunkReceiptSamples || []).map((sample) => sample.receiptKeyHash)),
      failures: Array.isArray(coverage.failures) ? coverage.failures.length : 0,
      tempLeaks: coverage.tempLeaks,
      rawValueEvidenceLeaks: coverage.rawValueEvidenceLeaks,
    },
    gates: {
      count: Array.isArray(report.gates) ? report.gates.length : 0,
      statusCounts: gateStatusCounts(report.gates || []),
      idsHash: sha256((report.gates || []).map((gate) => gate.id)),
    },
  };
}

function hashCountCommandProjection(report) {
  const gates = Array.isArray(report?.gates) ? report.gates : [];
  return {
    schemaVersion: report?.schemaVersion,
    rppId: report?.rppId,
    benchmarkHash: digest(report?.benchmark || ''),
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
    resources: resourcesProjection(report?.resources || {}, report?.runtime?.budgets || {}),
    gates: {
      present: Array.isArray(report?.gates),
      count: gates.length,
      statusCounts: gateStatusCounts(gates),
      idsHash: sha256(gates.map((gate) => gate.id)),
      runtimeResourceGateStatus: gates.find((gate) => gate.id === 'runtime-resource-budget')?.status || 'missing',
    },
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

function writeCountProjection(writes) {
  return {
    attempted: writes.attempted,
    applied: writes.applied,
    appliedFsyncComplete: writes.appliedFsyncComplete,
    appliedFsyncIncomplete: writes.appliedFsyncIncomplete,
    stagingApplied: writes.stagingApplied,
    commitApplied: writes.commitApplied,
    livePreconditionChecks: writes.livePreconditionChecks,
    livePreconditionDrift: writes.livePreconditionDrift,
    unsafeLiveVisibleBeforeCommit: writes.unsafeLiveVisibleBeforeCommit,
    groupFinalizeRecords: writes.groupFinalizeRecords,
    atomicGroupCommits: writes.atomicGroupCommits,
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

function gateStatusCounts(gates) {
  const counts = { pass: 0, fail: 0 };
  for (const gate of gates) {
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

function supportOnlyReleasePosture() {
  return {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: 'not-claimed',
    speedClaimsAllowed: false,
    liveProductionRemoteService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecution: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
  };
}

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  evidence.correctnessGates = expectedCorrectnessGateIds.map((id) => ({
    id,
    status: 'passed',
    evidenceHash: digest({ id, forced: 'unsafe-pass-attempt' }),
  }));
  return evidence;
}

function largePluginEvidenceHasNoRawValues(value) {
  return !JSON.stringify(value).match(
    /plugin-file-(?:base|planned)-payload|large plugin file raw fixture|wp-content\/plugins\/|\/tmp\/reprint-rpp|[A-Za-z]:\\/,
  );
}

function assertHashCountOnlyLargePluginEvidence(value) {
  assert.equal(largePluginEvidenceHasNoRawValues(value), true);
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
