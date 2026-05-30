import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BenchmarkClaimError,
  productionThroughputBlockers,
  ROLLOUT_SAFETY_GATE_DEFINITIONS,
  runChunkReplayIdempotencyBenchmark,
  runGuardedExecutorBenchmark,
} from '../scripts/bench/guarded-executor-benchmark.js';

const fixedNow = new Date('2026-05-24T00:00:00.000Z');

function tempBenchmarkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-guarded-executor-benchmark-test-'));
}

function smallBenchmark(overrides = {}) {
  return runGuardedExecutorBenchmark({
    profile: 'unit',
    fileBytes: 3 * 1024 * 1024,
    chunkSizeBytes: 512 * 1024,
    rowCount: 16,
    rowPayloadBytes: 192,
    now: fixedNow,
    tempDir: tempBenchmarkDir(),
    ...overrides,
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('guarded executor benchmark moves buffers and row payloads through durable evidence', { concurrency: false }, () => {
  const report = smallBenchmark();

  assert.equal(report.claims.labGuardedExecutorEvidence, true);
  assert.equal(report.shape.bytesMovedThroughStaging, report.shape.fileBytes);
  assert.equal(report.evidence.chunkReceipts.recorded, report.shape.chunkCount);
  assert.equal(report.evidence.chunkReceipts.finalStagingRecord, true);
  assert.equal(report.evidence.chunkReceipts.canonicalVisibleBeforePublish, false);
  assert.equal(report.resources.transfer.resourceKey, report.shape.largeUploadResourceKey);
  assert.equal(report.resources.transfer.chunkReceipts, report.shape.chunkCount);
  assert.equal(report.evidence.guardedTransfer.manifest.complete, true);
  assert.equal(report.evidence.guardedTransfer.manifest.entries.length, report.shape.chunkCount);
  assert.equal(report.evidence.guardedTransfer.manifest.byteRangeCoverage.contiguous, true);
  assert.equal(report.evidence.guardedTransfer.receipts.everyReceiptPlanScoped, true);
  assert.equal(report.evidence.guardedTransfer.receipts.receiptKeysUnique, true);
  assert.equal(report.evidence.guardedTransfer.hashVerification.status, 'passed');
  assert.equal(report.evidence.guardedTransfer.hashVerification.allChunksMatchManifest, true);
  assert.equal(
    report.evidence.guardedTransfer.hashVerification.assembledHashMatchesFinalized,
    true,
  );
  assert.equal(report.evidence.guardedTransfer.resume.status, 'passed');
  assert.equal(report.evidence.guardedTransfer.resume.chunksSkippedByReceipt, report.shape.chunkCount);
  assert.equal(report.evidence.guardedTransfer.resume.chunksToUpload, 0);
  assert.equal(report.evidence.guardedTransfer.resume.bytesToUpload, 0);
  assert.equal(report.evidence.guardedTransfer.resume.duplicateMutationWork, 0);
  assert.equal(report.evidence.guardedTransfer.resume.missingReceiptBlocksSkip, true);
  assert.equal(report.evidence.guardedTransfer.resume.mismatchedReceiptBlocksSkip, true);
  assert.equal(report.evidence.guardedTransfer.replayIdempotency.status, 'passed');
  assert.equal(report.evidence.guardedTransfer.replayIdempotency.variant, 1);
  assert.equal(report.evidence.guardedTransfer.replayIdempotency.idempotentReplaySafe, true);
  assert.equal(
    report.evidence.guardedTransfer.replayIdempotency.attemptedReplayCount,
    report.shape.chunkCount,
  );
  assert.equal(
    report.evidence.guardedTransfer.replayIdempotency.idempotentSkips,
    report.evidence.guardedTransfer.replayIdempotency.attemptedReplayCount,
  );
  assert.equal(report.evidence.guardedTransfer.replayIdempotency.bytes.bytesRewrittenDuringReplay, 0);
  assert.equal(
    report.evidence.guardedTransfer.replayIdempotency.receipts.duplicateReceiptRecordsWritten,
    0,
  );
  assert.equal(
    report.evidence.guardedTransfer.replayIdempotency.mutationWork.duplicateMutationWork,
    0,
  );
  assert.equal(
    report.evidence.guardedTransfer.replayIdempotency.mutationWork.noDuplicateMutationWork,
    true,
  );
  assert.equal(report.evidence.guardedTransfer.replayIdempotency.failClosed.mismatchedDigestRejected, true);
  assert.equal(report.evidence.chunkReplayIdempotency.evidenceHash, report.evidence.guardedTransfer.replayIdempotency.evidenceHash);
  assert.equal(report.evidence.transactionBoundaryPolicy.status, 'passed');
  assert.equal(report.evidence.transactionBoundaryPolicy.transfer.complete, true);
  assert.equal(report.evidence.transactionBoundaryPolicy.resume.duplicateMutationWork, 0);
  assert.equal(report.evidence.transactionBoundaryPolicy.apply.noDuplicateMutationWork, true);
  assert.equal(
    report.evidence.transactionBoundaryPolicy.apply.applyOpenedAfterTransferFinalize,
    true,
  );
  assert.equal(report.evidence.parallelSnapshotHashing.status, 'passed');
  assert.equal(report.evidence.parallelSnapshotHashing.fastPathLane.updated, true);
  assert.equal(report.shape.snapshotHashJobs, report.shape.snapshotHashResources * 3);
  assert.ok(report.shape.snapshotHashConcurrency > 0);
  assert.equal(report.evidence.timeoutBudgetProof.status, 'passed');
  assert.equal(report.evidence.timeoutBudgetProof.resume.receiptOnlyResumeSafe, true);
  assert.equal(report.evidence.timeoutBudgetProof.resume.duplicateMutationWork, 0);
  assert.equal(report.evidence.timeoutBudgetProof.apply.noDuplicateMutationWork, true);
  assert.equal(report.evidence.guardedTransfer.visibility.livePathChangesOnlyAfterFinalize, true);
  assert.equal(report.evidence.preconditions.liveRemoteMutationPreconditions, report.shape.mutations);
  assert.equal(report.evidence.preconditions.everyMutationHasLiveRemotePrecondition, true);
  assert.ok(report.shape.graphIdentityTargetCount > 0);
  assert.equal(report.evidence.wordpressGraphIdentity.postmetaReferences, report.shape.rowCount);
  assert.equal(
    report.evidence.wordpressGraphIdentity.stableRemotePostTargets,
    report.shape.graphIdentityTargetCount,
  );
  assert.equal(report.evidence.wordpressGraphIdentity.allPostmetaReferencesUseStableRemoteIdentity, true);
  assert.equal(report.evidence.wordpressGraphIdentity.graphIdentityBlockers, 0);
  assert.deepEqual(report.evidence.wordpressGraphIdentity.familyCounters, {
    totalFamilies: 7,
    mappedFamilies: 6,
    unmappedFamilies: 0,
    blockedFamilies: 0,
    guardedFamilies: 1,
    mappedReferences: report.shape.rowCount + 7,
    unmappedReferences: 0,
  });
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.postmetaPostRefs.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.postmetaPostRefs.mapped,
    report.shape.rowCount,
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.postsParents.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.featuredImagesAttachments.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.termsTaxonomies.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.termRelationships.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.termmeta.status,
    'mapped',
  );
  assert.equal(
    report.evidence.wordpressGraphIdentity.familyReport.unsupportedPluginOwnedSurfaces.status,
    'planner-guarded',
  );
  assert.ok(
    report.evidence.wordpressGraphIdentity.actionableBlockers.some(
      (blocker) =>
        blocker.family === 'unsupported/plugin-owned surfaces'
        && blocker.plannerOwner === 'planner:test/push-planner.test.js'
        && blocker.smokeOwner === 'smoke:scripts/playground/forms-lab-table-driver-smoke.mjs',
    ),
  );
  assert.equal(report.evidence.journal.allJournalsIntegrityOk, true);
  assert.equal(report.evidence.redaction.durableJournalsContainNoRawValues, true);
  assert.equal(report.evidence.recovery.successInspectionStatus, 'fully-updated-remote');
  assert.equal(report.evidence.recovery.preCommitFailureInspectionStatus, 'old-remote');
  assert.equal(report.evidence.recovery.partialCommitInspectionStatus, 'blocked-recovery');
  assert.equal(report.evidence.atomicGroup.requireAtomic, true);
  assert.equal(report.evidence.atomicGroup.preCommitFailureLeavesRemoteUnchanged, true);
  assert.equal(report.runtime.budgetStatus, 'passed');
  assert.equal(report.evidence.runtimeBudget.status, 'passed');
  assert.equal(report.evidence.runtimeBudget.conservativeBudgetReporting, true);
  assert.equal(report.throughput.productionThroughput, 'not-claimed');
});

test('RPP-0703 transaction boundary policy resumes chunk transfer without duplicate mutation work', { concurrency: false }, () => {
  const report = smallBenchmark({
    fileBytes: 1024 * 1024,
    chunkSizeBytes: 256 * 1024,
    rowCount: 8,
    rowPayloadBytes: 64,
  });
  const policy = report.evidence.transactionBoundaryPolicy;

  assert.equal(policy.policyId, 'rpp-0703-transaction-boundary-policy');
  assert.equal(policy.variant, 1);
  assert.equal(policy.status, 'passed');
  assert.deepEqual(policy.boundaryOrder, [
    'chunk-transfer-transaction',
    'file-staging-finalize-boundary',
    'apply-mutation-transaction',
  ]);
  assert.equal(policy.transfer.complete, true);
  assert.equal(policy.transfer.chunkCount, report.shape.chunkCount);
  assert.equal(policy.transfer.exactReceiptMatches, report.shape.chunkCount);
  assert.equal(policy.transfer.duplicateReceiptKeys, 0);
  assert.equal(policy.transfer.canonicalVisibleDuringTransfer, false);
  assert.equal(policy.resume.receiptOnlyResumeSafe, true);
  assert.equal(policy.resume.chunksSkippedByReceipt, report.shape.chunkCount);
  assert.equal(policy.resume.chunksToUpload, 0);
  assert.equal(policy.resume.bytesToUpload, 0);
  assert.equal(policy.resume.duplicateChunkBytes, 0);
  assert.equal(policy.resume.duplicateMutationWork, 0);
  assert.equal(policy.resume.missingReceiptBlocksSkip, true);
  assert.equal(policy.resume.mismatchedReceiptBlocksSkip, true);
  assert.equal(policy.apply.applyOpenedAfterTransferFinalize, true);
  assert.ok(
    policy.transfer.transferFinalizeSequence < policy.apply.firstApplyBoundarySequence,
    'apply transaction must open only after file staging finalizes',
  );
  assert.equal(policy.apply.mutationWorkAllowedDuringTransferResume, false);
  assert.equal(policy.apply.mutationWorkReplayedBeforeTransferFinalize, 0);
  assert.equal(policy.apply.freshMutationWorkDuringTransferResume, 0);
  assert.equal(policy.apply.duplicateMutationWork, 0);
  assert.equal(policy.apply.noDuplicateMutationWork, true);
  assert.match(policy.evidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(
    report.evidence.guardedTransfer.transactionBoundaryPolicy.evidenceHash,
    policy.evidenceHash,
  );
  assert.doesNotMatch(JSON.stringify(policy), /row-payload|commerce_bench|catalog identity/);
});

test('RPP-0710 parallel snapshot hashing updates the fast-path lane only after correctness gates hold', { concurrency: false }, () => {
  const report = smallBenchmark({
    fileBytes: 1024 * 1024,
    chunkSizeBytes: 256 * 1024,
    rowCount: 8,
    rowPayloadBytes: 64,
    snapshotHashConcurrency: 2,
  });
  const proof = report.evidence.parallelSnapshotHashing;
  const gateIds = proof.correctnessGates.map((gate) => gate.id);
  const rolloutGate = report.rolloutSafetyGates.gates.find((gate) =>
    gate.id === 'parallel-snapshot-hashing');

  assert.equal(proof.benchmarkId, 'rpp-0710-parallel-snapshot-hashing');
  assert.equal(proof.variant, 1);
  assert.equal(proof.scope, 'lab-guarded-executor-snapshot-hash-set');
  assert.equal(proof.mode, 'bounded-parallel-scheduler-proof');
  assert.equal(proof.status, 'passed');
  assert.equal(proof.scheduler.maxConcurrency, 2);
  assert.equal(proof.scheduler.maxAllowedConcurrency >= proof.scheduler.maxConcurrency, true);
  assert.equal(proof.scheduler.maxObservedInFlight <= proof.scheduler.maxConcurrency, true);
  assert.equal(proof.scheduler.bounded, true);
  assert.equal(proof.hashSet.snapshotCount, 3);
  assert.equal(proof.hashSet.hashCount, proof.hashSet.expectedHashCount);
  assert.equal(proof.hashSet.hashCount, proof.hashSet.resourceCount * proof.hashSet.snapshotCount);
  assert.equal(proof.hashSet.complete, true);
  assert.equal(proof.hashSet.parallelMatchesSequential, true);
  assert.equal(proof.hashSet.deterministicDigestMatches, true);
  assert.equal(proof.hashSet.parallelDigest, proof.hashSet.sequentialDigest);
  assert.match(proof.hashSet.parallelDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(proof.scheduler.scheduleDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(gateIds, [
    'bounded-hash-concurrency',
    'complete-snapshot-hash-set',
    'parallel-matches-sequential',
    'deterministic-hash-set',
    'planning-only-no-write-authority',
    'hash-only-evidence',
  ]);
  assert.ok(proof.correctnessGates.every((gate) => gate.status === 'passed'));
  assert.equal(proof.applyBoundary.planningOnly, true);
  assert.equal(proof.applyBoundary.authorizesApply, false);
  assert.equal(proof.applyBoundary.applyMustRevalidate, true);
  assert.equal(proof.applyBoundary.everyMutationHasLiveRemotePrecondition, true);
  assert.equal(proof.fastPathLane.policy, 'update-only-after-correctness-gates-pass');
  assert.equal(proof.fastPathLane.updated, true);
  assert.deepEqual(proof.fastPathLane.blockedBy, []);
  assert.match(proof.fastPathLane.proofDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(rolloutGate.status, 'passed');
  assert.equal(rolloutGate.speedClaimBlocker, null);
  assert.ok(!productionThroughputBlockers(report).includes('missing-parallel-snapshot-hashing-evidence'));
  assert.ok(proof.hashSet.hashSamples.length > 0);
  assert.ok(proof.hashSet.hashSamples.every((sample) => !Object.hasOwn(sample, 'resourceKey')));
  assert.doesNotMatch(
    JSON.stringify(proof),
    /row-payload|commerce_bench|catalog identity|catalog-export\.bin|wp-content\/plugins|benchmark-topic/i,
  );
});

test('guarded benchmark refuses production throughput claims until production gaps are measured', { concurrency: false }, () => {
  const report = smallBenchmark();

  assert.equal(report.claims.productionThroughput.status, 'blocked');
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-atomic-group-commit-not-measured'),
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-storage-receipts-not-measured'),
  );
  assert.ok(
    report.claims.productionThroughput.blockers.includes('production-row-batch-executor-not-measured'),
  );
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-durable-chunk-receipts'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-durable-chunk-manifest'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-chunk-hash-verification'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-receipt-only-resume-evidence'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-chunk-replay-idempotency-evidence'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-parallel-snapshot-hashing-evidence'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-live-remote-preconditions'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('missing-partial-commit-recovery-evidence'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('wordpress-graph-identity-evidence-not-proven'));
  assert.ok(!report.claims.productionThroughput.blockers.includes('runtime-resource-budget-exceeded'));

  assert.throws(
    () => smallBenchmark({ claimProductionThroughput: true }),
    (error) =>
      error instanceof BenchmarkClaimError
      && error.code === 'PRODUCTION_THROUGHPUT_CLAIM_BLOCKED'
      && error.details.blockers.includes('production-atomic-group-commit-not-measured'),
  );
});

test('production claim gate fails closed if benchmark evidence is tampered', { concurrency: false }, () => {
  const report = smallBenchmark();

  const missingReceipt = clone(report);
  missingReceipt.evidence.chunkReceipts.recorded -= 1;
  assert.ok(productionThroughputBlockers(missingReceipt).includes('missing-durable-chunk-receipts'));

  const missingManifest = clone(report);
  missingManifest.evidence.guardedTransfer.manifest.complete = false;
  assert.ok(productionThroughputBlockers(missingManifest).includes('missing-durable-chunk-manifest'));

  const missingHashVerification = clone(report);
  missingHashVerification.evidence.guardedTransfer.hashVerification.allChunksMatchManifest = false;
  assert.ok(
    productionThroughputBlockers(missingHashVerification).includes('missing-chunk-hash-verification'),
  );

  const missingResumeEvidence = clone(report);
  missingResumeEvidence.evidence.guardedTransfer.resume.receiptOnlyResumeSafe = false;
  assert.ok(
    productionThroughputBlockers(missingResumeEvidence).includes('missing-receipt-only-resume-evidence'),
  );

  const missingReplayIdempotency = clone(report);
  missingReplayIdempotency.evidence.guardedTransfer.replayIdempotency.idempotentReplaySafe = false;
  assert.ok(
    productionThroughputBlockers(missingReplayIdempotency).includes(
      'missing-chunk-replay-idempotency-evidence',
    ),
  );

  const missingTransactionBoundary = clone(report);
  missingTransactionBoundary.evidence.transactionBoundaryPolicy.apply.noDuplicateMutationWork = false;
  assert.ok(
    productionThroughputBlockers(missingTransactionBoundary).includes('missing-transaction-boundary-policy'),
  );

  const missingParallelSnapshotHashing = clone(report);
  missingParallelSnapshotHashing.evidence.parallelSnapshotHashing.fastPathLane.updated = false;
  assert.ok(
    productionThroughputBlockers(missingParallelSnapshotHashing)
      .includes('missing-parallel-snapshot-hashing-evidence'),
  );

  const missingPrecondition = clone(report);
  missingPrecondition.evidence.preconditions.everyMutationHasLiveRemotePrecondition = false;
  assert.ok(productionThroughputBlockers(missingPrecondition).includes('missing-live-remote-preconditions'));

  const missingRecovery = clone(report);
  missingRecovery.evidence.recovery.partialCommitBlocksRecovery = false;
  assert.ok(
    productionThroughputBlockers(missingRecovery).includes('missing-partial-commit-recovery-evidence'),
  );

  const missingGraphIdentity = clone(report);
  missingGraphIdentity.evidence.wordpressGraphIdentity.allPostmetaReferencesUseStableRemoteIdentity = false;
  missingGraphIdentity.evidence.wordpressGraphIdentity.familyReport.postmetaPostRefs.status = 'blocked';
  assert.ok(
    productionThroughputBlockers(missingGraphIdentity).includes('wordpress-graph-identity-evidence-not-proven'),
  );

  const runtimeBudgetExceeded = clone(report);
  runtimeBudgetExceeded.evidence.runtimeBudget.status = 'failed';
  assert.ok(productionThroughputBlockers(runtimeBudgetExceeded).includes('runtime-resource-budget-exceeded'));
});

test('RPP-0709 chunk replay idempotency reuses receipts inside a large-site budget', { concurrency: false }, () => {
  const report = runChunkReplayIdempotencyBenchmark({
    profile: 'guardedLarge',
    now: fixedNow,
    fileBytes: 4 * 1024 * 1024,
    chunkSizeBytes: 512 * 1024,
    replayAttemptsPerChunk: 2,
    maxDurationMs: 10_000,
    maxHeapUsedBytes: 256 * 1024 * 1024,
    tempDir: tempBenchmarkDir(),
  });
  const gateById = new Map(report.gates.map((gate) => [gate.id, gate]));

  assert.equal(report.rppId, 'RPP-0709');
  assert.equal(report.benchmark, 'rpp-0709-chunk-replay-idempotency');
  assert.equal(report.profile, 'guardedLarge');
  assert.equal(report.ok, true);
  assert.equal(report.runtime.budgets.profile, 'guardedLarge');
  assert.equal(report.runtime.budgets.maxDurationMs, 10_000);
  assert.equal(report.runtime.budgetStatus, 'passed');
  assert.equal(report.evidence.manifest.chunkCount, 8);
  assert.equal(report.evidence.receipts.recorded, report.evidence.receipts.expected);
  assert.equal(report.evidence.hashVerification.status, 'passed');
  assert.equal(report.evidence.replayIdempotency.status, 'passed');
  assert.equal(report.evidence.replayIdempotency.idempotentReplaySafe, true);
  assert.equal(report.evidence.replayIdempotency.replayAttemptsPerChunk, 2);
  assert.equal(report.evidence.replayIdempotency.attemptedReplayCount, 16);
  assert.equal(report.evidence.replayIdempotency.idempotentSkips, 16);
  assert.equal(report.evidence.replayIdempotency.receipts.beforeReplay, 8);
  assert.equal(report.evidence.replayIdempotency.receipts.afterReplay, 8);
  assert.equal(report.evidence.replayIdempotency.receipts.duplicateReceiptRecordsWritten, 0);
  assert.equal(report.evidence.replayIdempotency.bytes.bytesRewrittenDuringReplay, 0);
  assert.equal(report.evidence.replayIdempotency.mutationWork.duplicateMutationWork, 0);
  assert.equal(report.evidence.replayIdempotency.mutationWork.applyBoundaryOpenedDuringReplay, false);
  assert.equal(report.evidence.replayIdempotency.failClosed.missingReceiptRequiresUpload, true);
  assert.equal(report.evidence.replayIdempotency.failClosed.mismatchedDigestRejected, true);
  assert.equal(report.evidence.replayIdempotency.failClosed.wrongPlanRejected, true);
  assert.equal(report.resources.replay.duplicateMutationWork, 0);
  assert.equal(report.resources.replay.bytesRewrittenDuringReplay, 0);
  assert.equal(gateById.get('chunk-replay-idempotency').status, 'pass');
  assert.equal(gateById.get('no-duplicate-mutation-work').status, 'pass');
  assert.equal(gateById.get('large-site-runtime-budget').status, 'pass');
  assert.equal(report.claims.productionThroughput, 'not-claimed');
});

test('CLI benchmark reports runtime resources and rollout gates before throughput', { concurrency: false }, () => {
  const stdout = execFileSync(process.execPath, [
    'scripts/bench/guarded-executor-benchmark.js',
    '--profile=unit',
    '--file-bytes=1048576',
    '--chunk-size-bytes=262144',
    '--row-count=8',
    '--row-payload-bytes=64',
    `--temp-dir=${tempBenchmarkDir()}`,
  ], {
    cwd: path.resolve(new URL('..', import.meta.url).pathname),
    encoding: 'utf8',
  });
  const report = JSON.parse(stdout);
  const rootKeys = Object.keys(report);

  assert.ok(rootKeys.indexOf('resources') < rootKeys.indexOf('rolloutSafetyGates'));
  assert.ok(rootKeys.indexOf('rolloutSafetyGates') < rootKeys.indexOf('timings'));
  assert.ok(rootKeys.indexOf('timings') < rootKeys.indexOf('throughput'));
  assert.equal(typeof report.timings.stageFileMs, 'number');
  assert.equal(typeof report.timings.planMs, 'number');
  assert.equal(typeof report.timings.applyMs, 'number');
  assert.equal(typeof report.timings.totalMs, 'number');
  assert.equal(report.resources.transfer.chunkReceipts, report.shape.chunkCount);
  assert.equal(report.resources.transfer.resourceKey, report.shape.largeUploadResourceKey);
  assert.equal(report.rolloutSafetyGates.summary.passed, 9);
  assert.equal(report.rolloutSafetyGates.summary.blocked, 3);
  assert.equal(report.rolloutSafetyGates.summary.failed, 0);
  assert.equal(report.throughput.productionThroughput, 'not-claimed');
});

test('rollout safety gates are named before speed claims', { concurrency: false }, () => {
  const report = smallBenchmark({
    fileBytes: 1024 * 1024,
    chunkSizeBytes: 256 * 1024,
    rowCount: 8,
    rowPayloadBytes: 64,
  });
  const rootKeys = Object.keys(report);
  const gateIds = report.rolloutSafetyGates.gates.map((gate) => gate.id);
  const gatesById = new Map(report.rolloutSafetyGates.gates.map((gate) => [gate.id, gate]));

  assert.ok(rootKeys.indexOf('rolloutSafetyGates') < rootKeys.indexOf('throughput'));
  assert.equal(report.rolloutSafetyGates.evaluatedBeforeSpeedClaims, true);
  assert.deepEqual(
    gateIds,
    ROLLOUT_SAFETY_GATE_DEFINITIONS.map((gate) => gate.id),
  );
  for (const gateId of [
    'guarded-transfer-manifest',
    'chunk-hash-verification',
    'receipt-only-resume',
    'chunk-replay-idempotency',
    'live-remote-preconditions',
    'parallel-snapshot-hashing',
    'durable-journal-integrity',
    'failure-recovery-classification',
    'atomic-group-visibility',
  ]) {
    assert.equal(gatesById.get(gateId).status, 'passed', `${gateId} should pass in lab evidence`);
    assert.equal(gatesById.get(gateId).speedClaimBlocker, null);
  }

  assert.equal(gatesById.get('production-storage-receipts').status, 'blocked');
  assert.equal(gatesById.get('production-row-batch-executor').status, 'blocked');
  assert.equal(gatesById.get('production-atomic-group-commit').status, 'blocked');
  assert.deepEqual(report.rolloutSafetyGates.summary, {
    passed: 9,
    blocked: 3,
    failed: 0,
    blockers: [
      'production-storage-receipts-not-measured',
      'production-row-batch-executor-not-measured',
      'production-atomic-group-commit-not-measured',
    ],
    speedClaimsAllowed: false,
  });
});

test('guarded transfer projection is deterministic apart from timings and temp paths', { concurrency: false }, () => {
  const overrides = {
    fileBytes: 1024 * 1024,
    chunkSizeBytes: 256 * 1024,
    rowCount: 8,
    rowPayloadBytes: 64,
  };
  const first = smallBenchmark(overrides);
  const second = smallBenchmark(overrides);

  assert.deepEqual(deterministicTransferProjection(first), deterministicTransferProjection(second));
});

function deterministicTransferProjection(report) {
  return {
    shape: report.shape,
    transfer: report.resources.transfer,
    rolloutSafetyGates: report.rolloutSafetyGates,
    guardedTransfer: {
      manifest: report.evidence.guardedTransfer.manifest,
      receipts: report.evidence.guardedTransfer.receipts,
      hashVerification: report.evidence.guardedTransfer.hashVerification,
      resume: report.evidence.guardedTransfer.resume,
      replayIdempotency: report.evidence.guardedTransfer.replayIdempotency,
      transactionBoundaryPolicy: report.evidence.guardedTransfer.transactionBoundaryPolicy,
      timeoutBudgetProof: report.evidence.guardedTransfer.timeoutBudgetProof,
      visibility: report.evidence.guardedTransfer.visibility,
    },
    parallelSnapshotHashing: report.evidence.parallelSnapshotHashing,
    productionThroughputBlockers: report.claims.productionThroughput.blockers,
  };
}
