import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  productionThroughputBlockers,
  runGuardedExecutorBenchmark,
} from '../scripts/bench/guarded-executor-benchmark.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0747-chunk-hash-verification-v3';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const benchmarkOptions = Object.freeze({
  profile: 'unit',
  fileBytes: 1024 * 1024,
  chunkSizeBytes: 256 * 1024,
  rowCount: 8,
  rowPayloadBytes: 64,
  maxDurationMs: 10_000,
  maxHeapUsedBytes: 256 * 1024 * 1024,
});
const expectedGateIds = Object.freeze([
  'built-on-chunk-hash-verification-passed',
  'all-manifest-chunks-verified',
  'generated-stale-storage-coverage',
  'guarded-writes-reject-stale-storage-state',
  'hash-mismatch-fails-closed',
  'no-mutation-work-on-rejected-writes',
  'unit-storage-performance-budget',
  'hash-only-storage-performance-evidence',
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

test('RPP-0747 variant 3 proves generated chunk hash coverage rejects stale storage', {
  concurrency: false,
}, () => {
  const proof = buildVariant3Proof();

  assert.equal(proof.rppId, 'RPP-0747');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 3);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0727');
  assert.equal(proof.builtOn.proofId, 'rpp-0727-chunk-hash-verification-v2');
  assert.equal(proof.builtOn.variant, 2);
  assert.equal(proof.builtOn.sourceGate.id, 'chunk-hash-verification');
  assert.equal(proof.builtOn.sourceGate.status, 'passed');
  assert.equal(proof.builtOn.sourceGate.allChunksMatchManifest, true);
  assert.equal(proof.builtOn.sourceGate.assembledHashMatchesFinalized, true);
  assert.match(proof.builtOn.sourceGate.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.profile, 'unit');
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
  assert.match(proof.transfer.planIdHash, /^[a-f0-9]{64}$/);
  assert.match(proof.transfer.resourceKeyHash, /^[a-f0-9]{64}$/);
  assert.match(proof.transfer.manifestDigestHash, /^[a-f0-9]{64}$/);
  assert.match(proof.transfer.finalizedHashHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.hashVerification.status, 'passed');
  assert.equal(proof.hashVerification.verifiedChunkCount, proof.transfer.chunkCount);
  assert.equal(proof.hashVerification.totalBytesVerified, proof.transfer.fileBytes);
  assert.equal(proof.hashVerification.allChunksMatchManifest, true);
  assert.equal(proof.hashVerification.assembledHashMatchesFinalized, true);
  assert.equal(proof.hashVerification.verifiedEntries.length, proof.transfer.chunkCount);
  assert.ok(proof.hashVerification.verifiedEntries.every((entry) => entry.digestMatches === true));

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
  assert.equal(proof.generatedCoverage.caseHashes.length, proof.transfer.chunkCount);
  assert.ok(proof.generatedCoverage.caseHashes.every((hash) => hash.match(/^sha256:[a-f0-9]{64}$/)));

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
  assert.equal(proof.correctness.hashOnlyChunkHashOutput, true);
  assert.equal(proof.correctness.chunkHashOutputEmittedAfterGates, true);
  assert.match(proof.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.staleStorageAllowed.updated, false);
  assert.equal(proof.unsafe.staleStorageAllowed.attemptedPassBlocked, true);
  assert.ok(
    proof.unsafe.staleStorageAllowed.blockedBy
      .includes('guarded-writes-reject-stale-storage-state'),
  );
  assert.equal(proof.unsafe.hashMismatchAllowed.updated, false);
  assert.equal(proof.unsafe.hashMismatchAllowed.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.hashMismatchAllowed.blockedBy.includes('hash-mismatch-fails-closed'));
  assert.equal(proof.unsafe.missingGeneratedCoverage.updated, false);
  assert.equal(proof.unsafe.missingGeneratedCoverage.attemptedPassBlocked, true);
  assert.ok(
    proof.unsafe.missingGeneratedCoverage.blockedBy
      .includes('generated-stale-storage-coverage'),
  );
  assert.equal(proof.unsafe.rejectedWriteMutationWork.updated, false);
  assert.equal(proof.unsafe.rejectedWriteMutationWork.attemptedPassBlocked, true);
  assert.ok(
    proof.unsafe.rejectedWriteMutationWork.blockedBy
      .includes('no-mutation-work-on-rejected-writes'),
  );
  assert.equal(proof.unsafe.overBudget.updated, false);
  assert.equal(proof.unsafe.overBudget.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.overBudget.blockedBy.includes('unit-storage-performance-budget'));
  assert.equal(proof.unsafe.prematurePassStatus.updated, false);
  assert.equal(proof.unsafe.prematurePassStatus.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  assert.equal(proof.release.supportOnly, true);
  assert.equal(proof.release.productionBacked, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO');
  assert.equal(proof.release.integrationRecommendation, 'NO-GO');
  assert.ok(proof.release.blockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.blockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.blockers.includes('production-atomic-group-commit-not-measured'));
  assert.equal(proof.redaction.rawValueEvidenceLeaks, 0);
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertHashOnlyChunkHashEvidence(proof);
});

test('RPP-0747 variant 3 generated chunk guards fail closed on stale storage and hash mismatch', {
  concurrency: false,
}, () => {
  const { report } = buildRecordedEvidence();
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

test('RPP-0747 variant 3 resolver blocks stale or incomplete chunk hash evidence', () => {
  const { evidence } = buildRecordedEvidence();
  const safeDecision = resolveChunkHashStoragePerformanceProof(evidence);
  const unsafeDecisions = unsafeChunkHashDecisions(evidence);

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
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyChunkHashEvidence(decision);
  }
});

function buildVariant3Proof() {
  const { report, evidence } = buildRecordedEvidence();
  const safeDecision = resolveChunkHashStoragePerformanceProof(evidence);
  const unsafe = projectUnsafeDecisions(unsafeChunkHashDecisions(evidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'hashVerification',
  );
  const supportOnlyRelease = evidence.release;
  const proofGates = [
    proofGate('guarded-benchmark-chunk-hash-verification-passed',
      report.evidence.guardedTransfer.hashVerification.status === 'passed', {
        verificationStatus: report.evidence.guardedTransfer.hashVerification.status,
        verifiedChunkCount: report.evidence.guardedTransfer.hashVerification.verifiedChunkCount,
      }),
    proofGate('chunk-hash-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
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
      && supportOnlyRelease.finalReleaseStatus === 'NO-GO'
      && supportOnlyRelease.integrationRecommendation === 'NO-GO', {
      finalReleaseStatus: supportOnlyRelease.finalReleaseStatus,
      integrationRecommendation: supportOnlyRelease.integrationRecommendation,
    }),
  ];
  const publicProof = {
    rppId: 'RPP-0747',
    proofId,
    variant: 3,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: evidence.builtOn,
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
      chunkHashOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    outputHash: safeDecision.outputHash,
    redaction: {
      mode: 'hash-and-count-only-chunk-hash-storage-performance',
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

function buildRecordedEvidence() {
  const report = runUnitBenchmark();
  const evidence = buildChunkHashStoragePerformanceEvidence({ report });
  recordCorrectnessGates(evidence);
  return { report, evidence };
}

function runUnitBenchmark() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0747-chunk-hash-v3-'));
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

function buildChunkHashStoragePerformanceEvidence({ report }) {
  const hashVerification = report.evidence.guardedTransfer.hashVerification;
  const guardCases = buildGeneratedChunkHashGuardCases(report);
  const productionBlockers = productionThroughputBlockers(report);

  return {
    schemaVersion: 1,
    rppId: 'RPP-0747',
    proofId,
    variant: 3,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0727',
      proofId: 'rpp-0727-chunk-hash-verification-v2',
      variant: 2,
      sourceGate: {
        id: 'chunk-hash-verification',
        status: hashVerification.status,
        allChunksMatchManifest: hashVerification.allChunksMatchManifest,
        assembledHashMatchesFinalized: hashVerification.assembledHashMatchesFinalized,
        evidenceHash: digest(publicHashVerificationProjection(hashVerification)),
      },
    },
    benchmark: publicBenchmarkProjection(report, productionBlockers),
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
    generatedCoverage: summarizeGeneratedChunkHashGuardCases(guardCases, report.shape.chunkCount),
    release: supportOnlyReleasePosture(report, productionBlockers),
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
        generatedCase: 'rpp-0747-v3',
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
    adapter: 'support-only-generated-chunk-guard',
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

function recordCorrectnessGates(evidence) {
  const gates = recomputeChunkHashProofGates(evidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveChunkHashStoragePerformanceProof(evidence) {
  const recomputedGates = recomputeChunkHashProofGates(evidence);
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
        hashVerificationHash: sha256(evidence.hashVerification),
        generatedCoverageHash: sha256(evidence.generatedCoverage),
        verifiedChunkCount: evidence.hashVerification.verifiedChunkCount,
        staleStorageRejections: evidence.generatedCoverage.staleStorageRejections,
        hashMismatchRejections: evidence.generatedCoverage.hashMismatchRejections,
        unsafeWritesApplied: evidence.generatedCoverage.unsafeWritesApplied,
        mutationWorkOnRejectedWrites: evidence.generatedCoverage.mutationWorkOnRejectedWrites,
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

function recomputeChunkHashProofGates(evidence) {
  const sourceGate = evidence.builtOn?.sourceGate || {};
  const runtime = evidence.runtime || {};
  const resources = evidence.resources || {};
  const storage = resources.storage || {};
  const processResources = resources.process || {};
  const journals = resources.journals || {};
  const transfer = evidence.transfer || {};
  const hashVerification = evidence.hashVerification || {};
  const generatedCoverage = evidence.generatedCoverage || {};
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

  return [
    proofGate('built-on-chunk-hash-verification-passed', evidence.builtOn?.rppId === 'RPP-0727'
      && evidence.builtOn?.variant === 2
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
    proofGate('unit-storage-performance-budget', runtimeWithinBudget, {
      profile: runtime.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
      allJournalsIntegrityOk: journals.allJournalsIntegrityOk,
    }),
    proofGate('hash-only-storage-performance-evidence', chunkHashEvidenceHasNoRawValues({
      runtime,
      resources,
      transfer,
      hashVerification,
      generatedCoverage,
      release,
    }), {
      rawValueEvidenceLeaks: chunkHashEvidenceHasNoRawValues({
        runtime,
        resources,
        transfer,
        hashVerification,
        generatedCoverage,
        release,
      }) ? 0 : 1,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.productionThroughput === 'not-claimed'
      && release.speedClaimsAllowed === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO'
      && releaseBlockers.includes('production-storage-receipts-not-measured')
      && releaseBlockers.includes('production-row-batch-executor-not-measured')
      && releaseBlockers.includes('production-atomic-group-commit-not-measured'), {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      productionThroughput: release.productionThroughput,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];
}

function unsafeChunkHashDecisions(evidence) {
  const staleStorageAllowed = withPassedStatus(clone(evidence));
  staleStorageAllowed.generatedCoverage.staleStorageRejections -= 1;
  staleStorageAllowed.generatedCoverage.unsafeWritesApplied = 1;
  staleStorageAllowed.generatedCoverage.bytesWrittenOnRejectedWrites = 1;

  const hashMismatchAllowed = withPassedStatus(clone(evidence));
  hashMismatchAllowed.generatedCoverage.hashMismatchRejections -= 1;
  hashMismatchAllowed.generatedCoverage.unsafeWritesApplied = 1;
  hashMismatchAllowed.generatedCoverage.bytesWrittenOnRejectedWrites = 1;

  const missingGeneratedCoverage = withPassedStatus(clone(evidence));
  missingGeneratedCoverage.generatedCoverage.generatedCaseCount -= 1;
  missingGeneratedCoverage.generatedCoverage.coveredChunkCount -= 1;
  missingGeneratedCoverage.generatedCoverage.generatedEveryChunk = false;
  missingGeneratedCoverage.generatedCoverage.caseHashes =
    missingGeneratedCoverage.generatedCoverage.caseHashes.slice(1);

  const rejectedWriteMutationWork = withPassedStatus(clone(evidence));
  rejectedWriteMutationWork.generatedCoverage.mutationWorkOnRejectedWrites = 1;

  const overBudget = withPassedStatus(clone(evidence));
  overBudget.runtime.durationMs = overBudget.runtime.budgets.maxDurationMs + 1;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    staleStorageAllowed: resolveChunkHashStoragePerformanceProof(staleStorageAllowed),
    hashMismatchAllowed: resolveChunkHashStoragePerformanceProof(hashMismatchAllowed),
    missingGeneratedCoverage: resolveChunkHashStoragePerformanceProof(missingGeneratedCoverage),
    rejectedWriteMutationWork: resolveChunkHashStoragePerformanceProof(rejectedWriteMutationWork),
    overBudget: resolveChunkHashStoragePerformanceProof(overBudget),
    prematurePassStatus: resolveChunkHashStoragePerformanceProof(prematurePassStatus),
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
    runtime: evidence.runtime,
    resources: evidence.resources,
    transfer: evidence.transfer,
    hashVerification: evidence.hashVerification,
    generatedCoverage: evidence.generatedCoverage,
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
    releaseVerifierCarryThrough: 'not-claimed',
    finalReleaseStatus: 'NO-GO',
    integrationRecommendation: 'NO-GO',
    blockers: unique([
      ...productionBlockers,
      'live-production-service-not-supplied',
      'release-verifier-carry-through-not-claimed',
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
  assert.match(decision.expectedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(decision.observedStorageHash, /^[a-f0-9]{64}$/);
  assert.match(decision.plannedStorageHash, /^[a-f0-9]{64}$/);
  assertHashOnlyChunkHashEvidence(decision);
}

function assertHashOnlyChunkHashEvidence(value) {
  assert.equal(chunkHashEvidenceHasNoRawValues(value), true);
}

function chunkHashEvidenceHasNoRawValues(value) {
  return !rawChunkHashEvidencePattern().test(JSON.stringify(value));
}

function rawChunkHashEvidencePattern() {
  return /wp-content|catalog-export|row-payload|commerce|payments|post_content|option_value|meta_value|customer secret|private option value|https?:\/\/|Bearer\s+|Basic\s+/i;
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
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
