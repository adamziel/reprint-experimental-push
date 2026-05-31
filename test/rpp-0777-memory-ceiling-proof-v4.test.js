import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  FILESYSTEM_MEMORY_CEILING_BOUNDARY,
  applyFilesystemMemoryCeilingWrite,
  createFilesystemMemoryCeilingTempRoot,
} from '../src/filesystem-memory-ceiling-proof.js';
import {
  FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX,
  ensureFilesystemDirectoryUsable,
  filesystemStorageHash,
  filesystemTempLeakPaths,
  readFilesystemStorageDescriptor,
} from '../src/filesystem-compare-rename-write.js';
import {
  FILESYSTEM_MEMORY_CEILING_BENCHMARK_ID,
  runFilesystemMemoryCeilingProofBenchmark,
} from '../scripts/bench/filesystem-memory-ceiling-proof.js';
import { digest } from '../src/stable-json.js';

const proofId = 'rpp-0777-memory-ceiling-proof-v4';
const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const fileBytes = 64 * 1024;
const chunkSizeBytes = 4096;
const maxBufferedBytes = 4096;
const maxDurationMs = 100_000;
const maxHeapUsedBytes = 1024 * 1024 * 1024;
const expectedGateIds = Object.freeze([
  'benchmark-memory-ceiling-gates-pass',
  'guarded-writes-reject-stale-storage-state',
  'stale-rejection-preserves-drift',
  'memory-ceiling-held-before-live-compare',
  'same-directory-compare-before-rename',
  'deterministic-hash-only-evidence',
  'runtime-resource-budget',
  'support-only-release-no-go',
]);

test('RPP-0777 variant 4 rejects stale storage state after streamed memory-ceiling temp write', () => {
  const rootDir = createFilesystemMemoryCeilingTempRoot('reprint-rpp-0777-stale-');
  const logicalPath = 'wp-content/uploads/rpp-0777/stale/reject.txt';
  writeFixture(rootDir, logicalPath, 'rpp0777-base-stale-payload');
  const expectedStorage = readFilesystemStorageDescriptor({ rootDir, logicalPath });

  let afterTempWriteObserved = false;
  const stale = applyFilesystemMemoryCeilingWrite({
    rootDir,
    logicalPath,
    expectedResource: resourceEvidence('stale', logicalPath, expectedStorage),
    expectedStorage,
    plannedSizeBytes: fileBytes,
    createChunk: deterministicChunkSource('rpp0777-planned-stale-payload'),
    operation: 'update',
    driver: 'rpp-0777-focused-proof',
    chunkSizeBytes,
    maxBufferedBytes,
    afterTempWrite: ({ absolutePath }) => {
      afterTempWriteObserved = true;
      assert.equal(readFixture(rootDir, logicalPath), 'rpp0777-base-stale-payload');
      assert.equal(tempNamesBesideTarget(absolutePath).length, 1);
      fs.writeFileSync(absolutePath, 'rpp0777-drift-stale-payload');
    },
  });

  assert.equal(afterTempWriteObserved, true);
  assert.equal(stale.applied, false);
  assert.equal(readFixture(rootDir, logicalPath), 'rpp0777-drift-stale-payload');
  assert.equal(stale.storageGuard.boundary, FILESYSTEM_MEMORY_CEILING_BOUNDARY);
  assert.equal(stale.storageGuard.operation, 'update');
  assert.equal(stale.storageGuard.outcome, 'stale-at-write');
  assert.equal(stale.storageGuard.renameAttempted, false);
  assert.equal(stale.storageGuard.tempRemovedOnStale, true);
  assert.equal(stale.storageGuard.sameDirectoryTemp, true);
  assert.equal(stale.storageGuard.compareBeforeRename, true);
  assert.equal(stale.storageGuard.atomicVisibilityBoundary, 'same-directory-rename');
  assert.deepEqual(stale.storageGuard.steps, [
    'stream-planned-chunks-to-temp',
    'read-live-storage',
    'compare-expected-storage-hash',
  ]);
  assert.equal(stale.storageGuard.memoryCeiling.policy, 'planned-payload-streamed-in-bounded-chunks');
  assert.equal(stale.storageGuard.memoryCeiling.enforcePoint, 'before-live-storage-compare');
  assert.equal(stale.storageGuard.memoryCeiling.totalPlannedBytes, fileBytes);
  assert.equal(stale.storageGuard.memoryCeiling.chunkSizeBytes, chunkSizeBytes);
  assert.equal(stale.storageGuard.memoryCeiling.maxBufferedBytes, maxBufferedBytes);
  assert.equal(stale.storageGuard.memoryCeiling.maxObservedBufferedBytes, maxBufferedBytes);
  assert.equal(stale.storageGuard.memoryCeiling.chunkCount, fileBytes / chunkSizeBytes);
  assert.equal(stale.storageGuard.memoryCeiling.payloadBytesGreaterThanCeiling, true);
  assert.equal(stale.storageGuard.memoryCeiling.ceilingHeld, true);
  assert.equal(stale.storageGuard.memoryCeiling.fullPayloadBufferUsed, false);
  assert.equal(stale.storageGuard.memoryCeiling.plannedPayloadMaterialized, false);
  assert.notEqual(stale.storageGuard.actualStorageHash, stale.storageGuard.expectedStorageHash);
  assert.notEqual(stale.storageGuard.actualStorageHash, stale.storageGuard.plannedStorageHash);
  assert.equal(
    stale.storageGuard.actualStorageHash,
    filesystemStorageHash(readFilesystemStorageDescriptor({ rootDir, logicalPath })),
  );
  assert.equal(filesystemTempLeakPaths(rootDir).length, 0);
  assertStorageGuardHasNoRawValues(stale.storageGuard, rootDir);
});

test('RPP-0777 variant 4 proves storage performance gates and support-only NO-GO', {
  concurrency: false,
}, () => {
  const proof = buildVariant4Proof();

  assert.equal(proof.rppId, 'RPP-0777');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 4);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.rppId, 'RPP-0717');
  assert.equal(proof.builtOn.benchmark, FILESYSTEM_MEMORY_CEILING_BENCHMARK_ID);
  assert.equal(proof.builtOn.ok, true);
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.runtime.generatedAt, fixedNow.toISOString());
  assert.equal(proof.runtime.durationMs >= 0, true);
  assert.equal(proof.runtime.durationMs <= proof.runtime.budgets.maxDurationMs, true);
  assert.equal(proof.resources.process.heapUsedBytes <= proof.runtime.budgets.maxHeapUsedBytes, true);
  assert.equal(proof.resources.storage.boundary, FILESYSTEM_MEMORY_CEILING_BOUNDARY);
  assert.equal(proof.resources.storage.engine, 'filesystem');
  assert.equal(proof.resources.storage.tempPlacement, 'same-directory');
  assert.equal(proof.resources.workload.updateFiles, 4);
  assert.equal(proof.resources.workload.createFiles, 3);
  assert.equal(proof.resources.workload.staleFiles, 3);
  assert.equal(proof.resources.storage.guardedWritesAttempted, 10);
  assert.equal(proof.resources.storage.appliedWrites, 7);
  assert.equal(proof.resources.storage.staleAtWriteWrites, 3);
  assert.equal(proof.resources.storage.unsafeRenameOnStaleWrites, 0);
  assert.equal(proof.resources.memoryCeiling.maxObservedBufferedBytes, maxBufferedBytes);
  assert.equal(proof.resources.memoryCeiling.ceilingBreaches, 0);
  assert.equal(proof.resources.memoryCeiling.fullPayloadBufferWrites, 0);
  assert.equal(proof.resources.memoryCeiling.materializedPayloadWrites, 0);
  assert.equal(proof.resources.memoryCeiling.streamedWrites, 10);
  assert.equal(proof.resources.bytes.driftPreservedBytes, 3 * fileBytes);
  assert.equal(proof.resources.tempLeaks, 0);

  assert.equal(proof.guardedWrites.expectedWriteCount, 10);
  assert.equal(proof.guardedWrites.appliedSampleCount, 7);
  assert.equal(proof.guardedWrites.staleSampleCount, 3);
  assert.equal(proof.guardedWrites.staleWriteHashes.length, 3);
  assert.match(proof.guardedWrites.guardSummaryHash, /^sha256:[a-f0-9]{64}$/);
  assert.ok(proof.guardedWrites.storageGuardSamples.every((sample) => (
    sample.sampleHash.match(/^sha256:[a-f0-9]{64}$/)
      && sample.sameDirectoryTemp === true
      && sample.compareBeforeRename === true
      && sample.memoryCeiling.ceilingHeld === true
  )));
  const staleSamples = proof.guardedWrites.storageGuardSamples
    .filter((sample) => sample.outcome === 'stale-at-write');
  assert.equal(staleSamples.length, 3);
  assert.ok(staleSamples.every((sample) => (
    sample.outcome === 'stale-at-write'
      && sample.renameAttempted === false
      && sample.tempRemovedOnStale === true
      && sample.actualStorageHash !== sample.expectedStorageHash
      && sample.actualStorageHash !== sample.plannedStorageHash
  )));

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
  ]);
  assert.equal(proof.correctness.correctnessGatesHoldBeforeOutput, true);
  assert.equal(proof.correctness.correctnessGatesRecordedBeforeOutput, true);
  assert.equal(proof.correctness.hashOnlyGuardOutput, true);
  assert.equal(proof.correctness.guardedWriteOutputEmittedAfterGates, true);
  assert.match(proof.guardedWrites.outputHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
  ]);

  assert.equal(proof.unsafe.staleWriteCountMismatch.updated, false);
  assert.equal(proof.unsafe.staleWriteCountMismatch.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.staleWriteCountMismatch.blockedBy.includes('guarded-writes-reject-stale-storage-state'));
  assert.equal(proof.unsafe.unsafeRenameOnStale.updated, false);
  assert.equal(proof.unsafe.unsafeRenameOnStale.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.unsafeRenameOnStale.blockedBy.includes('guarded-writes-reject-stale-storage-state'));
  assert.equal(proof.unsafe.memoryCeilingBreach.updated, false);
  assert.equal(proof.unsafe.memoryCeilingBreach.attemptedPassBlocked, true);
  assert.ok(proof.unsafe.memoryCeilingBreach.blockedBy.includes('memory-ceiling-held-before-live-compare'));
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
  assertHashOnlyMemoryCeilingEvidence(proof);
});

test('RPP-0777 variant 4 fails closed for stale guard, memory, and premature evidence', () => {
  const { evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveMemoryCeilingProof(evidence, { repeatedEvidence });
  const unsafeDecisions = unsafeMemoryEvidenceDecisions(evidence, repeatedEvidence);

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
  ]);

  assert.equal(unsafeDecisions.staleWriteCountMismatch.updated, false);
  assert.ok(unsafeDecisions.staleWriteCountMismatch.blockedBy.includes('guarded-writes-reject-stale-storage-state'));
  assert.equal(unsafeDecisions.unsafeRenameOnStale.updated, false);
  assert.ok(unsafeDecisions.unsafeRenameOnStale.blockedBy.includes('guarded-writes-reject-stale-storage-state'));
  assert.equal(unsafeDecisions.memoryCeilingBreach.updated, false);
  assert.ok(unsafeDecisions.memoryCeilingBreach.blockedBy.includes('memory-ceiling-held-before-live-compare'));
  assert.equal(unsafeDecisions.prematurePassStatus.updated, false);
  assert.ok(unsafeDecisions.prematurePassStatus.blockedBy.includes('correctness-gates-not-recorded'));

  for (const decision of Object.values(unsafeDecisions)) {
    assert.equal(decision.output, null);
    assert.equal(decision.outputEmitted, false);
    assert.equal(decision.attemptedPassBlocked, true);
    assert.match(decision.decisionHash, /^[a-f0-9]{64}$/);
    assertHashOnlyMemoryCeilingEvidence(decision);
  }
});

function buildVariant4Proof() {
  const { benchmark, evidence, repeatedEvidence } = buildRecordedEvidencePair();
  const safeDecision = resolveMemoryCeilingProof(evidence, { repeatedEvidence });
  const unsafe = projectUnsafeDecisions(unsafeMemoryEvidenceDecisions(evidence, repeatedEvidence));
  const correctnessGatesRecordedBeforeOutput = objectKeyBefore(
    evidence,
    'correctnessGates',
    'guardedWrites',
  );
  const benchmarkGatesPass = benchmark.ok && benchmark.gates.every((gate) => gate.status === 'pass');
  const supportOnlyRelease = supportOnlyReleasePosture();
  const proofGates = [
    proofGate('benchmark-memory-ceiling-gates-pass', benchmarkGatesPass, {
      benchmarkGateStatuses: benchmark.gates.map((gate) => gate.status),
      durationMs: benchmark.runtime.durationMs,
      heapUsedBytes: benchmark.resources.process.heapUsedBytes,
    }),
    proofGate('guarded-output-after-correctness-gates', safeDecision.updated
      && safeDecision.outputEmitted
      && correctnessGatesRecordedBeforeOutput, {
      outputEmitted: safeDecision.outputEmitted,
      correctnessGatesRecordedBeforeOutput,
      blockedBy: safeDecision.blockedBy,
    }),
    proofGate('unsafe-memory-evidence-fails-closed', Object.values(unsafe).every((decision) => (
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
    rppId: 'RPP-0777',
    proofId,
    variant: 4,
    status: proofGates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed',
    builtOn: {
      rppId: 'RPP-0717',
      benchmark: benchmark.benchmark,
      ok: benchmark.ok,
      profile: benchmark.profile,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      workload: benchmark.resources.workload,
      storage: benchmark.resources.storage,
      memoryCeiling: benchmark.resources.memoryCeiling,
      bytes: benchmark.resources.bytes,
      process: benchmark.resources.process,
      tempLeaks: benchmark.resources.tempLeaks,
    },
    benchmark: publicBenchmarkProjection(benchmark),
    guardedWrites: {
      ...evidence.guardedWrites,
      outputHash: safeDecision.outputHash,
    },
    correctness: {
      gateIds: evidence.correctnessGates.map((gate) => gate.id),
      recomputedGateVector: safeDecision.recomputedGates,
      correctnessGatesRecordedBeforeOutput,
      correctnessGatesHoldBeforeOutput: safeDecision.correctnessGatesHold,
      hashOnlyGuardOutput: safeDecision.hashOnlyGuardOutput,
      guardedWriteOutputEmittedAfterGates: safeDecision.outputEmitted,
    },
    unsafe,
    gates: proofGates,
    release: supportOnlyRelease,
    redaction: {
      mode: 'hash-only-storage-performance-proof',
      rawValueEvidenceLeaks: benchmark.deterministicCoverage.rawValueEvidenceLeaks,
      publicMemoryEvidenceHash: digest(publicMemoryEvidenceProjection(evidence)),
      repeatedMemoryEvidenceHash: digest(publicMemoryEvidenceProjection(repeatedEvidence)),
      laneDecisionHash: safeDecision.decisionHash,
    },
  };

  return {
    ...publicProof,
    evidenceHash: digest(publicProof),
  };
}

function buildRecordedEvidencePair() {
  const benchmark = runFilesystemMemoryCeilingProofBenchmark(benchmarkOptions());
  const repeatedBenchmark = runFilesystemMemoryCeilingProofBenchmark(benchmarkOptions());
  const evidence = buildMemoryCeilingEvidence(benchmark);
  const repeatedEvidence = buildMemoryCeilingEvidence(repeatedBenchmark);

  recordCorrectnessGates(evidence, repeatedEvidence);
  recordCorrectnessGates(repeatedEvidence, evidence);
  return { benchmark, evidence, repeatedEvidence };
}

function benchmarkOptions(overrides = {}) {
  return {
    profile: 'unit',
    now: fixedNow,
    updateFiles: 4,
    createFiles: 3,
    staleFiles: 3,
    fileBytes,
    chunkSizeBytes,
    maxBufferedBytes,
    maxDurationMs,
    maxHeapUsedBytes,
    seed: proofId,
    ...overrides,
  };
}

function buildMemoryCeilingEvidence(benchmark) {
  return {
    schemaVersion: 1,
    rppId: 'RPP-0777',
    proofId,
    variant: 4,
    status: 'pending',
    builtOn: {
      rppId: 'RPP-0717',
      benchmark: benchmark.benchmark,
      evidenceHash: digest(publicBenchmarkProjection(benchmark)),
    },
    benchmark: {
      ok: benchmark.ok,
      gateVector: gateStatuses(benchmark),
    },
    correctnessGates: [],
    workload: benchmark.resources.workload,
    storage: benchmark.resources.storage,
    memory: {
      ...benchmark.resources.memoryCeiling,
      maxBufferedBytes: benchmark.runtime.budgets.maxBufferedBytes,
      chunkSizeBytes: benchmark.runtime.budgets.chunkSizeBytes,
    },
    bytes: benchmark.resources.bytes,
    guardedWrites: collectMemoryCeilingGuardEvidence(benchmark),
    runtime: {
      generatedAt: benchmark.runtime.generatedAt,
      durationMs: benchmark.runtime.durationMs,
      budgets: benchmark.runtime.budgets,
    },
    resources: {
      process: benchmark.resources.process,
      tempLeaks: benchmark.resources.tempLeaks,
    },
    release: supportOnlyReleasePosture(),
  };
}

function collectMemoryCeilingGuardEvidence(benchmark) {
  const samples = benchmark.deterministicCoverage.evidenceSamples.map(storageGuardSampleSummary);
  const staleSamples = samples.filter((sample) => sample.outcome === 'stale-at-write');
  const summaryCore = {
    expectedWriteCount: benchmark.resources.workload.expectedWrites,
    sampleCount: samples.length,
    appliedSampleCount: samples.filter((sample) => sample.outcome === 'applied').length,
    staleSampleCount: staleSamples.length,
    staleWriteHashes: staleSamples.map((sample) => sample.sampleHash),
    sampleHashes: samples.map((sample) => sample.sampleHash),
    storageGuardSamples: samples,
  };

  return {
    ...summaryCore,
    guardSummaryHash: sha256(summaryCore),
  };
}

function storageGuardSampleSummary(evidence) {
  const core = {
    boundary: evidence.boundary,
    adapter: evidence.adapter,
    engine: evidence.engine,
    driver: evidence.driver,
    operation: evidence.operation,
    comparedFields: evidence.comparedFields,
    expectedResourceHash: evidence.expectedResourceHash,
    expectedStorageHash: evidence.expectedStorageHash,
    actualStorageHash: evidence.actualStorageHash,
    plannedStorageHash: evidence.plannedStorageHash,
    outcome: evidence.outcome,
    sameDirectoryTemp: evidence.sameDirectoryTemp,
    compareBeforeRename: evidence.compareBeforeRename,
    renameAttempted: evidence.renameAttempted,
    tempRemovedOnStale: evidence.tempRemovedOnStale,
    atomicVisibilityBoundary: evidence.atomicVisibilityBoundary,
    memoryCeiling: evidence.memoryCeiling,
    bytesCompared: evidence.bytesCompared,
    bytesWrittenToTemp: evidence.bytesWrittenToTemp,
    steps: evidence.steps,
  };

  return {
    ...core,
    sampleHash: sha256(core),
  };
}

function recordCorrectnessGates(evidence, repeatedEvidence) {
  const gates = recomputeMemoryCeilingProofGates(evidence, repeatedEvidence);
  evidence.correctnessGates = gates.map((gate) => ({
    id: gate.id,
    status: gate.status === 'pass' ? 'passed' : 'failed',
    evidenceHash: digest(gate.metrics),
  }));
  evidence.status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  return evidence;
}

function resolveMemoryCeilingProof(evidence, { repeatedEvidence }) {
  const recomputedGates = recomputeMemoryCeilingProofGates(evidence, repeatedEvidence);
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
        guardSummaryHash: evidence.guardedWrites.guardSummaryHash,
        staleWriteHashSetHash: sha256(evidence.guardedWrites.staleWriteHashes),
        staleStorageOutcome: 'stale-at-write',
        maxObservedBufferedBytes: evidence.memory.maxObservedBufferedBytes,
        maxBufferedBytes: evidence.memory.maxBufferedBytes,
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
    hashOnlyGuardOutput: output ? memoryCeilingEvidenceHasNoRawValues(output) : false,
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

function recomputeMemoryCeilingProofGates(evidence, repeatedEvidence) {
  const samples = Array.isArray(evidence.guardedWrites?.storageGuardSamples)
    ? evidence.guardedWrites.storageGuardSamples
    : [];
  const staleSamples = samples.filter((sample) => sample.outcome === 'stale-at-write');
  const appliedSamples = samples.filter((sample) => sample.outcome === 'applied');
  const benchmarkGatesPass = evidence.benchmark?.ok === true
    && Array.isArray(evidence.benchmark?.gateVector)
    && evidence.benchmark.gateVector.every((gate) => gate.status === 'pass');
  const staleRejected = evidence.storage?.staleAtWriteWrites === evidence.workload?.staleFiles
    && evidence.guardedWrites?.staleSampleCount === evidence.workload?.staleFiles
    && staleSamples.length === evidence.workload?.staleFiles
    && evidence.storage?.unsafeRenameOnStaleWrites === 0
    && staleSamples.every((sample) => (
      sample.renameAttempted === false
        && sample.tempRemovedOnStale === true
        && sample.actualStorageHash !== sample.expectedStorageHash
        && sample.actualStorageHash !== sample.plannedStorageHash
    ));
  const stalePreserved = evidence.bytes?.driftPreservedBytes === evidence.workload?.staleFiles * evidence.workload?.fileBytes
    && evidence.storage?.staleAtWriteWrites === evidence.workload?.staleFiles;
  const memory = evidence.memory || {};
  const memoryCeilingHeld = memory.ceilingBreaches === 0
    && memory.fullPayloadBufferWrites === 0
    && memory.materializedPayloadWrites === 0
    && memory.maxObservedBufferedBytes <= memory.maxBufferedBytes
    && memory.payloadBytesGreaterThanCeilingWrites === evidence.storage?.guardedWritesAttempted
    && memory.streamedWrites === evidence.storage?.guardedWritesAttempted
    && samples.length === evidence.storage?.guardedWritesAttempted
    && samples.every((sample) => (
      sample.memoryCeiling?.enforcePoint === 'before-live-storage-compare'
        && sample.memoryCeiling?.ceilingHeld === true
        && sample.memoryCeiling?.fullPayloadBufferUsed === false
        && sample.memoryCeiling?.plannedPayloadMaterialized === false
        && sample.memoryCeiling?.maxObservedBufferedBytes <= sample.memoryCeiling?.maxBufferedBytes
    ));
  const compareMetrics = compareBeforeRenameMetrics(samples);
  const deterministicProjection = Boolean(repeatedEvidence)
    && digest(publicMemoryEvidenceProjection(evidence)) === digest(publicMemoryEvidenceProjection(repeatedEvidence));
  const hashOnlyEvidence = memoryCeilingEvidenceHasNoRawValues(publicMemoryEvidenceProjection(evidence));
  const runtime = evidence.runtime || {};
  const processResources = evidence.resources?.process || {};
  const release = evidence.release || {};

  return [
    proofGate('benchmark-memory-ceiling-gates-pass', benchmarkGatesPass, {
      benchmarkGateVector: evidence.benchmark?.gateVector || [],
    }),
    proofGate('guarded-writes-reject-stale-storage-state', staleRejected, {
      staleAtWriteWrites: evidence.storage?.staleAtWriteWrites,
      expectedStaleWrites: evidence.workload?.staleFiles,
      staleSampleCount: staleSamples.length,
      unsafeRenameOnStaleWrites: evidence.storage?.unsafeRenameOnStaleWrites,
      staleWriteHashes: staleSamples.map((sample) => sample.sampleHash),
    }),
    proofGate('stale-rejection-preserves-drift', stalePreserved, {
      driftPreservedBytes: evidence.bytes?.driftPreservedBytes,
      expectedDriftPreservedBytes: evidence.workload?.staleFiles * evidence.workload?.fileBytes,
    }),
    proofGate('memory-ceiling-held-before-live-compare', memoryCeilingHeld, {
      maxObservedBufferedBytes: memory.maxObservedBufferedBytes,
      maxBufferedBytes: memory.maxBufferedBytes,
      ceilingBreaches: memory.ceilingBreaches,
      streamedWrites: memory.streamedWrites,
      guardedWritesAttempted: evidence.storage?.guardedWritesAttempted,
    }),
    proofGate('same-directory-compare-before-rename', compareMetrics.pass, compareMetrics),
    proofGate('deterministic-hash-only-evidence', deterministicProjection && hashOnlyEvidence, {
      firstEvidenceHash: digest(publicMemoryEvidenceProjection(evidence)),
      repeatedEvidenceHash: repeatedEvidence ? digest(publicMemoryEvidenceProjection(repeatedEvidence)) : '',
      rawValueEvidenceLeaks: hashOnlyEvidence ? 0 : 1,
    }),
    proofGate('runtime-resource-budget', (
      runtime.durationMs <= runtime.budgets?.maxDurationMs
        && processResources.heapUsedBytes <= runtime.budgets?.maxHeapUsedBytes
        && evidence.resources?.tempLeaks === 0
    ), {
      durationMs: runtime.durationMs,
      heapUsedBytes: processResources.heapUsedBytes,
      maxDurationMs: runtime.budgets?.maxDurationMs,
      maxHeapUsedBytes: runtime.budgets?.maxHeapUsedBytes,
      tempLeaks: evidence.resources?.tempLeaks,
    }),
    proofGate('support-only-release-no-go', release.supportOnly === true
      && release.productionBacked === false
      && release.finalReleaseStatus === 'NO-GO'
      && release.integrationRecommendation === 'NO-GO', {
      supportOnly: release.supportOnly,
      productionBacked: release.productionBacked,
      finalReleaseStatus: release.finalReleaseStatus,
      integrationRecommendation: release.integrationRecommendation,
    }),
  ];

  function compareBeforeRenameMetrics(guardSamples) {
    let sameDirectoryFailures = 0;
    let compareFailures = 0;
    let appliedRenameOrderFailures = 0;
    let staleRenameAttempts = 0;

    for (const sample of guardSamples) {
      const steps = Array.isArray(sample.steps) ? sample.steps : [];
      const compareIndex = steps.indexOf('compare-expected-storage-hash');
      const renameIndex = steps.indexOf('rename-temp-to-target');
      if (sample.sameDirectoryTemp !== true || sample.atomicVisibilityBoundary !== 'same-directory-rename') {
        sameDirectoryFailures += 1;
      }
      if (sample.compareBeforeRename !== true || compareIndex === -1) {
        compareFailures += 1;
      }
      if (sample.outcome === 'applied' && !(sample.renameAttempted === true && renameIndex > compareIndex)) {
        appliedRenameOrderFailures += 1;
      }
      if (sample.outcome === 'stale-at-write' && (sample.renameAttempted === true || renameIndex !== -1)) {
        staleRenameAttempts += 1;
      }
    }

    return {
      pass: guardSamples.length > 0
        && appliedSamples.length === evidence.storage?.appliedWrites
        && sameDirectoryFailures === 0
        && compareFailures === 0
        && appliedRenameOrderFailures === 0
        && staleRenameAttempts === 0,
      evidenceSamples: guardSamples.length,
      appliedSamples: appliedSamples.length,
      sameDirectoryFailures,
      compareFailures,
      appliedRenameOrderFailures,
      staleRenameAttempts,
    };
  }
}

function unsafeMemoryEvidenceDecisions(evidence, repeatedEvidence) {
  const staleWriteCountMismatch = withPassedStatus(clone(evidence));
  staleWriteCountMismatch.storage.staleAtWriteWrites = 0;
  staleWriteCountMismatch.guardedWrites.staleSampleCount = 0;

  const unsafeRenameOnStale = withPassedStatus(clone(evidence));
  const staleSample = unsafeRenameOnStale.guardedWrites.storageGuardSamples
    .find((sample) => sample.outcome === 'stale-at-write');
  staleSample.renameAttempted = true;
  staleSample.steps = [...staleSample.steps, 'rename-temp-to-target'];
  unsafeRenameOnStale.storage.unsafeRenameOnStaleWrites = 1;

  const memoryCeilingBreach = withPassedStatus(clone(evidence));
  memoryCeilingBreach.memory.ceilingBreaches = 1;
  memoryCeilingBreach.memory.maxObservedBufferedBytes = memoryCeilingBreach.memory.maxBufferedBytes + 1;
  memoryCeilingBreach.guardedWrites.storageGuardSamples[0].memoryCeiling.ceilingHeld = false;
  memoryCeilingBreach.guardedWrites.storageGuardSamples[0].memoryCeiling.maxObservedBufferedBytes =
    memoryCeilingBreach.memory.maxObservedBufferedBytes;

  const prematurePassStatus = withPassedStatus(clone(evidence));
  prematurePassStatus.correctnessGates = [];

  return {
    staleWriteCountMismatch: resolveMemoryCeilingProof(staleWriteCountMismatch, { repeatedEvidence }),
    unsafeRenameOnStale: resolveMemoryCeilingProof(unsafeRenameOnStale, { repeatedEvidence }),
    memoryCeilingBreach: resolveMemoryCeilingProof(memoryCeilingBreach, { repeatedEvidence }),
    prematurePassStatus: resolveMemoryCeilingProof(prematurePassStatus, { repeatedEvidence }),
  };
}

function publicBenchmarkProjection(report) {
  return {
    rppId: report.rppId,
    benchmark: report.benchmark,
    profile: report.profile,
    workload: report.resources.workload,
    storage: report.resources.storage,
    memoryCeiling: report.resources.memoryCeiling,
    bytes: report.resources.bytes,
    gates: gateStatuses(report),
    evidenceSampleHashes: report.deterministicCoverage.evidenceSamples
      .map((evidence) => digest(storageGuardSampleSummary(evidence))),
  };
}

function publicMemoryEvidenceProjection(evidence) {
  return {
    rppId: evidence.rppId,
    proofId: evidence.proofId,
    variant: evidence.variant,
    builtOn: evidence.builtOn,
    benchmark: evidence.benchmark,
    workload: evidence.workload,
    storage: evidence.storage,
    memory: evidence.memory,
    bytes: evidence.bytes,
    guardedWrites: evidence.guardedWrites,
    release: evidence.release,
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

function writeFixture(rootDir, logicalPath, contents) {
  const absolutePath = path.join(rootDir, logicalPath);
  ensureFilesystemDirectoryUsable(rootDir, path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, contents);
}

function readFixture(rootDir, logicalPath) {
  return fs.readFileSync(path.join(rootDir, logicalPath), 'utf8');
}

function tempNamesBesideTarget(absolutePath) {
  return fs.readdirSync(path.dirname(absolutePath))
    .filter((entry) => entry.startsWith(FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX))
    .sort();
}

function resourceEvidence(kind, logicalPath, expectedStorage) {
  return {
    type: 'file',
    kind,
    logicalPathHash: digest(logicalPath),
    expectedStorageHash: filesystemStorageHash(expectedStorage),
  };
}

function deterministicChunkSource(label) {
  return ({ offset, size }) => {
    const buffer = Buffer.allocUnsafe(size);
    let written = 0;
    let blockIndex = 0;
    while (written < buffer.length) {
      const block = crypto
        .createHash('sha256')
        .update(`${proofId}:${label}:${offset + written}:${blockIndex}`)
        .digest();
      const copied = Math.min(block.length, buffer.length - written);
      block.copy(buffer, written, 0, copied);
      written += copied;
      blockIndex += 1;
    }
    return buffer;
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

function gateStatuses(report) {
  return report.gates.map((gate) => ({
    id: gate.id,
    status: gate.status,
  }));
}

function assertHashOnlyMemoryCeilingEvidence(value) {
  assert.equal(memoryCeilingEvidenceHasNoRawValues(value), true);
}

function assertStorageGuardHasNoRawValues(evidence, rootDir) {
  const serialized = JSON.stringify(evidence);
  for (const token of rawFilesystemTokens(rootDir).filter((value) => value !== 'wp-content/uploads')) {
    assert.equal(serialized.includes(token), false, `storage guard leaked raw token ${token}`);
  }
}

function memoryCeilingEvidenceHasNoRawValues(value) {
  return !rawFilesystemEvidencePattern().test(JSON.stringify(value));
}

function rawFilesystemEvidencePattern() {
  return /rpp0777-(?:base|planned|drift)-stale-payload|memory-(?:base|planned|drift)-payload|filesystem memory raw fixture|wp-content\/uploads|\/tmp\/|\.tmp/i;
}

function rawFilesystemTokens(rootDir = null) {
  return [
    'rpp0777-base-stale-payload',
    'rpp0777-planned-stale-payload',
    'rpp0777-drift-stale-payload',
    'memory-base-payload',
    'memory-planned-payload',
    'memory-drift-payload',
    'filesystem memory raw fixture',
    'wp-content/uploads',
    FILESYSTEM_COMPARE_RENAME_TEMP_PREFIX,
    rootDir,
  ].filter(Boolean);
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
