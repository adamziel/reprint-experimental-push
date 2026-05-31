import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGuardedExecutorBenchmark } from '../scripts/bench/guarded-executor-benchmark.js';
import { digest } from '../src/stable-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const proofId = 'rpp-0746-large-upload-chunk-manifest-v3';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const MIB = 1024 * 1024;
const benchmarkOptions = Object.freeze({
  profile: 'unit',
  fileBytes: MIB,
  chunkSizeBytes: 256 * 1024,
  rowCount: 8,
  rowPayloadBytes: 64,
  maxDurationMs: 30_000,
  maxHeapUsedBytes: 256 * MIB,
});
const expectedGateIds = Object.freeze([
  'benchmark-command-reports-runtime-resources-gates',
  'complete-large-upload-chunk-manifest',
  'contiguous-byte-range-coverage',
  'durable-receipts-cover-manifest',
  'chunk-hash-verification-passed',
  'receipt-only-resume-uses-manifest',
  'duplicate-free-replay-from-manifest',
  'unit-runtime-resource-budget',
  'deterministic-manifest-storage-evidence',
  'hash-only-manifest-storage-evidence',
  'support-only-release-no-go',
]);
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const hexSha256Pattern = /^[a-f0-9]{64}$/;
let recordedEvidencePair;

test('RPP-0746 variant 3 proves large upload chunk manifest benchmark gates', {
  concurrency: false,
}, () => {
  const proof = buildVariant3Proof();

  assert.equal(proof.rppId, 'RPP-0746');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 3);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0726');
  assert.equal(proof.builtOn.sourceRppId, 'RPP-0706');
  assert.equal(proof.builtOn.benchmark, 'guarded-executor-benchmark');
  assert.equal(proof.builtOn.sourceGate, 'guarded-transfer-manifest');
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, hexSha256Pattern);

  assert.equal(proof.command.reportsRuntime, true);
  assert.equal(proof.command.reportsResources, true);
  assert.equal(proof.command.reportsPassFailGates, true);
  assert.equal(proof.command.resourcesBeforeGatesBeforeThroughput, true);
  assert.equal(proof.command.runtimeBudgetReported, true);
  assert.equal(proof.command.passFailStatusesOnly, true);
  assert.equal(proof.command.gateCount, 12);
  assert.equal(proof.command.summary.passed, 9);
  assert.equal(proof.command.summary.blocked, 3);
  assert.equal(proof.command.summary.failed, 0);
  assert.equal(proof.command.summary.speedClaimsAllowed, false);
  assert.deepEqual([...new Set(proof.command.gateStatuses)], ['passed', 'blocked']);
  assert.match(proof.command.reportHash, hexSha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'unit');
  assert.equal(proof.runtime.budgetStatus, 'passed');
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.transfer.fileBytes, benchmarkOptions.fileBytes);
  assert.equal(proof.resources.transfer.chunkSizeBytes, benchmarkOptions.chunkSizeBytes);
  assert.equal(proof.resources.transfer.chunkCount, 4);
  assert.equal(proof.resources.transfer.bytesMovedThroughStaging, benchmarkOptions.fileBytes);
  assert.equal(proof.resources.transfer.chunkReceipts, 4);
  assert.equal(proof.resources.storage.receiptBackend, 'lab-file-journal-receipts');
  assert.equal(proof.resources.storage.productionBacked, false);
  assert.match(proof.resources.transfer.planIdHash, hexSha256Pattern);
  assert.match(proof.resources.transfer.resourceKeyHash, hexSha256Pattern);
  assert.match(proof.resources.transfer.chunkManifestDigestHash, hexSha256Pattern);
  assert.match(proof.resources.transfer.finalizedHashHash, hexSha256Pattern);

  assert.equal(proof.chunkManifest.status, 'passed');
  assert.equal(proof.chunkManifest.complete, true);
  assert.equal(proof.chunkManifest.durableRecordType, 'chunk-manifest-finalized');
  assert.equal(proof.chunkManifest.chunkCount, 4);
  assert.equal(proof.chunkManifest.entryCount, 4);
  assert.equal(proof.chunkManifest.fileBytes, benchmarkOptions.fileBytes);
  assert.equal(proof.chunkManifest.chunkSizeBytes, benchmarkOptions.chunkSizeBytes);
  assert.equal(proof.chunkManifest.byteRangeCoverage.contiguous, true);
  assert.equal(proof.chunkManifest.byteRangeCoverage.nonOverlapping, true);
  assert.equal(proof.chunkManifest.byteRangeCoverage.coveredBytes, benchmarkOptions.fileBytes);
  assert.equal(proof.chunkManifest.byteRangeCoverage.expectedBytes, benchmarkOptions.fileBytes);
  assert.match(proof.chunkManifest.manifestDigestHash, hexSha256Pattern);
  assert.match(proof.chunkManifest.entryDigest, sha256Pattern);
  assert.match(proof.chunkManifest.manifestEvidenceHash, sha256Pattern);
  assert.equal(proof.chunkManifest.entries.length, 4);
  assert.equal(proof.chunkManifest.entries.every((entry) => entry.canonicalVisible === false), true);
  assert.equal(proof.chunkManifest.entries.at(-1).offsetBytes, 786_432);

  assert.equal(proof.storagePerformance.receipts.expected, 4);
  assert.equal(proof.storagePerformance.receipts.recorded, 4);
  assert.equal(proof.storagePerformance.receipts.receiptKeysUnique, true);
  assert.equal(proof.storagePerformance.receipts.everyReceiptPlanScoped, true);
  assert.equal(proof.storagePerformance.receipts.canonicalVisibleBeforeFinalize, false);
  assert.equal(proof.storagePerformance.hashVerification.status, 'passed');
  assert.equal(proof.storagePerformance.hashVerification.verifiedChunkCount, 4);
  assert.equal(proof.storagePerformance.hashVerification.totalBytesVerified, benchmarkOptions.fileBytes);
  assert.equal(proof.storagePerformance.hashVerification.allChunksMatchManifest, true);
  assert.equal(proof.storagePerformance.hashVerification.assembledHashMatchesFinalized, true);
  assert.equal(
    proof.storagePerformance.hashVerification.verifiedEntries.every((entry) => entry.digestMatches === true),
    true,
  );
  assert.equal(proof.storagePerformance.resume.status, 'passed');
  assert.equal(proof.storagePerformance.resume.receiptOnlyResumeSafe, true);
  assert.equal(proof.storagePerformance.resume.chunksSkippedByReceipt, 4);
  assert.equal(proof.storagePerformance.resume.chunksToUpload, 0);
  assert.equal(proof.storagePerformance.resume.bytesSkippedByReceipt, benchmarkOptions.fileBytes);
  assert.equal(proof.storagePerformance.resume.bytesToUpload, 0);
  assert.equal(proof.storagePerformance.resume.duplicateChunkBytes, 0);
  assert.equal(proof.storagePerformance.resume.duplicateMutationWork, 0);
  assert.equal(proof.storagePerformance.replay.status, 'passed');
  assert.equal(proof.storagePerformance.replay.idempotentReplaySafe, true);
  assert.equal(proof.storagePerformance.replay.attemptedReplayCount, 4);
  assert.equal(proof.storagePerformance.replay.idempotentSkips, 4);
  assert.equal(proof.storagePerformance.replay.duplicateReceiptRecordsWritten, 0);
  assert.equal(proof.storagePerformance.replay.bytesRewrittenDuringReplay, 0);
  assert.equal(proof.storagePerformance.replay.duplicateMutationWork, 0);
  assert.equal(proof.storagePerformance.visibility.finalizedRecordPresent, true);
  assert.equal(proof.storagePerformance.visibility.canonicalVisibleBeforePublish, false);
  assert.equal(proof.storagePerformance.visibility.livePathChangesOnlyAfterFinalize, true);
  assert.equal(proof.storagePerformance.rolloutSafetyGate.id, 'guarded-transfer-manifest');
  assert.equal(proof.storagePerformance.rolloutSafetyGate.status, 'passed');
  assert.equal(proof.storagePerformance.rolloutSafetyGate.speedClaimBlocker, null);
  assert.deepEqual(proof.storagePerformance.productionBlockers, [
    'production-storage-receipts-not-measured',
    'production-row-batch-executor-not-measured',
    'production-atomic-group-commit-not-measured',
  ]);
  assert.match(proof.storagePerformance.storagePerformanceHash, sha256Pattern);
  assert.match(proof.storagePerformance.outputHash, sha256Pattern);

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
    'pass',
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.manifestOutputEmittedAfterGates, true);
  assert.equal(proof.correctness.hashOnlyManifestOutput, true);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.missingManifest.updated, false);
  assert.equal(proof.unsafe.missingManifest.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.missingManifest.blockedBy.includes('complete-large-upload-chunk-manifest'));
  assert.equal(proof.unsafe.shortReceiptSet.updated, false);
  assert.equal(proof.unsafe.shortReceiptSet.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.shortReceiptSet.blockedBy.includes('durable-receipts-cover-manifest'));
  assert.equal(proof.unsafe.nonContiguousRange.updated, false);
  assert.equal(proof.unsafe.nonContiguousRange.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.nonContiguousRange.blockedBy.includes('contiguous-byte-range-coverage'));
  assert.equal(proof.unsafe.failedHashVerification.updated, false);
  assert.equal(proof.unsafe.failedHashVerification.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.failedHashVerification.blockedBy.includes('chunk-hash-verification-passed'));
  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.equal(proof.unsafe.overBudget.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.overBudget.blockedBy.includes('unit-runtime-resource-budget'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.equal(proof.unsafe.prematurePassStatus.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashOnlyLargeUploadManifestEvidence(proof);
});

test('RPP-0746 variant 3 fails closed for incomplete, mismatched, stale, and premature manifest evidence', {
  concurrency: false,
}, () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveLargeUploadChunkManifestProof(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeManifestEvidenceDecisions(evidence, repeatedEvidence);

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
    'pass',
    'pass',
  ]);
  assert.equal(unsafeDecisions.missingManifest.updated, false);
  assert.ok(unsafeDecisions.missingManifest.blockedBy.includes('complete-large-upload-chunk-manifest'));
  assert.equal(unsafeDecisions.shortReceiptSet.updated, false);
  assert.ok(unsafeDecisions.shortReceiptSet.blockedBy.includes('durable-receipts-cover-manifest'));
  assert.equal(unsafeDecisions.nonContiguousRange.updated, false);
  assert.ok(unsafeDecisions.nonContiguousRange.blockedBy.includes('contiguous-byte-range-coverage'));
  assert.equal(unsafeDecisions.failedHashVerification.updated, false);
  assert.ok(unsafeDecisions.failedHashVerification.blockedBy.includes('chunk-hash-verification-passed'));
  assert.equal(unsafeDecisions.overBudget.updated, false);
  assert.ok(unsafeDecisions.overBudget.blockedBy.includes('unit-runtime-resource-budget'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
    assertHashOnlyLargeUploadManifestEvidence(decision);
  }
});

function buildVariant3Proof() {
  const { benchmark, commandReport, evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveLargeUploadChunkManifestProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeManifestEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'chunkManifest',
  );
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('benchmark-command-runtime-resources-gates-pass', commandReport.ok !== false
      && evidence.command.reportsRuntime
      && evidence.command.reportsResources
      && evidence.command.reportsPassFailGates
      && evidence.command.passFailStatusesOnly, {
      gateStatuses: evidence.command.gateStatuses,
      durationMs: commandReport.runtime?.durationMs,
      heapUsedBytes: commandReport.resources?.process?.heapUsedBytes,
    }),
    proofGate('manifest-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-manifest-evidence-fails-closed', Object.values(unsafe).every((decision) => (
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
    rppId: 'RPP-0746',
    proofId,
    variant: 3,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0726',
      sourceRppId: 'RPP-0706',
      benchmark: 'guarded-executor-benchmark',
      sourceGate: 'guarded-transfer-manifest',
      ok: benchmark.evidence.guardedTransfer.manifest.complete,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    command: evidence.command,
    runtime: evidence.runtime,
    resources: evidence.resources,
    chunkManifest: evidence.chunkManifest,
    storagePerformance: {
      ...evidence.storagePerformance,
      outputHash: safeDecision.outputHash,
    },
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyManifestOutput: safeDecision.hashOnlyManifestOutput,
      manifestOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-large-upload-chunk-manifest-storage-performance',
      rawValueEvidenceLeaks: largeUploadManifestEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicManifestEvidenceProjection(evidence)),
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

  const benchmark = runGuardedExecutorBenchmark({
    ...benchmarkOptions,
    now: fixedNow,
    tempDir: tempBenchmarkDir('reprint-rpp-0746-manifest-v3-'),
  });
  const repeatedBenchmark = runGuardedExecutorBenchmark({
    ...benchmarkOptions,
    now: fixedNow,
    tempDir: tempBenchmarkDir('reprint-rpp-0746-manifest-v3-repeat-'),
  });
  const commandReport = runBenchmarkCommandReport();
  const evidence = buildLargeUploadChunkManifestEvidence({ benchmark, commandReport });
  const repeatedEvidence = buildLargeUploadChunkManifestEvidence({
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

function buildLargeUploadChunkManifestEvidence({ benchmark, commandReport }) {
  const chunkManifest = buildChunkManifestProjection(benchmark);
  const storagePerformance = buildStoragePerformanceProjection(benchmark);

  return {
    schemaVersion: 1,
    rppId: 'RPP-0746',
    proofId,
    variant: 3,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0726',
      sourceRppId: 'RPP-0706',
      benchmark: 'guarded-executor-benchmark',
      sourceGate: 'guarded-transfer-manifest',
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    command: commandReportShape(commandReport),
    correctnessGates: [],
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      profile: benchmark.runtime.profile,
      durationMs: benchmark.runtime.durationMs,
      budgetStatus: benchmark.runtime.budgetStatus,
      budgets: benchmark.runtime.budgets,
      conservativeBudgetReporting: benchmark.runtime.conservativeBudgetReporting,
    },
    resources: {
      transfer: {
        planIdHash: digest(benchmark.resources.transfer.planId),
        resourceKeyHash: digest(benchmark.resources.transfer.resourceKey),
        stagingBackend: benchmark.resources.transfer.staging,
        fileBytes: benchmark.shape.fileBytes,
        chunkSizeBytes: benchmark.shape.chunkSizeBytes,
        chunkCount: benchmark.shape.chunkCount,
        bytesMovedThroughStaging: benchmark.shape.bytesMovedThroughStaging,
        chunkReceipts: benchmark.resources.transfer.chunkReceipts,
        chunkManifestDigestHash: digest(benchmark.resources.transfer.chunkManifestDigest),
        finalizedHashHash: digest(benchmark.resources.transfer.finalizedHash),
      },
      storage: {
        chunkStaging: benchmark.executorCapabilities.chunkStaging,
        receiptBackend: benchmark.executorCapabilities.fileReceipts,
        productionBacked: false,
      },
      process: benchmark.resources.process,
      runtimeBudget: benchmark.resources.runtimeBudget,
    },
    chunkManifest,
    storagePerformance,
    release: supportOnlyReleasePosture(),
  };
}

function recordCorrectnessGates(evidence, options = {}) {
  const gates = recomputeLargeUploadChunkManifestProofGates(evidence, options);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveLargeUploadChunkManifestProof(evidence, options = {}) {
  const recomputedGates = recomputeLargeUploadChunkManifestProofGates(evidence, options);
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
        commandReportHash: evidence.command.reportHash,
        manifestHash: evidence.chunkManifest.manifestEvidenceHash,
        coverageHash: sha256({
          byteRangeCoverage: evidence.chunkManifest.byteRangeCoverage,
          entries: evidence.chunkManifest.entries,
        }),
        receiptCoverageHash: sha256(evidence.storagePerformance.receipts),
        runtimeBudgetHash: sha256({
          durationMs: evidence.runtime.durationMs,
          heapUsedBytes: evidence.resources.process.heapUsedBytes,
          budgets: evidence.runtime.budgets,
        }),
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
    hashOnlyManifestOutput: output ? largeUploadManifestEvidenceHasNoRawValues(output) : false,
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

function recomputeLargeUploadChunkManifestProofGates(evidence, options = {}) {
  const command = evidence.command || {};
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const processResources = resources.process || {};
  const transfer = resources.transfer || {};
  const manifest = evidence.chunkManifest || {};
  const storage = evidence.storagePerformance || {};
  const receipts = storage.receipts || {};
  const hashVerification = storage.hashVerification || {};
  const resume = storage.resume || {};
  const replay = storage.replay || {};
  const visibility = storage.visibility || {};
  const release = evidence.release || {};
  const rangeMetrics = manifestRangeMetrics(manifest);
  const deterministicMatch = options.repeatedEvidence
    ? digest(manifestDeterministicProjection(evidence))
      === digest(manifestDeterministicProjection(options.repeatedEvidence))
    : false;

  return [
    proofGate('benchmark-command-reports-runtime-resources-gates', command.reportsRuntime === true
      && command.reportsResources === true
      && command.reportsPassFailGates === true
      && command.resourcesBeforeGatesBeforeThroughput === true
      && command.runtimeBudgetReported === true
      && command.passFailStatusesOnly === true
      && command.gateCount === 12
      && command.summary?.passed === 9
      && command.summary?.blocked === 3
      && command.summary?.failed === 0
      && command.summary?.speedClaimsAllowed === false, {
      reportsRuntime: command.reportsRuntime,
      reportsResources: command.reportsResources,
      reportsPassFailGates: command.reportsPassFailGates,
      gateCount: command.gateCount,
      summary: command.summary,
      gateStatuses: command.gateStatuses,
    }),
    proofGate('complete-large-upload-chunk-manifest', manifest.status === 'passed'
      && manifest.complete === true
      && manifest.durableRecordType === 'chunk-manifest-finalized'
      && manifest.chunkCount === transfer.chunkCount
      && manifest.entryCount === transfer.chunkCount
      && manifest.fileBytes === transfer.fileBytes
      && manifest.chunkSizeBytes === transfer.chunkSizeBytes
      && sha256Pattern.test(manifest.entryDigest || '')
      && sha256Pattern.test(manifest.manifestEvidenceHash || ''), {
      manifestStatus: manifest.status,
      complete: manifest.complete,
      durableRecordType: manifest.durableRecordType,
      chunkCount: manifest.chunkCount,
      entryCount: manifest.entryCount,
      transferChunkCount: transfer.chunkCount,
    }),
    proofGate('contiguous-byte-range-coverage', rangeMetrics.valid, rangeMetrics),
    proofGate('durable-receipts-cover-manifest', receipts.expected === manifest.chunkCount
      && receipts.recorded === manifest.chunkCount
      && transfer.chunkReceipts === manifest.chunkCount
      && receipts.receiptKeysUnique === true
      && receipts.everyReceiptPlanScoped === true
      && receipts.canonicalVisibleBeforeFinalize === false
      && visibility.finalizedRecordPresent === true
      && visibility.canonicalVisibleBeforePublish === false
      && visibility.livePathChangesOnlyAfterFinalize === true, {
      expected: receipts.expected,
      recorded: receipts.recorded,
      transferChunkReceipts: transfer.chunkReceipts,
      chunkCount: manifest.chunkCount,
      receiptKeysUnique: receipts.receiptKeysUnique,
      everyReceiptPlanScoped: receipts.everyReceiptPlanScoped,
      visibility,
    }),
    proofGate('chunk-hash-verification-passed', hashVerification.status === 'passed'
      && hashVerification.verifiedChunkCount === manifest.chunkCount
      && hashVerification.totalBytesVerified === manifest.fileBytes
      && hashVerification.allChunksMatchManifest === true
      && hashVerification.assembledHashMatchesFinalized === true
      && sameCoverage(hashVerification.byteRangeCoverage, manifest.byteRangeCoverage)
      && Array.isArray(hashVerification.verifiedEntries)
      && hashVerification.verifiedEntries.length === manifest.chunkCount
      && hashVerification.verifiedEntries.every((entry) => entry.digestMatches === true), {
      status: hashVerification.status,
      verifiedChunkCount: hashVerification.verifiedChunkCount,
      totalBytesVerified: hashVerification.totalBytesVerified,
      allChunksMatchManifest: hashVerification.allChunksMatchManifest,
      assembledHashMatchesFinalized: hashVerification.assembledHashMatchesFinalized,
      verifiedEntryCount: hashVerification.verifiedEntries?.length,
    }),
    proofGate('receipt-only-resume-uses-manifest', resume.status === 'passed'
      && resume.receiptOnlyResumeSafe === true
      && resume.chunksSkippedByReceipt === manifest.chunkCount
      && resume.chunksToUpload === 0
      && resume.bytesSkippedByReceipt === manifest.fileBytes
      && resume.bytesToUpload === 0
      && resume.duplicateChunkBytes === 0
      && resume.duplicateMutationWork === 0
      && resume.missingReceiptBlocksSkip === true
      && resume.mismatchedReceiptBlocksSkip === true, {
      status: resume.status,
      receiptOnlyResumeSafe: resume.receiptOnlyResumeSafe,
      chunksSkippedByReceipt: resume.chunksSkippedByReceipt,
      chunksToUpload: resume.chunksToUpload,
      bytesSkippedByReceipt: resume.bytesSkippedByReceipt,
      bytesToUpload: resume.bytesToUpload,
      duplicateChunkBytes: resume.duplicateChunkBytes,
      duplicateMutationWork: resume.duplicateMutationWork,
    }),
    proofGate('duplicate-free-replay-from-manifest', replay.status === 'passed'
      && replay.idempotentReplaySafe === true
      && replay.chunkCount === manifest.chunkCount
      && replay.attemptedReplayCount === manifest.chunkCount
      && replay.exactReceiptMatches === manifest.chunkCount
      && replay.idempotentSkips === replay.attemptedReplayCount
      && replay.duplicateReceiptRecordsWritten === 0
      && replay.bytesRewrittenDuringReplay === 0
      && replay.duplicateChunkBytes === 0
      && replay.duplicateMutationWork === 0
      && replay.noDuplicateMutationWork === true
      && replay.applyBoundaryOpenedDuringReplay === false
      && replay.failClosed?.missingReceiptRequiresUpload === true
      && replay.failClosed?.mismatchedDigestRejected === true, {
      status: replay.status,
      chunkCount: replay.chunkCount,
      attemptedReplayCount: replay.attemptedReplayCount,
      exactReceiptMatches: replay.exactReceiptMatches,
      idempotentSkips: replay.idempotentSkips,
      duplicateReceiptRecordsWritten: replay.duplicateReceiptRecordsWritten,
      bytesRewrittenDuringReplay: replay.bytesRewrittenDuringReplay,
      duplicateMutationWork: replay.duplicateMutationWork,
    }),
    proofGate('unit-runtime-resource-budget', runtime.profile === 'unit'
      && runtime.budgetStatus === 'passed'
      && runtime.durationMs <= runtime.budgets?.maxDurationMs
      && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
      && transfer.fileBytes === benchmarkOptions.fileBytes
      && transfer.chunkSizeBytes === benchmarkOptions.chunkSizeBytes
      && resources.storage?.productionBacked === false, {
      profile: runtime.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
      fileBytes: transfer.fileBytes,
      chunkSizeBytes: transfer.chunkSizeBytes,
      productionBacked: resources.storage?.productionBacked,
    }),
    proofGate('deterministic-manifest-storage-evidence', deterministicMatch, {
      currentHash: digest(manifestDeterministicProjection(evidence)),
      repeatedHash: options.repeatedEvidence
        ? digest(manifestDeterministicProjection(options.repeatedEvidence))
        : null,
    }),
    proofGate('hash-only-manifest-storage-evidence', largeUploadManifestEvidenceHasNoRawValues({
      command,
      runtime,
      resources,
      chunkManifest: manifest,
      storagePerformance: storage,
    }), {
      rawValueEvidenceLeaks: largeUploadManifestEvidenceHasNoRawValues({
        command,
        runtime,
        resources,
        chunkManifest: manifest,
        storagePerformance: storage,
      }) ? 0 : 1,
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

function unsafeManifestEvidenceDecisions(evidence, repeatedEvidence) {
  const missingManifest = withPassedStatus(clone(evidence));
  missingManifest.chunkManifest.status = 'failed';
  missingManifest.chunkManifest.complete = false;
  missingManifest.chunkManifest.durableRecordType = null;
  missingManifest.storagePerformance.rolloutSafetyGate.status = 'failed';
  missingManifest.storagePerformance.rolloutSafetyGate.speedClaimBlocker = 'missing-durable-chunk-manifest';

  const shortReceiptSet = withPassedStatus(clone(evidence));
  shortReceiptSet.storagePerformance.receipts.recorded -= 1;
  shortReceiptSet.resources.transfer.chunkReceipts -= 1;

  const nonContiguousRange = withPassedStatus(clone(evidence));
  nonContiguousRange.chunkManifest.byteRangeCoverage.contiguous = false;
  nonContiguousRange.chunkManifest.byteRangeCoverage.coveredBytes -= 1;
  nonContiguousRange.chunkManifest.entries[1].offsetBytes += 1;
  nonContiguousRange.storagePerformance.hashVerification.byteRangeCoverage.contiguous = false;

  const failedHashVerification = withPassedStatus(clone(evidence));
  failedHashVerification.storagePerformance.hashVerification.status = 'failed';
  failedHashVerification.storagePerformance.hashVerification.allChunksMatchManifest = false;
  failedHashVerification.storagePerformance.hashVerification.verifiedEntries[0].digestMatches = false;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    missingManifest: resolveLargeUploadChunkManifestProof(missingManifest, { repeatedEvidence }),
    shortReceiptSet: resolveLargeUploadChunkManifestProof(shortReceiptSet, { repeatedEvidence }),
    nonContiguousRange: resolveLargeUploadChunkManifestProof(nonContiguousRange, { repeatedEvidence }),
    failedHashVerification: resolveLargeUploadChunkManifestProof(failedHashVerification, { repeatedEvidence }),
    overBudget: resolveLargeUploadChunkManifestProof(overBudget, { repeatedEvidence }),
    prematurePassStatus: resolveLargeUploadChunkManifestProof(prematurePassStatus, { repeatedEvidence }),
  };
}

function buildChunkManifestProjection(report) {
  const manifest = report.evidence.guardedTransfer.manifest;
  const projection = {
    status: manifest.status,
    complete: manifest.complete,
    durableRecordType: manifest.durableRecordType,
    manifestDigestHash: digest(manifest.manifestDigest),
    chunkCount: manifest.chunkCount,
    chunkSizeBytes: manifest.chunkSizeBytes,
    fileBytes: manifest.fileBytes,
    entryCount: manifest.entries.length,
    byteRangeCoverage: manifest.byteRangeCoverage,
    entries: manifest.entries.map(publicManifestEntry),
  };

  projection.entryDigest = sha256(projection.entries);
  projection.manifestEvidenceHash = sha256(projection);
  return projection;
}

function buildStoragePerformanceProjection(report) {
  const guardedTransfer = report.evidence.guardedTransfer;
  const rolloutSafetyGate = report.rolloutSafetyGates.gates.find((gate) =>
    gate.id === 'guarded-transfer-manifest');
  const projection = {
    receipts: guardedTransfer.receipts,
    hashVerification: projectHashVerification(guardedTransfer.hashVerification),
    resume: projectResume(guardedTransfer.resume),
    replay: projectReplay(guardedTransfer.replayIdempotency),
    visibility: guardedTransfer.visibility,
    rolloutSafetyGate: projectRolloutSafetyGate(rolloutSafetyGate),
    productionBlockers: report.rolloutSafetyGates.summary.blockers,
  };

  projection.storagePerformanceHash = sha256(storagePerformanceCore(projection));
  return projection;
}

function commandReportShape(report) {
  const rootKeys = Object.keys(report);
  const gateStatuses = Array.isArray(report.rolloutSafetyGates?.gates)
    ? report.rolloutSafetyGates.gates.map((gate) => gate.status)
    : [];

  return {
    reportsRuntime: typeof report.runtime?.durationMs === 'number'
      && typeof report.runtime?.budgets?.maxDurationMs === 'number',
    reportsResources: typeof report.resources?.process?.heapUsedBytes === 'number'
      && typeof report.resources?.transfer?.chunkReceipts === 'number',
    reportsPassFailGates: Array.isArray(report.rolloutSafetyGates?.gates)
      && report.rolloutSafetyGates.gates.length > 0
      && typeof report.rolloutSafetyGates?.summary?.passed === 'number'
      && typeof report.rolloutSafetyGates?.summary?.blocked === 'number'
      && typeof report.rolloutSafetyGates?.summary?.failed === 'number',
    resourcesBeforeGatesBeforeThroughput: rootKeys.indexOf('resources') !== -1
      && rootKeys.indexOf('rolloutSafetyGates') !== -1
      && rootKeys.indexOf('throughput') !== -1
      && rootKeys.indexOf('resources') < rootKeys.indexOf('rolloutSafetyGates')
      && rootKeys.indexOf('rolloutSafetyGates') < rootKeys.indexOf('throughput'),
    runtimeBudgetReported: report.runtime?.budgetStatus === 'passed'
      && report.evidence?.runtimeBudget?.status === 'passed'
      && report.resources?.runtimeBudget?.profile === report.runtime?.profile,
    passFailStatusesOnly: gateStatuses.every((status) =>
      ['passed', 'blocked', 'failed'].includes(status)),
    gateIds: report.rolloutSafetyGates?.gates?.map((gate) => gate.id) || [],
    gateStatuses,
    gateCount: gateStatuses.length,
    summary: report.rolloutSafetyGates?.summary || null,
    reportHash: digest(publicCommandProjection(report)),
  };
}

function runBenchmarkCommandReport() {
  const stdout = execFileSync(process.execPath, [
    'scripts/bench/guarded-executor-benchmark.js',
    '--profile=unit',
    `--file-bytes=${benchmarkOptions.fileBytes}`,
    `--chunk-size-bytes=${benchmarkOptions.chunkSizeBytes}`,
    `--row-count=${benchmarkOptions.rowCount}`,
    `--row-payload-bytes=${benchmarkOptions.rowPayloadBytes}`,
    `--max-duration-ms=${benchmarkOptions.maxDurationMs}`,
    `--max-heap-used-bytes=${benchmarkOptions.maxHeapUsedBytes}`,
    `--temp-dir=${tempBenchmarkDir('reprint-rpp-0746-manifest-v3-cli-')}`,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * MIB,
  });

  return JSON.parse(stdout);
}

function projectHashVerification(hashVerification) {
  return {
    status: hashVerification.status,
    verifiedChunkCount: hashVerification.verifiedChunkCount,
    totalBytesVerified: hashVerification.totalBytesVerified,
    allChunksMatchManifest: hashVerification.allChunksMatchManifest,
    assembledHashHash: digest(hashVerification.assembledHash),
    assembledHashMatchesFinalized: hashVerification.assembledHashMatchesFinalized,
    byteRangeCoverage: hashVerification.byteRangeCoverage,
    verifiedEntries: hashVerification.verifiedEntries,
  };
}

function projectResume(resume) {
  return {
    status: resume.status,
    receiptOnlyResumeSafe: resume.receiptOnlyResumeSafe,
    chunksSkippedByReceipt: resume.chunksSkippedByReceipt,
    chunksToUpload: resume.chunksToUpload,
    bytesSkippedByReceipt: resume.bytesSkippedByReceipt,
    bytesToUpload: resume.bytesToUpload,
    duplicateChunkBytes: resume.duplicateChunkBytes,
    duplicateMutationWork: resume.duplicateMutationWork,
    mutationWorkReplayedBeforeFinalize: resume.mutationWorkReplayedBeforeFinalize,
    missingReceiptBlocksSkip: resume.missingReceiptBlocksSkip,
    mismatchedReceiptBlocksSkip: resume.mismatchedReceiptBlocksSkip,
    resumeCursorFields: resume.resumeCursorFields,
  };
}

function projectReplay(replay) {
  return {
    proofId: replay.proofId,
    variant: replay.variant,
    status: replay.status,
    replayScope: replay.replayScope,
    chunkCount: replay.chunkCount,
    replayAttemptsPerChunk: replay.replayAttemptsPerChunk,
    attemptedReplayCount: replay.attemptedReplayCount,
    exactReceiptMatches: replay.exactReceiptMatches,
    idempotentSkips: replay.idempotentSkips,
    idempotentReplaySafe: replay.idempotentReplaySafe,
    duplicateReceiptRecordsWritten: replay.receipts.duplicateReceiptRecordsWritten,
    bytesRewrittenDuringReplay: replay.bytes.bytesRewrittenDuringReplay,
    duplicateChunkBytes: replay.bytes.duplicateChunkBytes,
    applyBoundaryOpenedDuringReplay: replay.mutationWork.applyBoundaryOpenedDuringReplay,
    duplicateMutationWork: replay.mutationWork.duplicateMutationWork,
    noDuplicateMutationWork: replay.mutationWork.noDuplicateMutationWork,
    failClosed: replay.failClosed,
    sampleReplayDecisions: replay.sampleReplayDecisions,
    redaction: replay.redaction,
    evidenceHash: replay.evidenceHash,
  };
}

function projectRolloutSafetyGate(gate) {
  return {
    id: gate.id,
    status: gate.status,
    speedClaimBlocker: gate.speedClaimBlocker,
    evidenceHash: digest(gate.evidence),
  };
}

function publicManifestEntry(entry) {
  return {
    chunkIndex: entry.chunkIndex,
    offsetBytes: entry.offsetBytes,
    sizeBytes: entry.sizeBytes,
    chunkDigest: entry.chunkDigest,
    localResourceHashHash: digest(entry.localResourceHash),
    idempotencyKeyHash: digest(entry.idempotencyKey),
    receiptKeyHash: digest(entry.receiptKey),
    canonicalVisible: entry.canonicalVisible,
  };
}

function manifestRangeMetrics(manifest) {
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const coverage = manifest.byteRangeCoverage || {};
  const errors = [];
  let expectedOffset = 0;

  entries.forEach((entry, index) => {
    if (entry.chunkIndex !== index) {
      errors.push(`entry ${index} has chunkIndex ${entry.chunkIndex}`);
    }
    if (entry.offsetBytes !== expectedOffset) {
      errors.push(`entry ${index} starts at ${entry.offsetBytes}, expected ${expectedOffset}`);
    }
    if (entry.sizeBytes <= 0) {
      errors.push(`entry ${index} has non-positive size`);
    }
    expectedOffset = entry.offsetBytes + entry.sizeBytes;
  });

  return {
    valid: coverage.contiguous === true
      && coverage.nonOverlapping === true
      && coverage.coveredBytes === manifest.fileBytes
      && coverage.expectedBytes === manifest.fileBytes
      && expectedOffset === manifest.fileBytes
      && entries.length === manifest.chunkCount
      && errors.length === 0,
    contiguous: coverage.contiguous,
    nonOverlapping: coverage.nonOverlapping,
    coveredBytes: coverage.coveredBytes,
    expectedBytes: coverage.expectedBytes,
    finalOffset: expectedOffset,
    fileBytes: manifest.fileBytes,
    entryCount: entries.length,
    chunkCount: manifest.chunkCount,
    errors,
  };
}

function sameCoverage(left, right) {
  return left?.contiguous === right?.contiguous
    && left?.nonOverlapping === right?.nonOverlapping
    && left?.coveredBytes === right?.coveredBytes
    && left?.expectedBytes === right?.expectedBytes;
}

function storagePerformanceCore(storagePerformance) {
  return {
    receipts: storagePerformance.receipts,
    hashVerification: storagePerformance.hashVerification,
    resume: storagePerformance.resume,
    replay: storagePerformance.replay,
    visibility: storagePerformance.visibility,
    rolloutSafetyGate: storagePerformance.rolloutSafetyGate,
    productionBlockers: storagePerformance.productionBlockers,
  };
}

function publicBenchmarkProjection(report) {
  return {
    schemaVersion: report.schemaVersion,
    profile: report.profile,
    shape: {
      fileBytes: report.shape.fileBytes,
      chunkSizeBytes: report.shape.chunkSizeBytes,
      chunkCount: report.shape.chunkCount,
      rowCount: report.shape.rowCount,
      mutations: report.shape.mutations,
    },
    runtime: {
      generatedAt: report.runtime.generatedAt,
      profile: report.runtime.profile,
      budgetStatus: report.runtime.budgetStatus,
      budgets: report.runtime.budgets,
    },
    resources: {
      transfer: {
        chunkReceipts: report.resources.transfer.chunkReceipts,
        chunkManifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
        finalizedHashHash: digest(report.resources.transfer.finalizedHash),
      },
      runtimeBudget: report.resources.runtimeBudget,
    },
    guardedTransfer: {
      manifest: buildChunkManifestProjection(report),
      storagePerformance: buildStoragePerformanceProjection(report),
    },
    rolloutSafetyGates: {
      summary: report.rolloutSafetyGates.summary,
      gateStatuses: report.rolloutSafetyGates.gates.map((gate) => ({
        id: gate.id,
        status: gate.status,
        speedClaimBlocker: gate.speedClaimBlocker,
      })),
    },
    throughput: {
      productionThroughput: report.throughput.productionThroughput,
    },
  };
}

function publicCommandProjection(report) {
  return {
    schemaVersion: report.schemaVersion,
    profile: report.profile,
    shape: {
      fileBytes: report.shape?.fileBytes,
      chunkSizeBytes: report.shape?.chunkSizeBytes,
      chunkCount: report.shape?.chunkCount,
      rowCount: report.shape?.rowCount,
    },
    runtime: {
      profile: report.runtime?.profile,
      budgetStatus: report.runtime?.budgetStatus,
      budgets: report.runtime?.budgets,
    },
    resources: {
      transfer: {
        chunkReceipts: report.resources?.transfer?.chunkReceipts,
        chunkManifestDigestHash: digest(report.resources?.transfer?.chunkManifestDigest),
      },
      runtimeBudget: report.resources?.runtimeBudget,
    },
    rolloutSafetyGates: {
      summary: report.rolloutSafetyGates?.summary,
      gates: report.rolloutSafetyGates?.gates?.map((gate) => ({
        id: gate.id,
        status: gate.status,
        speedClaimBlocker: gate.speedClaimBlocker,
      })),
    },
    throughput: {
      productionThroughput: report.throughput?.productionThroughput,
    },
  };
}

function publicManifestEvidenceProjection(evidence) {
  return {
    schemaVersion: evidence.schemaVersion,
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    status: evidence.status,
    builtOn: evidence.builtOn,
    command: evidence.command,
    runtime: evidence.runtime,
    resources: evidence.resources,
    chunkManifest: evidence.chunkManifest,
    storagePerformance: evidence.storagePerformance,
    release: evidence.release,
  };
}

function manifestDeterministicProjection(evidence) {
  return {
    command: {
      gateIds: evidence.command.gateIds,
      gateStatuses: evidence.command.gateStatuses,
      gateCount: evidence.command.gateCount,
      summary: evidence.command.summary,
    },
    resources: {
      transfer: evidence.resources.transfer,
      storage: evidence.resources.storage,
      runtimeBudget: evidence.resources.runtimeBudget,
    },
    chunkManifest: evidence.chunkManifest,
    storagePerformance: evidence.storagePerformance,
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
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
  };
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

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function tempBenchmarkDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function withPassedStatus(evidence) {
  evidence.status = 'passed';
  return evidence;
}

function largeUploadManifestEvidenceHasNoRawValues(value) {
  const serialized = JSON.stringify(value);
  return !/file:wp-content\/uploads\//.test(serialized)
    && !/plan-guarded-executor-benchmark/.test(serialized)
    && !/"resourceKey"\s*:/.test(serialized)
    && !/"planId"\s*:/.test(serialized)
    && !/"idempotencyKey"\s*:/.test(serialized)
    && !/"receiptKey"\s*:/.test(serialized)
    && !/\/tmp\//.test(serialized)
    && !/\bBearer\s+/i.test(serialized)
    && !/\bBasic\s+/i.test(serialized)
    && !/https?:\/\//i.test(serialized);
}

function assertHashOnlyLargeUploadManifestEvidence(value) {
  assert.equal(largeUploadManifestEvidenceHasNoRawValues(value), true);
}
