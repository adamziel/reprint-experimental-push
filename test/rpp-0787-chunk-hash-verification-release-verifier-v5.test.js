import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  productionThroughputBlockers,
  runGuardedExecutorBenchmark,
} from '../scripts/bench/guarded-executor-benchmark.js';
import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { digest } from '../src/stable-json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const proofId = 'rpp-0787-chunk-hash-verification-release-verifier-v5';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const MIB = 1024 * 1024;
const benchmarkOptions = Object.freeze({
  profile: 'unit',
  fileBytes: MIB,
  chunkSizeBytes: 256 * 1024,
  rowCount: 8,
  rowPayloadBytes: 64,
  maxDurationMs: 10_000,
  maxHeapUsedBytes: 256 * MIB,
});
const expectedGateIds = Object.freeze([
  'release-verifier-command-reports-runtime-resources-gates',
  'built-on-chunk-hash-verification-v4-passed',
  'all-manifest-chunks-verified',
  'generated-stale-storage-coverage',
  'guarded-writes-reject-stale-storage-state',
  'hash-mismatch-fails-closed',
  'no-mutation-work-on-rejected-writes',
  'deterministic-release-verifier-support-evidence',
  'unit-storage-performance-budget',
  'release-verifier-carry-through-claimed',
  'hash-only-release-verifier-evidence',
  'support-only-release-no-go',
]);
const expectedGuardCompareFields = Object.freeze([
  'planId',
  'resourceKey',
  'localResourceHash',
  'manifestDigest',
  'chunkIndex',
  'offsetBytes',
  'sizeBytes',
  'chunkDigest',
  'storageRevisionHash',
]);
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const hexSha256Pattern = /^[a-f0-9]{64}$/;

let recordedEvidenceBundle;

test('RPP-0787 release verifier v5 carries chunk hash verification stale-storage guard evidence', {
  concurrency: false,
}, () => {
  const proof = buildVariant5Proof();

  assert.equal(proof.rppId, 'RPP-0787');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 5);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0767');
  assert.equal(proof.builtOn.proofId, 'rpp-0767-chunk-hash-verification-v4');
  assert.equal(proof.builtOn.variant, 4);
  assert.equal(proof.builtOn.status, 'passed');
  assert.equal(proof.builtOn.sourceRppId, 'RPP-0727');
  assert.equal(proof.builtOn.sourceProofId, 'rpp-0727-chunk-hash-verification-v2');
  assert.equal(proof.builtOn.sourceGate.id, 'chunk-hash-verification');
  assert.equal(proof.builtOn.sourceGate.status, 'passed');
  assert.equal(proof.builtOn.sourceGate.allChunksMatchManifest, true);
  assert.equal(proof.builtOn.sourceGate.assembledHashMatchesFinalized, true);
  assert.match(proof.builtOn.sourceGate.evidenceHash, hexSha256Pattern);

  assert.equal(proof.releaseVerifier.evidenceSource, 'chunk-hash-verification-release-verifier-v5');
  assert.equal(proof.releaseVerifier.command.reportsRuntime, true);
  assert.equal(proof.releaseVerifier.command.reportsResources, true);
  assert.equal(proof.releaseVerifier.command.reportsPassFailGates, true);
  assert.equal(proof.releaseVerifier.command.resourcesBeforeGatesBeforeThroughput, true);
  assert.equal(proof.releaseVerifier.command.runtimeBudgetReported, true);
  assert.equal(proof.releaseVerifier.command.passFailStatusesOnly, true);
  assert.equal(proof.releaseVerifier.command.gateCount, 12);
  assert.equal(proof.releaseVerifier.command.summary.passed, 9);
  assert.equal(proof.releaseVerifier.command.summary.blocked, 3);
  assert.equal(proof.releaseVerifier.command.summary.failed, 0);
  assert.equal(proof.releaseVerifier.command.summary.speedClaimsAllowed, false);
  assert.deepEqual([...new Set(proof.releaseVerifier.command.gateStatuses)], ['passed', 'blocked']);
  assert.match(proof.releaseVerifier.command.reportHash, hexSha256Pattern);
  assert.equal(proof.releaseVerifier.carryThrough.status, 'claimed-support-only');
  assert.equal(proof.releaseVerifier.carryThrough.fromRpp, 'RPP-0767');
  assert.equal(proof.releaseVerifier.carryThrough.checkedSourceGate, 'chunk-hash-verification');
  assert.equal(proof.releaseVerifier.carryThrough.outputAfterCorrectnessGates, true);
  assert.equal(proof.releaseVerifier.carryThrough.guardedStaleStorageRejected, true);
  assert.equal(proof.releaseVerifier.carryThrough.hashMismatchRejected, true);
  assert.equal(proof.releaseVerifier.carryThrough.noMutationWorkOnRejectedWrites, true);
  assert.match(proof.releaseVerifier.carryThrough.proofHash, sha256Pattern);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'unit');
  assert.equal(proof.runtime.budgetStatus, 'passed');
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.storage.stagingBackend, 'bench-generated-chunk-staging');
  assert.equal(proof.resources.storage.localStorageProof, 'support-only-lab-file-journal');
  assert.equal(proof.resources.storage.productionBacked, false);
  assert.equal(proof.resources.storage.receiptBackend, 'lab-file-journal-receipts');
  assert.equal(proof.resources.storage.chunkReceipts, proof.transfer.chunkCount);
  assert.equal(proof.resources.storage.finalStagingRecordPresent, true);

  assert.equal(proof.transfer.fileBytes, benchmarkOptions.fileBytes);
  assert.equal(proof.transfer.chunkSizeBytes, benchmarkOptions.chunkSizeBytes);
  assert.equal(proof.transfer.chunkCount, 4);
  assert.equal(proof.transfer.manifestComplete, true);
  assert.equal(proof.transfer.finalStagingRecordPresent, true);
  assert.equal(proof.transfer.canonicalVisibleBeforePublish, false);
  assert.equal(proof.transfer.livePathChangesOnlyAfterFinalize, true);
  assert.equal(proof.transfer.byteRangeCoverage.contiguous, true);
  assert.match(proof.transfer.planIdHash, hexSha256Pattern);
  assert.match(proof.transfer.resourceKeyHash, hexSha256Pattern);
  assert.match(proof.transfer.manifestDigestHash, hexSha256Pattern);
  assert.match(proof.transfer.finalizedHashHash, hexSha256Pattern);

  assert.equal(proof.hashVerification.status, 'passed');
  assert.equal(proof.hashVerification.verifiedChunkCount, proof.transfer.chunkCount);
  assert.equal(proof.hashVerification.totalBytesVerified, proof.transfer.fileBytes);
  assert.equal(proof.hashVerification.allChunksMatchManifest, true);
  assert.equal(proof.hashVerification.assembledHashMatchesFinalized, true);
  assert.equal(proof.hashVerification.verifiedEntries.length, proof.transfer.chunkCount);
  assert.equal(proof.hashVerification.verifiedEntries.every((entry) => entry.digestMatches === true), true);

  assert.equal(proof.generatedCoverage.generatedCaseCount, proof.transfer.chunkCount);
  assert.equal(proof.generatedCoverage.coveredChunkCount, proof.transfer.chunkCount);
  assert.equal(proof.generatedCoverage.generatedEveryChunk, true);
  assert.equal(proof.generatedCoverage.guardCompareFieldsComplete, true);
  assert.deepEqual(proof.generatedCoverage.guardCompareFields, expectedGuardCompareFields);
  assert.equal(proof.generatedCoverage.matchingWritesAttempted, proof.transfer.chunkCount);
  assert.equal(proof.generatedCoverage.matchingWritesApplied, proof.transfer.chunkCount);
  assert.equal(proof.generatedCoverage.staleStorageWriteAttempts, proof.transfer.chunkCount);
  assert.equal(proof.generatedCoverage.staleStorageRejections, proof.transfer.chunkCount);
  assert.equal(proof.generatedCoverage.hashMismatchWriteAttempts, proof.transfer.chunkCount);
  assert.equal(proof.generatedCoverage.hashMismatchRejections, proof.transfer.chunkCount);
  assert.equal(proof.generatedCoverage.unsafeWritesApplied, 0);
  assert.equal(proof.generatedCoverage.bytesWrittenOnRejectedWrites, 0);
  assert.equal(proof.generatedCoverage.mutationWorkOnRejectedWrites, 0);

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
    'pass',
  ]);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.releaseVerifierOutputEmittedAfterGates, true);
  assert.equal(proof.correctness.hashOnlyChunkHashOutput, true);
  assert.equal(proof.determinism.sameProjection, true);
  assert.equal(proof.determinism.firstProjectionHash, proof.determinism.secondProjectionHash);
  assert.match(proof.determinism.firstProjectionHash, sha256Pattern);
  assert.deepEqual(proof.determinism.ignoredVolatileFields, [
    'runtime.durationMs',
    'resources.process',
  ]);
  assert.match(proof.outputHash, sha256Pattern);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.missingCommandReport.updated, false);
  assert.ok(
    proof.unsafe.missingCommandReport.blockedBy
      .includes('release-verifier-command-reports-runtime-resources-gates'),
  );
  assert.equal(proof.unsafe.staleStorageAllowed.updated, false);
  assert.ok(
    proof.unsafe.staleStorageAllowed.blockedBy
      .includes('guarded-writes-reject-stale-storage-state'),
  );
  assert.equal(proof.unsafe.hashMismatchAllowed.updated, false);
  assert.ok(proof.unsafe.hashMismatchAllowed.blockedBy.includes('hash-mismatch-fails-closed'));
  assert.equal(proof.unsafe.releaseVerifierNotClaimed.updated, false);
  assert.ok(
    proof.unsafe.releaseVerifierNotClaimed.blockedBy
      .includes('release-verifier-carry-through-claimed'),
  );

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.releaseVerifierCarryThrough, 'claimed-support-only');
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));
  assert.equal(proof.release.blockers.includes('release-verifier-carry-through-not-claimed'), false);
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.evidenceHash, hexSha256Pattern);
  assertHashOnlyChunkHashEvidence(proof);
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0787 chunk hash release verifier proof' }));
});

test('RPP-0787 release verifier v5 guarded writes reject stale storage and hash mismatch', {
  concurrency: false,
}, () => {
  const { report } = buildRecordedEvidenceBundle();
  const cases = buildGeneratedChunkHashGuardCases(report);

  assert.equal(cases.length, report.shape.chunkCount);

  for (const generatedCase of cases) {
    assert.equal(generatedCase.matching.applied, true);
    assert.equal(generatedCase.matching.outcome, 'applied');
    assert.equal(generatedCase.matching.bytesWritten, generatedCase.sizeBytes);
    assert.equal(generatedCase.matching.mutationWork, 0);

    assert.equal(generatedCase.staleStorage.applied, false);
    assert.equal(generatedCase.staleStorage.outcome, 'stale-at-write');
    assert.equal(generatedCase.staleStorage.rowsAffected, 0);
    assert.equal(generatedCase.staleStorage.bytesWritten, 0);
    assert.equal(generatedCase.staleStorage.mutationWork, 0);
    assert.notEqual(
      generatedCase.staleStorage.observedStorageHash,
      generatedCase.staleStorage.expectedStorageHash,
    );
    assert.equal(generatedCase.staleStorage.hashMatchesManifest, true);

    assert.equal(generatedCase.hashMismatch.applied, false);
    assert.equal(generatedCase.hashMismatch.outcome, 'hash-mismatch');
    assert.equal(generatedCase.hashMismatch.rowsAffected, 0);
    assert.equal(generatedCase.hashMismatch.bytesWritten, 0);
    assert.equal(generatedCase.hashMismatch.mutationWork, 0);
    assert.notEqual(
      generatedCase.hashMismatch.observedStorageHash,
      generatedCase.hashMismatch.expectedStorageHash,
    );
    assert.equal(generatedCase.hashMismatch.hashMatchesManifest, false);

    assertChunkGuardDecisionIsHashOnly(generatedCase.matching);
    assertChunkGuardDecisionIsHashOnly(generatedCase.staleStorage);
    assertChunkGuardDecisionIsHashOnly(generatedCase.hashMismatch);
  }
});

test('RPP-0787 release verifier v5 blocks unsafe or incomplete chunk hash carry-through evidence', {
  concurrency: false,
}, () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidenceBundle();
  const safeDecision = resolveChunkHashReleaseVerifierProof(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeChunkHashDecisions(evidence, repeatedEvidence);

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
    'pass',
  ]);

  assert.equal(unsafeDecisions.missingCommandReport.updated, false);
  assert.ok(
    unsafeDecisions.missingCommandReport.blockedBy
      .includes('release-verifier-command-reports-runtime-resources-gates'),
  );
  assert.equal(unsafeDecisions.staleStorageAllowed.updated, false);
  assert.ok(
    unsafeDecisions.staleStorageAllowed.blockedBy
      .includes('guarded-writes-reject-stale-storage-state'),
  );
  assert.equal(unsafeDecisions.hashMismatchAllowed.updated, false);
  assert.ok(unsafeDecisions.hashMismatchAllowed.blockedBy.includes('hash-mismatch-fails-closed'));
  assert.equal(unsafeDecisions.missingGeneratedCoverage.updated, false);
  assert.ok(
    unsafeDecisions.missingGeneratedCoverage.blockedBy
      .includes('generated-stale-storage-coverage'),
  );
  assert.equal(unsafeDecisions.rejectedWriteMutationWork.updated, false);
  assert.ok(
    unsafeDecisions.rejectedWriteMutationWork.blockedBy
      .includes('no-mutation-work-on-rejected-writes'),
  );
  assert.equal(unsafeDecisions.overBudget.updated, false);
  assert.ok(unsafeDecisions.overBudget.blockedBy.includes('unit-storage-performance-budget'));
  assert.equal(unsafeDecisions.releaseVerifierNotClaimed.updated, false);
  assert.ok(
    unsafeDecisions.releaseVerifierNotClaimed.blockedBy
      .includes('release-verifier-carry-through-claimed'),
  );
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, hexSha256Pattern);
    assertHashOnlyChunkHashEvidence(decision);
  }
});

function buildVariant5Proof() {
  const { evidence, repeatedEvidence } = buildRecordedEvidenceBundle();
  const safeDecision = resolveChunkHashReleaseVerifierProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeChunkHashDecisions(evidence, repeatedEvidence));
  const determinism = compareDeterministicChunkHashEvidence(evidence, repeatedEvidence);
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'hashVerification',
  ) && objectKeyBefore(evidence, 'correctnessGates', 'releaseVerifier');
  const staleStorageRejected = evidence.generatedCoverage.staleStorageRejections
    === evidence.transfer.chunkCount
    && evidence.generatedCoverage.unsafeWritesApplied === 0
    && evidence.generatedCoverage.bytesWrittenOnRejectedWrites === 0;
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('release-verifier-command-runtime-resources-gates-pass',
      evidence.releaseVerifier.command.reportsRuntime
        && evidence.releaseVerifier.command.reportsResources
        && evidence.releaseVerifier.command.reportsPassFailGates
        && evidence.releaseVerifier.command.passFailStatusesOnly, {
        gateStatuses: evidence.releaseVerifier.command.gateStatuses,
        gateCount: evidence.releaseVerifier.command.gateCount,
      }),
    proofGate('chunk-hash-output-after-release-verifier-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput
      && evidence.releaseVerifier.carryThrough.status === 'claimed-support-only', {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('guarded-stale-storage-fails-closed', staleStorageRejected
      && unsafe.staleStorageAllowed.updated === false
      && unsafe.staleStorageAllowed.attemptedPassBlocked === true, {
      staleStorageWriteAttempts: evidence.generatedCoverage.staleStorageWriteAttempts,
      staleStorageRejections: evidence.generatedCoverage.staleStorageRejections,
      unsafeWritesApplied: evidence.generatedCoverage.unsafeWritesApplied,
    }),
    proofGate('unsafe-chunk-hash-evidence-fails-closed',
      Object.values(unsafe).every((decision) => (
        decision.updated === false
          && decision.outputEmitted === false
          && decision.attemptedPassBlocked === true
      )), {
        blockedDecisionHashes: Object.values(unsafe).map((decision) => decision.decisionHash),
      }),
    proofGate('support-only-release-no-go', supportOnlyRelease.supportOnly
      && supportOnlyRelease.productionBacked === false
      && supportOnlyRelease.releaseVerifierCarryThrough === 'claimed-support-only'
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
      releaseVerifierCarryThrough: supportOnlyRelease.releaseVerifierCarryThrough,
    }),
  ];
  const publicProof = {
    rppId: 'RPP-0787',
    proofId,
    variant: 5,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
    releaseVerifier: evidence.releaseVerifier,
    runtime: evidence.runtime,
    resources: evidence.resources,
    benchmark: evidence.benchmark,
    transfer: evidence.transfer,
    hashVerification: evidence.hashVerification,
    generatedCoverage: evidence.generatedCoverage,
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyChunkHashOutput: safeDecision.hashOnlyChunkHashOutput,
      releaseVerifierOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    determinism,
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-and-count-only-chunk-hash-release-verifier',
      rawValueEvidenceLeaks: chunkHashEvidenceHasNoRawValues(evidence) ? 0 : 1,
      publicEvidenceHash: digest(publicChunkHashEvidenceProjection(evidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidenceBundle() {
  if (recordedEvidenceBundle) {
    return recordedEvidenceBundle;
  }

  const report = runUnitBenchmark('reprint-rpp-0787-chunk-hash-v5-');
  const repeatedReport = runUnitBenchmark('reprint-rpp-0787-chunk-hash-v5-repeat-');
  const commandReport = runBenchmarkCommandReport();
  const evidence = buildChunkHashReleaseVerifierEvidence({ report, commandReport });
  const repeatedEvidence = buildChunkHashReleaseVerifierEvidence({
    report: repeatedReport,
    commandReport,
  });

  recordCorrectnessGates(evidence, { repeatedEvidence });
  recordCorrectnessGates(repeatedEvidence, { repeatedEvidence: evidence });
  recordedEvidenceBundle = {
    report,
    repeatedReport,
    commandReport,
    evidence,
    repeatedEvidence,
  };
  return recordedEvidenceBundle;
}

function runUnitBenchmark(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return runGuardedExecutorBenchmark({
      ...benchmarkOptions,
      now: fixedNow,
      tempDir,
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function runBenchmarkCommandReport() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0787-chunk-hash-v5-cli-'));
  try {
    const stdout = execFileSync(process.execPath, [
      'scripts/bench/guarded-executor-benchmark.js',
      '--profile=unit',
      `--file-bytes=${benchmarkOptions.fileBytes}`,
      `--chunk-size-bytes=${benchmarkOptions.chunkSizeBytes}`,
      `--row-count=${benchmarkOptions.rowCount}`,
      `--row-payload-bytes=${benchmarkOptions.rowPayloadBytes}`,
      `--max-duration-ms=${benchmarkOptions.maxDurationMs}`,
      `--max-heap-used-bytes=${benchmarkOptions.maxHeapUsedBytes}`,
      `--temp-dir=${tempDir}`,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 16 * MIB,
    });

    return JSON.parse(stdout);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildChunkHashReleaseVerifierEvidence({ report, commandReport }) {
  const hashVerification = report.evidence.guardedTransfer.hashVerification;
  const guardCases = buildGeneratedChunkHashGuardCases(report);
  const productionBlockers = productionThroughputBlockers(report);
  const command = commandReportShape(commandReport);
  const generatedCoverage = summarizeGeneratedChunkHashGuardCases(guardCases, report.shape.chunkCount);
  const release = supportOnlyReleasePosture(report, productionBlockers);
  const evidence = {
    schemaVersion: 1,
    rppId: 'RPP-0787',
    proofId,
    variant: 5,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0767',
      proofId: 'rpp-0767-chunk-hash-verification-v4',
      variant: 4,
      status: 'passed',
      sourceRppId: 'RPP-0727',
      sourceProofId: 'rpp-0727-chunk-hash-verification-v2',
      sourceGate: {
        id: 'chunk-hash-verification',
        status: hashVerification.status,
        allChunksMatchManifest: hashVerification.allChunksMatchManifest,
        assembledHashMatchesFinalized: hashVerification.assembledHashMatchesFinalized,
        evidenceHash: digest(publicHashVerificationProjection(hashVerification)),
      },
    },
    command,
    correctnessGates: [],
    runtime: {
      generatedAt: report.runtime.generatedAt,
      profile: report.runtime.profile,
      durationMs: report.runtime.durationMs,
      budgetStatus: report.runtime.budgetStatus,
      budgets: report.runtime.budgets,
      conservativeBudgetReporting: report.runtime.conservativeBudgetReporting,
    },
    resources: {
      storage: {
        stagingBackend: report.resources.transfer.staging,
        receiptBackend: 'lab-file-journal-receipts',
        localStorageProof: 'support-only-lab-file-journal',
        productionBacked: false,
        chunkReceipts: report.resources.transfer.chunkReceipts,
        finalStagingRecordPresent: report.evidence.chunkReceipts.finalStagingRecord,
        chunkManifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
        finalizedHashHash: digest(report.resources.transfer.finalizedHash),
      },
      process: report.resources.process,
      journals: {
        successRecords: report.resources.journals.successRecords,
        allJournalsIntegrityOk: report.evidence.journal.allJournalsIntegrityOk,
        durableJournalsContainNoRawValues:
          report.evidence.redaction.durableJournalsContainNoRawValues,
      },
      runtimeBudget: report.resources.runtimeBudget,
    },
    benchmark: publicBenchmarkProjection(report, productionBlockers),
    transfer: {
      planIdHash: digest(report.resources.transfer.planId),
      resourceKeyHash: digest(report.resources.transfer.resourceKey),
      fileBytes: report.shape.fileBytes,
      chunkSizeBytes: report.shape.chunkSizeBytes,
      chunkCount: report.shape.chunkCount,
      manifestComplete: report.evidence.guardedTransfer.manifest.complete,
      manifestDigestHash: digest(report.resources.transfer.chunkManifestDigest),
      finalizedHashHash: digest(report.resources.transfer.finalizedHash),
      byteRangeCoverage: report.evidence.guardedTransfer.manifest.byteRangeCoverage,
      receiptKeysUnique: report.evidence.guardedTransfer.receipts.receiptKeysUnique,
      receiptRecords: report.evidence.chunkReceipts.recorded,
      finalStagingRecordPresent: report.evidence.chunkReceipts.finalStagingRecord,
      canonicalVisibleBeforePublish: report.evidence.chunkReceipts.canonicalVisibleBeforePublish,
      livePathChangesOnlyAfterFinalize:
        report.evidence.guardedTransfer.visibility.livePathChangesOnlyAfterFinalize,
    },
    hashVerification: {
      status: hashVerification.status,
      verifiedChunkCount: hashVerification.verifiedChunkCount,
      totalBytesVerified: hashVerification.totalBytesVerified,
      allChunksMatchManifest: hashVerification.allChunksMatchManifest,
      assembledHashHash: digest(hashVerification.assembledHash),
      assembledHashMatchesFinalized: hashVerification.assembledHashMatchesFinalized,
      byteRangeCoverage: hashVerification.byteRangeCoverage,
      verifiedEntries: hashVerification.verifiedEntries.map((entry) => ({
        chunkIndex: entry.chunkIndex,
        offsetBytes: entry.offsetBytes,
        sizeBytes: entry.sizeBytes,
        digestMatches: entry.digestMatches,
        entryHash: sha256(entry),
      })),
    },
    generatedCoverage,
    release,
  };

  evidence.releaseVerifier = buildReleaseVerifierCarryThroughProjection(evidence);
  return evidence;
}

function buildReleaseVerifierCarryThroughProjection(evidence) {
  const staleRejected = evidence.generatedCoverage.staleStorageWriteAttempts === evidence.transfer.chunkCount
    && evidence.generatedCoverage.staleStorageRejections === evidence.transfer.chunkCount
    && evidence.generatedCoverage.unsafeWritesApplied === 0
    && evidence.generatedCoverage.bytesWrittenOnRejectedWrites === 0;
  const hashMismatchRejected = evidence.generatedCoverage.hashMismatchWriteAttempts === evidence.transfer.chunkCount
    && evidence.generatedCoverage.hashMismatchRejections === evidence.transfer.chunkCount
    && evidence.generatedCoverage.unsafeWritesApplied === 0
    && evidence.generatedCoverage.bytesWrittenOnRejectedWrites === 0;
  const carryThrough = {
    status: 'claimed-support-only',
    fromRpp: 'RPP-0767',
    sourceProofId: 'rpp-0767-chunk-hash-verification-v4',
    sourceVariant: 4,
    checkedSourceGate: 'chunk-hash-verification',
    verifiedChunkCount: evidence.hashVerification.verifiedChunkCount,
    generatedCaseCount: evidence.generatedCoverage.generatedCaseCount,
    guardedStaleStorageRejected: staleRejected,
    hashMismatchRejected,
    noMutationWorkOnRejectedWrites: evidence.generatedCoverage.mutationWorkOnRejectedWrites === 0,
    outputAfterCorrectnessGates: true,
    releaseStatus: evidence.release.finalReleaseStatus,
    integrationRecommendation: evidence.release.integrationRecommendation,
  };

  return {
    evidenceSource: 'chunk-hash-verification-release-verifier-v5',
    command: evidence.command,
    carryThrough: {
      ...carryThrough,
      proofHash: sha256(carryThrough),
    },
  };
}

function buildGeneratedChunkHashGuardCases(report) {
  const manifest = report.evidence.guardedTransfer.manifest;

  return manifest.entries.map((entry) => {
    const expectedStorage = chunkStorageState({ report, entry });
    const plannedStorage = {
      ...expectedStorage,
      verificationState: 'accepted',
      publishIntentHash: sha256({
        manifestEntryHash: digest(entry),
        mode: 'verified-chunk-write',
      }),
    };
    const staleStorage = {
      ...expectedStorage,
      storageRevisionHash: sha256({
        manifestEntryHash: digest(entry),
        mode: 'stale-storage-revision',
      }),
    };
    const mismatchedStorage = {
      ...expectedStorage,
      chunkDigest: sha256({
        manifestEntryHash: digest(entry),
        mode: 'mismatched-observed-chunk-digest',
      }),
      storageRevisionHash: sha256({
        manifestEntryHash: digest(entry),
        mode: 'mismatched-storage-revision',
      }),
    };

    return {
      chunkIndex: entry.chunkIndex,
      offsetBytes: entry.offsetBytes,
      sizeBytes: entry.sizeBytes,
      caseHash: sha256({
        manifestEntryHash: digest(entry),
        generatedCase: 'rpp-0787-v5-release-verifier',
      }),
      matching: resolveGuardedChunkHashWrite({
        expectedStorage,
        observedStorage: expectedStorage,
        plannedStorage,
      }),
      staleStorage: resolveGuardedChunkHashWrite({
        expectedStorage,
        observedStorage: staleStorage,
        plannedStorage,
      }),
      hashMismatch: resolveGuardedChunkHashWrite({
        expectedStorage,
        observedStorage: mismatchedStorage,
        plannedStorage,
      }),
    };
  });
}

function chunkStorageState({ report, entry }) {
  return {
    planId: manifestValueHash(report.evidence.guardedTransfer.manifest.planId),
    resourceKey: manifestValueHash(report.evidence.guardedTransfer.manifest.resourceKey),
    localResourceHash: entry.localResourceHash,
    manifestDigest: report.evidence.guardedTransfer.manifest.manifestDigest,
    chunkIndex: entry.chunkIndex,
    offsetBytes: entry.offsetBytes,
    sizeBytes: entry.sizeBytes,
    chunkDigest: entry.chunkDigest,
    storageRevisionHash: sha256({
      manifestEntryHash: digest(entry),
      mode: 'manifest-finalized-storage-revision',
    }),
    verificationState: 'staged',
  };
}

function resolveGuardedChunkHashWrite({ expectedStorage, observedStorage, plannedStorage }) {
  const expectedStorageHash = digest(chunkStorageCompareProjection(expectedStorage));
  const observedStorageHash = digest(chunkStorageCompareProjection(observedStorage));
  const plannedStorageHash = digest(chunkStorageCompareProjection(plannedStorage));
  const hashMatchesManifest = observedStorage.chunkDigest === expectedStorage.chunkDigest
    && observedStorage.localResourceHash === expectedStorage.localResourceHash
    && observedStorage.manifestDigest === expectedStorage.manifestDigest;
  const byteRangeMatches = observedStorage.chunkIndex === expectedStorage.chunkIndex
    && observedStorage.offsetBytes === expectedStorage.offsetBytes
    && observedStorage.sizeBytes === expectedStorage.sizeBytes;
  const storageFresh = expectedStorageHash === observedStorageHash;
  const applied = storageFresh && hashMatchesManifest && byteRangeMatches;
  const outcome = applied
    ? 'applied'
    : hashMatchesManifest && byteRangeMatches ? 'stale-at-write' : 'hash-mismatch';

  return {
    boundary: 'chunk-hash-verification-guard',
    adapter: 'release-verifier-generated-chunk-guard',
    operation: 'verify-and-publish-staged-chunk',
    outcome,
    applied,
    rowsAffected: applied ? 1 : 0,
    bytesWritten: applied ? observedStorage.sizeBytes : 0,
    mutationWork: 0,
    storageFresh,
    hashMatchesManifest,
    byteRangeMatches,
    expectedStorageHash,
    observedStorageHash,
    plannedStorageHash,
    comparedFields: expectedGuardCompareFields,
  };
}

function chunkStorageCompareProjection(storage) {
  return {
    planId: storage.planId,
    resourceKey: storage.resourceKey,
    localResourceHash: storage.localResourceHash,
    manifestDigest: storage.manifestDigest,
    chunkIndex: storage.chunkIndex,
    offsetBytes: storage.offsetBytes,
    sizeBytes: storage.sizeBytes,
    chunkDigest: storage.chunkDigest,
    storageRevisionHash: storage.storageRevisionHash,
  };
}

function summarizeGeneratedChunkHashGuardCases(cases, chunkCount) {
  const staleStorageRejections = cases.filter((entry) => (
    entry.staleStorage.applied === false
      && entry.staleStorage.outcome === 'stale-at-write'
      && entry.staleStorage.bytesWritten === 0
  )).length;
  const hashMismatchRejections = cases.filter((entry) => (
    entry.hashMismatch.applied === false
      && entry.hashMismatch.outcome === 'hash-mismatch'
      && entry.hashMismatch.bytesWritten === 0
  )).length;
  const matchingWritesApplied = cases.filter((entry) => entry.matching.applied === true).length;
  const unsafeWritesApplied = cases.filter((entry) => (
    entry.staleStorage.applied === true || entry.hashMismatch.applied === true
  )).length;
  const bytesWrittenOnRejectedWrites = cases.reduce((total, entry) => (
    total + entry.staleStorage.bytesWritten + entry.hashMismatch.bytesWritten
  ), 0);
  const mutationWorkOnRejectedWrites = cases.reduce((total, entry) => (
    total + entry.staleStorage.mutationWork + entry.hashMismatch.mutationWork
  ), 0);

  return {
    generatedCaseCount: cases.length,
    coveredChunkCount: new Set(cases.map((entry) => entry.chunkIndex)).size,
    expectedChunkCount: chunkCount,
    generatedEveryChunk: cases.length === chunkCount
      && new Set(cases.map((entry) => entry.chunkIndex)).size === chunkCount,
    guardCompareFields: expectedGuardCompareFields,
    guardCompareFieldsComplete: cases.every((entry) => (
      sameArray(entry.matching.comparedFields, expectedGuardCompareFields)
        && sameArray(entry.staleStorage.comparedFields, expectedGuardCompareFields)
        && sameArray(entry.hashMismatch.comparedFields, expectedGuardCompareFields)
    )),
    matchingWritesAttempted: cases.length,
    matchingWritesApplied,
    staleStorageWriteAttempts: cases.length,
    staleStorageRejections,
    hashMismatchWriteAttempts: cases.length,
    hashMismatchRejections,
    unsafeWritesApplied,
    bytesWrittenOnRejectedWrites,
    mutationWorkOnRejectedWrites,
    caseHashes: cases.map((entry) => entry.caseHash),
    staleDecisionHashes: cases.map((entry) => sha256(entry.staleStorage)),
    hashMismatchDecisionHashes: cases.map((entry) => sha256(entry.hashMismatch)),
  };
}

function recordCorrectnessGates(evidence, options = {}) {
  const gates = recomputeChunkHashReleaseVerifierProofGates(evidence, options);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveChunkHashReleaseVerifierProof(evidence, options = {}) {
  const recomputedGates = recomputeChunkHashReleaseVerifierProofGates(evidence, options);
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
        releaseVerifierHash: sha256(evidence.releaseVerifier),
        hashVerificationHash: sha256(evidence.hashVerification),
        generatedCoverageHash: sha256(evidence.generatedCoverage),
        verifiedChunkCount: evidence.hashVerification.verifiedChunkCount,
        staleStorageRejections: evidence.generatedCoverage.staleStorageRejections,
        hashMismatchRejections: evidence.generatedCoverage.hashMismatchRejections,
        unsafeWritesApplied: evidence.generatedCoverage.unsafeWritesApplied,
        mutationWorkOnRejectedWrites: evidence.generatedCoverage.mutationWorkOnRejectedWrites,
        releaseVerifierCarryThrough: evidence.release.releaseVerifierCarryThrough,
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
    hashOnlyChunkHashOutput: output ? chunkHashEvidenceHasNoRawValues(output) : false,
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

function recomputeChunkHashReleaseVerifierProofGates(evidence, options = {}) {
  const command = evidence.command || {};
  const sourceGate = evidence.builtOn?.sourceGate || {};
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const storage = resources.storage || {};
  const processResources = resources.process || {};
  const journals = resources.journals || {};
  const transfer = evidence.transfer || {};
  const hashVerification = evidence.hashVerification || {};
  const generatedCoverage = evidence.generatedCoverage || {};
  const releaseVerifier = evidence.releaseVerifier || {};
  const releaseVerifierCarryThrough = releaseVerifier.carryThrough || {};
  const release = evidence.release || {};
  const verifiedEntries = Array.isArray(hashVerification.verifiedEntries)
    ? hashVerification.verifiedEntries
    : [];
  const caseHashes = Array.isArray(generatedCoverage.caseHashes)
    ? generatedCoverage.caseHashes
    : [];
  const staleDecisionHashes = Array.isArray(generatedCoverage.staleDecisionHashes)
    ? generatedCoverage.staleDecisionHashes
    : [];
  const hashMismatchDecisionHashes = Array.isArray(generatedCoverage.hashMismatchDecisionHashes)
    ? generatedCoverage.hashMismatchDecisionHashes
    : [];
  const releaseBlockers = Array.isArray(release.blockers) ? release.blockers : [];
  const commandReportsRuntimeResourcesGates = command.reportsRuntime === true
    && command.reportsResources === true
    && command.reportsPassFailGates === true
    && command.resourcesBeforeGatesBeforeThroughput === true
    && command.runtimeBudgetReported === true
    && command.passFailStatusesOnly === true
    && command.gateCount === 12
    && command.summary?.passed === 9
    && command.summary?.blocked === 3
    && command.summary?.failed === 0
    && command.summary?.speedClaimsAllowed === false;
  const allManifestChunksVerified = hashVerification.status === 'passed'
    && hashVerification.verifiedChunkCount === transfer.chunkCount
    && hashVerification.totalBytesVerified === transfer.fileBytes
    && hashVerification.allChunksMatchManifest === true
    && hashVerification.assembledHashMatchesFinalized === true
    && verifiedEntries.length === transfer.chunkCount
    && verifiedEntries.every((entry) => entry.digestMatches === true)
    && transfer.manifestComplete === true
    && transfer.byteRangeCoverage?.contiguous === true
    && transfer.receiptKeysUnique === true
    && transfer.finalStagingRecordPresent === true
    && transfer.canonicalVisibleBeforePublish === false
    && transfer.livePathChangesOnlyAfterFinalize === true;
  const generatedCoverageComplete = generatedCoverage.generatedEveryChunk === true
    && generatedCoverage.generatedCaseCount === transfer.chunkCount
    && generatedCoverage.coveredChunkCount === transfer.chunkCount
    && generatedCoverage.matchingWritesAttempted === transfer.chunkCount
    && generatedCoverage.matchingWritesApplied === transfer.chunkCount
    && caseHashes.length === transfer.chunkCount
    && staleDecisionHashes.length === transfer.chunkCount
    && hashMismatchDecisionHashes.length === transfer.chunkCount
    && generatedCoverage.guardCompareFieldsComplete === true
    && sameArray(generatedCoverage.guardCompareFields || [], expectedGuardCompareFields);
  const staleStorageRejected = generatedCoverage.staleStorageWriteAttempts === transfer.chunkCount
    && generatedCoverage.staleStorageRejections === transfer.chunkCount
    && generatedCoverage.unsafeWritesApplied === 0
    && generatedCoverage.bytesWrittenOnRejectedWrites === 0;
  const hashMismatchRejected = generatedCoverage.hashMismatchWriteAttempts === transfer.chunkCount
    && generatedCoverage.hashMismatchRejections === transfer.chunkCount
    && generatedCoverage.unsafeWritesApplied === 0
    && generatedCoverage.bytesWrittenOnRejectedWrites === 0;
  const noMutationWorkOnRejectedWrites = generatedCoverage.mutationWorkOnRejectedWrites === 0;
  const deterministicMatch = options.repeatedEvidence
    ? digest(deterministicChunkHashEvidenceProjection(evidence))
      === digest(deterministicChunkHashEvidenceProjection(options.repeatedEvidence))
    : false;
  const runtimeWithinBudget = runtime.profile === 'unit'
    && runtime.budgetStatus === 'passed'
    && runtime.durationMs <= runtime.budgets?.maxDurationMs
    && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
    && journals.allJournalsIntegrityOk === true
    && journals.durableJournalsContainNoRawValues === true
    && storage.receiptBackend === 'lab-file-journal-receipts'
    && storage.localStorageProof === 'support-only-lab-file-journal'
    && storage.productionBacked === false
    && storage.chunkReceipts === transfer.chunkCount
    && storage.finalStagingRecordPresent === true;
  const releaseVerifierCarryThroughClaimed = releaseVerifier.evidenceSource
    === 'chunk-hash-verification-release-verifier-v5'
    && releaseVerifier.command?.reportHash === command.reportHash
    && releaseVerifierCarryThrough.status === 'claimed-support-only'
    && releaseVerifierCarryThrough.fromRpp === 'RPP-0767'
    && releaseVerifierCarryThrough.sourceProofId === 'rpp-0767-chunk-hash-verification-v4'
    && releaseVerifierCarryThrough.checkedSourceGate === 'chunk-hash-verification'
    && releaseVerifierCarryThrough.guardedStaleStorageRejected === true
    && releaseVerifierCarryThrough.hashMismatchRejected === true
    && releaseVerifierCarryThrough.noMutationWorkOnRejectedWrites === true
    && releaseVerifierCarryThrough.outputAfterCorrectnessGates === true
    && sha256Pattern.test(releaseVerifierCarryThrough.proofHash || '')
    && release.releaseVerifierCarryThrough === 'claimed-support-only';
  const evidenceIsHashOnly = chunkHashEvidenceHasNoRawValues({
    command,
    runtime,
    resources,
    transfer,
    hashVerification,
    generatedCoverage,
    releaseVerifier,
    release,
  });

  return [
    proofGate('release-verifier-command-reports-runtime-resources-gates',
      commandReportsRuntimeResourcesGates, {
      reportsRuntime: command.reportsRuntime,
      reportsResources: command.reportsResources,
      reportsPassFailGates: command.reportsPassFailGates,
      gateCount: command.gateCount,
      summary: command.summary,
      gateStatuses: command.gateStatuses,
    }),
    proofGate('built-on-chunk-hash-verification-v4-passed', evidence.builtOn?.rppId === 'RPP-0767'
      && evidence.builtOn?.variant === 4
      && evidence.builtOn?.status === 'passed'
      && sourceGate.id === 'chunk-hash-verification'
      && sourceGate.status === 'passed'
      && sourceGate.allChunksMatchManifest === true
      && sourceGate.assembledHashMatchesFinalized === true
      && isSha256Hash(sourceGate.evidenceHash), {
      builtOnRppId: evidence.builtOn?.rppId,
      builtOnVariant: evidence.builtOn?.variant,
      sourceGateStatus: sourceGate.status,
      allChunksMatchManifest: sourceGate.allChunksMatchManifest,
      assembledHashMatchesFinalized: sourceGate.assembledHashMatchesFinalized,
    }),
    proofGate('all-manifest-chunks-verified', allManifestChunksVerified, {
      verifiedChunkCount: hashVerification.verifiedChunkCount,
      chunkCount: transfer.chunkCount,
      totalBytesVerified: hashVerification.totalBytesVerified,
      fileBytes: transfer.fileBytes,
      manifestComplete: transfer.manifestComplete,
    }),
    proofGate('generated-stale-storage-coverage', generatedCoverageComplete, {
      generatedCaseCount: generatedCoverage.generatedCaseCount,
      coveredChunkCount: generatedCoverage.coveredChunkCount,
      chunkCount: transfer.chunkCount,
      matchingWritesApplied: generatedCoverage.matchingWritesApplied,
      guardCompareFieldsComplete: generatedCoverage.guardCompareFieldsComplete,
    }),
    proofGate('guarded-writes-reject-stale-storage-state', staleStorageRejected, {
      staleStorageWriteAttempts: generatedCoverage.staleStorageWriteAttempts,
      staleStorageRejections: generatedCoverage.staleStorageRejections,
      unsafeWritesApplied: generatedCoverage.unsafeWritesApplied,
      bytesWrittenOnRejectedWrites: generatedCoverage.bytesWrittenOnRejectedWrites,
    }),
    proofGate('hash-mismatch-fails-closed', hashMismatchRejected, {
      hashMismatchWriteAttempts: generatedCoverage.hashMismatchWriteAttempts,
      hashMismatchRejections: generatedCoverage.hashMismatchRejections,
      unsafeWritesApplied: generatedCoverage.unsafeWritesApplied,
      bytesWrittenOnRejectedWrites: generatedCoverage.bytesWrittenOnRejectedWrites,
    }),
    proofGate('no-mutation-work-on-rejected-writes', noMutationWorkOnRejectedWrites, {
      mutationWorkOnRejectedWrites: generatedCoverage.mutationWorkOnRejectedWrites,
    }),
    proofGate('deterministic-release-verifier-support-evidence', deterministicMatch, {
      currentHash: digest(deterministicChunkHashEvidenceProjection(evidence)),
      repeatedHash: options.repeatedEvidence
        ? digest(deterministicChunkHashEvidenceProjection(options.repeatedEvidence))
        : null,
    }),
    proofGate('unit-storage-performance-budget', runtimeWithinBudget, {
      profile: runtime.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
      allJournalsIntegrityOk: journals.allJournalsIntegrityOk,
    }),
    proofGate('release-verifier-carry-through-claimed', releaseVerifierCarryThroughClaimed, {
      evidenceSource: releaseVerifier.evidenceSource,
      status: releaseVerifierCarryThrough.status,
      fromRpp: releaseVerifierCarryThrough.fromRpp,
      checkedSourceGate: releaseVerifierCarryThrough.checkedSourceGate,
      guardedStaleStorageRejected: releaseVerifierCarryThrough.guardedStaleStorageRejected,
      releaseVerifierCarryThrough: release.releaseVerifierCarryThrough,
    }),
    proofGate('hash-only-release-verifier-evidence', evidenceIsHashOnly, {
      rawValueEvidenceLeaks: evidenceIsHashOnly ? 0 : 1,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.productionThroughput === 'not-claimed'
      && release.speedClaimsAllowed === false
      && release.releaseVerifierCarryThrough === 'claimed-support-only'
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO'
      && releaseBlockers.includes('production-storage-receipts-not-measured')
      && releaseBlockers.includes('production-row-batch-executor-not-measured')
      && releaseBlockers.includes('production-atomic-group-commit-not-measured')
      && !releaseBlockers.includes('release-verifier-carry-through-not-claimed'), {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      productionThroughput: release.productionThroughput,
      releaseVerifierCarryThrough: release.releaseVerifierCarryThrough,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function unsafeChunkHashDecisions(evidence, repeatedEvidence) {
  const missingCommandReport = withPassedStatus(clone(evidence));
  missingCommandReport.command.reportsPassFailGates = false;
  missingCommandReport.command.gateCount = 0;
  missingCommandReport.releaseVerifier.command.reportsPassFailGates = false;
  missingCommandReport.releaseVerifier.command.gateCount = 0;

  const staleStorageAllowed = withPassedStatus(clone(evidence));
  staleStorageAllowed.generatedCoverage.staleStorageRejections -= 1;
  staleStorageAllowed.generatedCoverage.unsafeWritesApplied = 1;
  staleStorageAllowed.generatedCoverage.bytesWrittenOnRejectedWrites = 1;
  staleStorageAllowed.releaseVerifier.carryThrough.guardedStaleStorageRejected = false;

  const hashMismatchAllowed = withPassedStatus(clone(evidence));
  hashMismatchAllowed.generatedCoverage.hashMismatchRejections -= 1;
  hashMismatchAllowed.generatedCoverage.unsafeWritesApplied = 1;
  hashMismatchAllowed.generatedCoverage.bytesWrittenOnRejectedWrites = 1;
  hashMismatchAllowed.releaseVerifier.carryThrough.hashMismatchRejected = false;

  const missingGeneratedCoverage = withPassedStatus(clone(evidence));
  missingGeneratedCoverage.generatedCoverage.generatedCaseCount -= 1;
  missingGeneratedCoverage.generatedCoverage.coveredChunkCount -= 1;
  missingGeneratedCoverage.generatedCoverage.generatedEveryChunk = false;
  missingGeneratedCoverage.generatedCoverage.caseHashes =
    missingGeneratedCoverage.generatedCoverage.caseHashes.slice(1);

  const rejectedWriteMutationWork = withPassedStatus(clone(evidence));
  rejectedWriteMutationWork.generatedCoverage.mutationWorkOnRejectedWrites = 1;
  rejectedWriteMutationWork.releaseVerifier.carryThrough.noMutationWorkOnRejectedWrites = false;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const releaseVerifierNotClaimed = withPassedStatus(clone(evidence));
  releaseVerifierNotClaimed.release.releaseVerifierCarryThrough = 'not-claimed';
  releaseVerifierNotClaimed.release.blockers.push('release-verifier-carry-through-not-claimed');
  releaseVerifierNotClaimed.releaseVerifier.carryThrough.status = 'not-claimed';

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  const options = { repeatedEvidence };
  return {
    missingCommandReport: resolveChunkHashReleaseVerifierProof(missingCommandReport, options),
    staleStorageAllowed: resolveChunkHashReleaseVerifierProof(staleStorageAllowed, options),
    hashMismatchAllowed: resolveChunkHashReleaseVerifierProof(hashMismatchAllowed, options),
    missingGeneratedCoverage: resolveChunkHashReleaseVerifierProof(missingGeneratedCoverage, options),
    rejectedWriteMutationWork: resolveChunkHashReleaseVerifierProof(rejectedWriteMutationWork, options),
    overBudget: resolveChunkHashReleaseVerifierProof(overBudget, options),
    releaseVerifierNotClaimed: resolveChunkHashReleaseVerifierProof(releaseVerifierNotClaimed, options),
    prematurePassStatus: resolveChunkHashReleaseVerifierProof(prematurePassStatus, options),
  };
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

function publicBenchmarkProjection(report, productionBlockers) {
  return {
    benchmark: report.runtime.benchmarkId,
    profile: report.runtime.profile,
    runtime: {
      generatedAt: report.runtime.generatedAt,
      budgetStatus: report.runtime.budgetStatus,
      budgets: report.runtime.budgets,
    },
    shape: {
      fileBytes: report.shape.fileBytes,
      chunkSizeBytes: report.shape.chunkSizeBytes,
      chunkCount: report.shape.chunkCount,
      rowCount: report.shape.rowCount,
      mutations: report.shape.mutations,
    },
    rolloutSafetySummary: report.rolloutSafetyGates.summary,
    productionBlockers,
    claims: {
      labGuardedExecutorEvidence: report.claims.labGuardedExecutorEvidence,
      productionThroughputAllowed: report.claims.productionThroughput.allowed,
      productionThroughputStatus: report.claims.productionThroughput.status,
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
        finalizedHashHash: digest(report.resources?.transfer?.finalizedHash),
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

function publicHashVerificationProjection(hashVerification) {
  return {
    status: hashVerification.status,
    verifiedChunkCount: hashVerification.verifiedChunkCount,
    totalBytesVerified: hashVerification.totalBytesVerified,
    allChunksMatchManifest: hashVerification.allChunksMatchManifest,
    assembledHashMatchesFinalized: hashVerification.assembledHashMatchesFinalized,
    byteRangeCoverage: hashVerification.byteRangeCoverage,
    verifiedEntries: hashVerification.verifiedEntries,
  };
}

function publicChunkHashEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    command: evidence.command,
    runtime: evidence.runtime,
    resources: evidence.resources,
    transfer: evidence.transfer,
    hashVerification: evidence.hashVerification,
    generatedCoverage: evidence.generatedCoverage,
    releaseVerifier: evidence.releaseVerifier,
    release: evidence.release,
  };
}

function compareDeterministicChunkHashEvidence(firstEvidence, secondEvidence) {
  const firstProjectionHash = sha256(deterministicChunkHashEvidenceProjection(firstEvidence));
  const secondProjectionHash = sha256(deterministicChunkHashEvidenceProjection(secondEvidence));

  return {
    sameProjection: firstProjectionHash === secondProjectionHash,
    firstProjectionHash,
    secondProjectionHash,
    comparedFields: [
      'builtOn',
      'command',
      'benchmark',
      'runtime.generatedAt',
      'runtime.profile',
      'runtime.budgetStatus',
      'runtime.budgets',
      'resources.storage',
      'resources.journals',
      'resources.runtimeBudget',
      'transfer',
      'hashVerification',
      'generatedCoverage',
      'releaseVerifier',
      'release',
    ],
    ignoredVolatileFields: [
      'runtime.durationMs',
      'resources.process',
    ],
  };
}

function deterministicChunkHashEvidenceProjection(evidence) {
  return {
    schemaVersion: evidence.schemaVersion,
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    command: {
      gateIds: evidence.command.gateIds,
      gateStatuses: evidence.command.gateStatuses,
      gateCount: evidence.command.gateCount,
      summary: evidence.command.summary,
      reportHash: evidence.command.reportHash,
    },
    benchmark: evidence.benchmark,
    runtime: {
      generatedAt: evidence.runtime.generatedAt,
      profile: evidence.runtime.profile,
      budgetStatus: evidence.runtime.budgetStatus,
      budgets: evidence.runtime.budgets,
      conservativeBudgetReporting: evidence.runtime.conservativeBudgetReporting,
    },
    resources: {
      storage: evidence.resources.storage,
      journals: evidence.resources.journals,
      runtimeBudget: evidence.resources.runtimeBudget,
    },
    transfer: evidence.transfer,
    hashVerification: evidence.hashVerification,
    generatedCoverage: evidence.generatedCoverage,
    releaseVerifier: evidence.releaseVerifier,
    release: evidence.release,
  };
}

function supportOnlyReleasePosture(report, productionBlockers) {
  return {
    supportOnly: true,
    productionBacked: false,
    productionThroughput: report.throughput.productionThroughput,
    speedClaimsAllowed: report.rolloutSafetyGates.summary.speedClaimsAllowed,
    liveRemoteProductionService: 'not-claimed',
    productionStorageReceipts: 'not-claimed',
    productionRowBatchExecutor: 'not-claimed',
    productionAtomicGroupCommit: 'not-claimed',
    releaseVerifierCarryThrough: 'claimed-support-only',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: unique([
      ...productionBlockers,
      'live-production-service-not-supplied',
    ]),
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

function assertChunkGuardDecisionIsHashOnly(decision) {
  assert.match(decision.expectedStorageHash, hexSha256Pattern);
  assert.match(decision.observedStorageHash, hexSha256Pattern);
  assert.match(decision.plannedStorageHash, hexSha256Pattern);
  assertHashOnlyChunkHashEvidence(decision);
}

function assertHashOnlyChunkHashEvidence(value) {
  assert.equal(chunkHashEvidenceHasNoRawValues(value), true);
}

function chunkHashEvidenceHasNoRawValues(value) {
  return !rawChunkHashEvidencePattern().test(JSON.stringify(value));
}

function rawChunkHashEvidencePattern() {
  return /wp-content|catalog-export|row-payload|commerce|payments|post_content|option_value|meta_value|customer secret|private option value|https?:\/\/|Bearer\s+|Basic\s+|\/tmp\//i;
}

function manifestValueHash(value) {
  return sha256({ manifestValue: value });
}

function sha256(value) {
  return `sha256:${digest(value)}`;
}

function isSha256Hash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function objectKeyBefore(object, leftKey, rightKey) {
  const keys = Object.keys(object);
  return keys.indexOf(leftKey) !== -1
    && keys.indexOf(rightKey) !== -1
    && keys.indexOf(leftKey) < keys.indexOf(rightKey);
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
