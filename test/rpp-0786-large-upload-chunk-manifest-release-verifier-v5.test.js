import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGuardedExecutorBenchmark } from '../scripts/bench/guarded-executor-benchmark.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const rppId = 'RPP-0786';
const proofId = 'rpp-0786-large-upload-chunk-manifest-release-verifier-v5';
const evidenceSource = 'large-upload-chunk-manifest-release-verifier-v5';
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
const expectedReleaseVerifierGateIds = Object.freeze([
  'release-verifier-benchmark-command-reports-runtime-resources-gates',
  'complete-large-upload-chunk-manifest-report',
  'durable-chunk-receipt-and-hash-coverage',
  'resume-replay-duplicate-free',
  'deterministic-hash-only-release-verifier-evidence',
  'support-only-release-no-go',
]);
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const hexSha256Pattern = /^[a-f0-9]{64}$/;
let recordedEvidencePair;

test('RPP-0786 release verifier variant 5 carries large upload chunk manifest support proof', {
  concurrency: false,
}, () => {
  const proof = buildVariant5ReleaseVerifierProof();

  assert.equal(proof.rppId, rppId);
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.evidenceSource, evidenceSource);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0766');
  assert.equal(proof.builtOn.proofId, 'rpp-0766-large-upload-chunk-manifest-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceRppId, 'RPP-0706');
  assert.equal(proof.builtOn.benchmarkRppId, 'RPP-0726');
  assert.equal(proof.builtOn.sourceGate, 'guarded-transfer-manifest');
  assert.match(proof.builtOn.evidenceHash, hexSha256Pattern);

  assert.equal(proof.releaseVerifier.command, 'node scripts/bench/guarded-executor-benchmark.js');
  assert.equal(proof.releaseVerifier.runtimeReported, true);
  assert.equal(proof.releaseVerifier.resourcesReported, true);
  assert.equal(proof.releaseVerifier.passFailGatesReported, true);
  assert.equal(proof.releaseVerifier.resourcesBeforeGatesBeforeThroughput, true);
  assert.equal(proof.releaseVerifier.runtimeBudgetReported, true);
  assert.equal(proof.releaseVerifier.passFailStatusesOnly, true);
  assert.equal(proof.releaseVerifier.gateCount, 12);
  assert.equal(proof.releaseVerifier.summary.passed, 9);
  assert.equal(proof.releaseVerifier.summary.blocked, 3);
  assert.equal(proof.releaseVerifier.summary.failed, 0);
  assert.equal(proof.releaseVerifier.summary.speedClaimsAllowed, false);
  assert.deepEqual([...new Set(proof.releaseVerifier.gateStatuses)], ['passed', 'blocked']);
  assert.deepEqual(proof.releaseVerifier.productionBlockers, [
    'production-storage-receipts-not-measured',
    'production-row-batch-executor-not-measured',
    'production-atomic-group-commit-not-measured',
  ]);
  assert.match(proof.releaseVerifier.commandReportHash, hexSha256Pattern);

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
  assert.match(proof.storagePerformance.storagePerformanceHash, sha256Pattern);

  assert.deepEqual(proof.correctness.gateIds, expectedReleaseVerifierGateIds);
  assert.deepEqual(proof.correctness.recomputedGateVector.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.outputEmittedAfterGates, true);
  assert.equal(proof.correctness.hashOnlyReleaseVerifierOutput, true);
  assert.deepEqual(proof.gates.map((gate) => gate.status), ['pass', 'pass', 'pass', 'pass']);

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.releaseEligible, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.releaseVerifierCarryThrough, 'local-support-evidence-only');
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.outputHash, sha256Pattern);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashOnlyLargeUploadManifestEvidence(proof);
});

test('RPP-0786 release verifier variant 5 fails closed for unsafe manifest carry-through evidence', {
  concurrency: false,
}, () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeReleaseVerifierDecisions(evidence, repeatedEvidence);

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
  ]);

  assert.equal(unsafeDecisions.missingManifest.updated, false);
  assert.ok(unsafeDecisions.missingManifest.blockedBy.includes('complete-large-upload-chunk-manifest-report'));
  assert.equal(unsafeDecisions.shortReceiptSet.updated, false);
  assert.ok(unsafeDecisions.shortReceiptSet.blockedBy.includes('durable-chunk-receipt-and-hash-coverage'));
  assert.equal(unsafeDecisions.nonContiguousRange.updated, false);
  assert.ok(unsafeDecisions.nonContiguousRange.blockedBy.includes('complete-large-upload-chunk-manifest-report'));
  assert.equal(unsafeDecisions.failedHashVerification.updated, false);
  assert.ok(unsafeDecisions.failedHashVerification.blockedBy.includes('durable-chunk-receipt-and-hash-coverage'));
  assert.equal(unsafeDecisions.duplicateReplayWork.updated, false);
  assert.ok(unsafeDecisions.duplicateReplayWork.blockedBy.includes('resume-replay-duplicate-free'));
  assert.equal(unsafeDecisions.overBudget.updated, false);
  assert.ok(
    unsafeDecisions.overBudget.blockedBy.includes(
      'release-verifier-benchmark-command-reports-runtime-resources-gates',
    ),
  );
  assert.equal(unsafeDecisions.productionGoClaim.updated, false);
  assert.ok(unsafeDecisions.productionGoClaim.blockedBy.includes('support-only-release-no-go'));
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

function buildVariant5ReleaseVerifierProof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveReleaseVerifierCarryThrough(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeReleaseVerifierDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(evidence, 'correctnessGates', 'chunkManifest');
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('release-verifier-command-carry-through-pass', safeDecision.updated
      && evidence.releaseVerifier.runtimeReported
      && evidence.releaseVerifier.resourcesReported
      && evidence.releaseVerifier.passFailGatesReported, {
      gateCount: evidence.releaseVerifier.gateCount,
      summary: evidence.releaseVerifier.summary,
    }),
    proofGate('manifest-storage-performance-output-after-gates', safeDecision.outputEmitted
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
    rppId,
    proofId,
    variant: 5,
    evidenceSource,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0766',
      proofId: 'rpp-0766-large-upload-chunk-manifest-v4',
      variant: 4,
      status: 'passed',
      sourceRppId: 'RPP-0706',
      benchmarkRppId: 'RPP-0726',
      benchmark: 'guarded-executor-benchmark',
      sourceGate: 'guarded-transfer-manifest',
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    releaseVerifier: evidence.releaseVerifier,
    runtime: evidence.runtime,
    resources: evidence.resources,
    chunkManifest: evidence.chunkManifest,
    storagePerformance: evidence.storagePerformance,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyReleaseVerifierOutput: safeDecision.hashOnlyReleaseVerifierOutput,
      outputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-large-upload-chunk-manifest-release-verifier',
      rawValueEvidenceLeaks: largeUploadManifestEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicReleaseVerifierEvidenceProjection(evidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
    outputHash: safeDecision.outputHash,
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
    tempDir: tempBenchmarkDir('reprint-rpp-0786-manifest-v5-'),
  });
  const repeatedBenchmark = runGuardedExecutorBenchmark({
    ...benchmarkOptions,
    now: fixedNow,
    tempDir: tempBenchmarkDir('reprint-rpp-0786-manifest-v5-repeat-'),
  });
  const commandReport = runBenchmarkCommandReport();
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

function buildReleaseVerifierEvidence({ benchmark, commandReport }) {
  const chunkManifest = buildChunkManifestProjection(benchmark);
  const storagePerformance = buildStoragePerformanceProjection(benchmark);

  return {
    schemaVersion: 1,
    rppId,
    proofId,
    variant: 5,
    evidenceSource,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0766',
      proofId: 'rpp-0766-large-upload-chunk-manifest-v4',
      variant: 4,
      status: 'passed',
      sourceRppId: 'RPP-0706',
      benchmarkRppId: 'RPP-0726',
      benchmark: 'guarded-executor-benchmark',
      sourceGate: 'guarded-transfer-manifest',
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    releaseVerifier: commandReportShape(commandReport),
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
        manifestHash: evidence.chunkManifest.manifestEvidenceHash,
        storagePerformanceHash: evidence.storagePerformance.storagePerformanceHash,
        receiptCoverageHash: sha256(evidence.storagePerformance.receipts),
        runtimeBudgetHash: sha256({
          profile: evidence.runtime.profile,
          durationMs: evidence.runtime.durationMs,
          heapUsedBytes: evidence.resources.process.heapUsedBytes,
          budgets: evidence.runtime.budgets,
        }),
        productionBlockerHash: sha256(evidence.releaseVerifier.productionBlockers),
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
    hashOnlyReleaseVerifierOutput: output ? largeUploadManifestEvidenceHasNoRawValues(output) : false,
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
    ? digest(releaseVerifierDeterministicProjection(evidence))
      === digest(releaseVerifierDeterministicProjection(options.repeatedEvidence))
    : false;
  const runtimeResourcesWithinBudget = runtime.profile === 'unit'
    && runtime.budgetStatus === 'passed'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && transfer.fileBytes === benchmarkOptions.fileBytes
    && transfer.chunkSizeBytes === benchmarkOptions.chunkSizeBytes
    && resources.storage?.productionBacked === false;
  const hashOnlyEvidence = largeUploadManifestEvidenceHasNoRawValues({
    releaseVerifier,
    runtime,
    resources,
    chunkManifest: manifest,
    storagePerformance: storage,
  });

  return [
    proofGate('release-verifier-benchmark-command-reports-runtime-resources-gates',
      releaseVerifier.runtimeReported === true
        && releaseVerifier.resourcesReported === true
        && releaseVerifier.passFailGatesReported === true
        && releaseVerifier.resourcesBeforeGatesBeforeThroughput === true
        && releaseVerifier.runtimeBudgetReported === true
        && releaseVerifier.passFailStatusesOnly === true
        && releaseVerifier.gateCount === 12
        && releaseVerifier.summary?.passed === 9
        && releaseVerifier.summary?.blocked === 3
        && releaseVerifier.summary?.failed === 0
        && releaseVerifier.summary?.speedClaimsAllowed === false
        && runtimeResourcesWithinBudget, {
      runtimeReported: releaseVerifier.runtimeReported,
      resourcesReported: releaseVerifier.resourcesReported,
      passFailGatesReported: releaseVerifier.passFailGatesReported,
      gateCount: releaseVerifier.gateCount,
      summary: releaseVerifier.summary,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
    }),
    proofGate('complete-large-upload-chunk-manifest-report', manifest.status === 'passed'
      && manifest.complete === true
      && manifest.durableRecordType === 'chunk-manifest-finalized'
      && manifest.chunkCount === transfer.chunkCount
      && manifest.entryCount === transfer.chunkCount
      && manifest.fileBytes === transfer.fileBytes
      && manifest.chunkSizeBytes === transfer.chunkSizeBytes
      && sha256Pattern.test(manifest.entryDigest || '')
      && sha256Pattern.test(manifest.manifestEvidenceHash || '')
      && rangeMetrics.valid, {
      manifestStatus: manifest.status,
      complete: manifest.complete,
      durableRecordType: manifest.durableRecordType,
      chunkCount: manifest.chunkCount,
      entryCount: manifest.entryCount,
      rangeMetrics,
    }),
    proofGate('durable-chunk-receipt-and-hash-coverage', receipts.expected === manifest.chunkCount
      && receipts.recorded === manifest.chunkCount
      && transfer.chunkReceipts === manifest.chunkCount
      && receipts.receiptKeysUnique === true
      && receipts.everyReceiptPlanScoped === true
      && receipts.canonicalVisibleBeforeFinalize === false
      && visibility.finalizedRecordPresent === true
      && visibility.canonicalVisibleBeforePublish === false
      && visibility.livePathChangesOnlyAfterFinalize === true
      && hashVerification.status === 'passed'
      && hashVerification.verifiedChunkCount === manifest.chunkCount
      && hashVerification.totalBytesVerified === manifest.fileBytes
      && hashVerification.allChunksMatchManifest === true
      && hashVerification.assembledHashMatchesFinalized === true
      && sameCoverage(hashVerification.byteRangeCoverage, manifest.byteRangeCoverage)
      && Array.isArray(hashVerification.verifiedEntries)
      && hashVerification.verifiedEntries.length === manifest.chunkCount
      && hashVerification.verifiedEntries.every((entry) => entry.digestMatches === true), {
      expectedReceipts: receipts.expected,
      recordedReceipts: receipts.recorded,
      verifiedChunkCount: hashVerification.verifiedChunkCount,
      totalBytesVerified: hashVerification.totalBytesVerified,
      allChunksMatchManifest: hashVerification.allChunksMatchManifest,
      assembledHashMatchesFinalized: hashVerification.assembledHashMatchesFinalized,
      visibility,
    }),
    proofGate('resume-replay-duplicate-free', resume.status === 'passed'
      && resume.receiptOnlyResumeSafe === true
      && resume.chunksSkippedByReceipt === manifest.chunkCount
      && resume.chunksToUpload === 0
      && resume.bytesSkippedByReceipt === manifest.fileBytes
      && resume.bytesToUpload === 0
      && resume.duplicateChunkBytes === 0
      && resume.duplicateMutationWork === 0
      && resume.missingReceiptBlocksSkip === true
      && resume.mismatchedReceiptBlocksSkip === true
      && replay.status === 'passed'
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
      chunksSkippedByReceipt: resume.chunksSkippedByReceipt,
      chunksToUpload: resume.chunksToUpload,
      attemptedReplayCount: replay.attemptedReplayCount,
      idempotentSkips: replay.idempotentSkips,
      duplicateReceiptRecordsWritten: replay.duplicateReceiptRecordsWritten,
      bytesRewrittenDuringReplay: replay.bytesRewrittenDuringReplay,
      duplicateMutationWork: replay.duplicateMutationWork,
    }),
    proofGate('deterministic-hash-only-release-verifier-evidence', deterministicMatch && hashOnlyEvidence, {
      deterministicHash: digest(releaseVerifierDeterministicProjection(evidence)),
      repeatedHash: options.repeatedEvidence
        ? digest(releaseVerifierDeterministicProjection(options.repeatedEvidence))
        : null,
      rawValueEvidenceLeaks: hashOnlyEvidence ? 0 : 1,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.releaseEligible === false
      && release.productionThroughput === 'not-claimed'
      && release.speedClaimsAllowed === false
      && release.releaseVerifierCarryThrough === 'local-support-evidence-only'
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
  const missingManifest = withPassedStatus(clone(evidence));
  missingManifest.chunkManifest.status = 'failed';
  missingManifest.chunkManifest.complete = false;
  missingManifest.chunkManifest.durableRecordType = null;

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

  const duplicateReplayWork = withPassedStatus(clone(evidence));
  duplicateReplayWork.storagePerformance.replay.idempotentReplaySafe = false;
  duplicateReplayWork.storagePerformance.replay.duplicateReceiptRecordsWritten = 1;
  duplicateReplayWork.storagePerformance.replay.bytesRewrittenDuringReplay = benchmarkOptions.chunkSizeBytes;
  duplicateReplayWork.storagePerformance.replay.duplicateMutationWork = 1;
  duplicateReplayWork.storagePerformance.replay.noDuplicateMutationWork = false;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

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
    missingManifest: resolveReleaseVerifierCarryThrough(missingManifest, { repeatedEvidence }),
    shortReceiptSet: resolveReleaseVerifierCarryThrough(shortReceiptSet, { repeatedEvidence }),
    nonContiguousRange: resolveReleaseVerifierCarryThrough(nonContiguousRange, { repeatedEvidence }),
    failedHashVerification: resolveReleaseVerifierCarryThrough(failedHashVerification, { repeatedEvidence }),
    duplicateReplayWork: resolveReleaseVerifierCarryThrough(duplicateReplayWork, { repeatedEvidence }),
    overBudget: resolveReleaseVerifierCarryThrough(overBudget, { repeatedEvidence }),
    productionGoClaim: resolveReleaseVerifierCarryThrough(productionGoClaim, { repeatedEvidence }),
    prematurePassStatus: resolveReleaseVerifierCarryThrough(prematurePassStatus, { repeatedEvidence }),
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
    command: 'node scripts/bench/guarded-executor-benchmark.js',
    benchmark: report.runtime?.benchmarkId,
    runtimeReported: typeof report.runtime?.durationMs === 'number'
      && typeof report.runtime?.budgets?.maxDurationMs === 'number',
    resourcesReported: typeof report.resources?.process?.heapUsedBytes === 'number'
      && typeof report.resources?.transfer?.chunkReceipts === 'number',
    passFailGatesReported: Array.isArray(report.rolloutSafetyGates?.gates)
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
    productionBlockers: report.rolloutSafetyGates?.summary?.blockers || [],
    commandReportHash: digest(publicCommandProjection(report)),
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
    `--temp-dir=${tempBenchmarkDir('reprint-rpp-0786-manifest-v5-cli-')}`,
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
    chunkManifest: evidence.chunkManifest,
    storagePerformance: evidence.storagePerformance,
    release: evidence.release,
  };
}

function releaseVerifierDeterministicProjection(evidence) {
  return {
    releaseVerifier: {
      command: evidence.releaseVerifier.command,
      benchmark: evidence.releaseVerifier.benchmark,
      gateIds: evidence.releaseVerifier.gateIds,
      gateStatuses: evidence.releaseVerifier.gateStatuses,
      gateCount: evidence.releaseVerifier.gateCount,
      summary: evidence.releaseVerifier.summary,
      productionBlockers: evidence.releaseVerifier.productionBlockers,
    },
    resources: {
      transfer: evidence.resources.transfer,
      storage: evidence.resources.storage,
      runtimeBudget: evidence.resources.runtimeBudget,
    },
    chunkManifest: evidence.chunkManifest,
    storagePerformance: evidence.storagePerformance,
    release: evidence.release,
  };
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
    releaseVerifierCarryThrough: 'local-support-evidence-only',
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
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(value, {
      label: 'RPP-0786 large upload chunk manifest release verifier proof',
    }));
}
