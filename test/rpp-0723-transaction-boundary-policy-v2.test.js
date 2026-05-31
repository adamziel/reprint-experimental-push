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

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const proofId = 'rpp-0723-transaction-boundary-policy-v2';

function tempBenchmarkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0723-transaction-boundary-'));
}

function smallBenchmark(overrides = {}) {
  return runGuardedExecutorBenchmark({
    profile: 'unit',
    fileBytes: 1024 * 1024,
    chunkSizeBytes: 256 * 1024,
    rowCount: 8,
    rowPayloadBytes: 64,
    replayAttemptsPerChunk: 2,
    maxDurationMs: 10_000,
    maxHeapUsedBytes: 256 * 1024 * 1024,
    now: fixedNow,
    tempDir: tempBenchmarkDir(),
    ...overrides,
  });
}

test('RPP-0723 variant 2 proves receipt-only transaction boundary resume with bounded gates', { concurrency: false }, () => {
  const report = smallBenchmark();
  const proof = buildVariant2Proof(report);

  assert.equal(proof.rppId, 'RPP-0723');
  assert.equal(proof.proofId, proofId);
  assert.equal(proof.variant, 2);
  assert.equal(proof.status, 'passed');
  assert.equal(proof.builtOn.policyId, 'rpp-0703-transaction-boundary-policy');
  assert.equal(proof.builtOn.variant, 1);
  assert.match(proof.builtOn.evidenceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(proof.boundaryOrder, [
    'chunk-transfer-transaction',
    'file-staging-finalize-boundary',
    'apply-mutation-transaction',
  ]);

  assert.equal(proof.transfer.complete, true);
  assert.equal(proof.transfer.chunkCount, report.shape.chunkCount);
  assert.equal(proof.transfer.exactReceiptMatches, report.shape.chunkCount);
  assert.equal(proof.transfer.duplicateReceiptKeys, 0);
  assert.equal(proof.transfer.canonicalVisibleDuringTransfer, false);
  assert.equal(proof.transfer.manifestFinalized, true);
  assert.equal(proof.transfer.fileStagingFinalized, true);
  assert.match(proof.transfer.planIdHash, /^[a-f0-9]{64}$/);
  assert.match(proof.transfer.resourceKeyHash, /^[a-f0-9]{64}$/);

  assert.equal(proof.resume.receiptOnlyResumeSafe, true);
  assert.equal(proof.resume.chunksSkippedByReceipt, report.shape.chunkCount);
  assert.equal(proof.resume.chunksToUpload, 0);
  assert.equal(proof.resume.bytesSkippedByReceipt, report.shape.fileBytes);
  assert.equal(proof.resume.bytesToUpload, 0);
  assert.equal(proof.resume.duplicateChunkBytes, 0);
  assert.equal(proof.resume.duplicateMutationWork, 0);
  assert.equal(proof.resume.missingReceiptBlocksSkip, true);
  assert.equal(proof.resume.mismatchedReceiptBlocksSkip, true);

  assert.equal(proof.applyAccounting.applyOpenedAfterTransferFinalize, true);
  assert.equal(proof.applyAccounting.boundarySequencePreserved, true);
  assert.equal(proof.applyAccounting.mutationWorkAllowedDuringTransferResume, false);
  assert.equal(proof.applyAccounting.mutationWorkReplayedBeforeTransferFinalize, 0);
  assert.equal(proof.applyAccounting.freshMutationWorkDuringTransferResume, 0);
  assert.equal(proof.applyAccounting.duplicateMutationWork, 0);
  assert.equal(proof.applyAccounting.noDuplicateMutationWork, true);
  assert.equal(proof.applyAccounting.appliedMutations, report.shape.mutations);
  assert.equal(proof.applyAccounting.liveRemoteMutationPreconditions, report.shape.mutations);

  assert.equal(proof.replay.idempotentReplaySafe, true);
  assert.equal(proof.replay.replayAttemptsPerChunk, 2);
  assert.equal(proof.replay.attemptedReplayCount, report.shape.chunkCount * 2);
  assert.equal(proof.replay.idempotentSkips, proof.replay.attemptedReplayCount);
  assert.equal(proof.replay.bytesRewrittenDuringReplay, 0);
  assert.equal(proof.replay.duplicateReceiptRecordsWritten, 0);
  assert.equal(proof.replay.duplicateMutationWork, 0);
  assert.equal(proof.replay.applyBoundaryOpenedDuringReplay, false);

  assert.equal(proof.runtime.budgetStatus, 'passed');
  assert.equal(proof.runtime.durationWithinBudget, true);
  assert.equal(proof.runtime.heapWithinBudget, true);
  assert.ok(proof.runtime.durationMs <= proof.runtime.maxDurationMs);
  assert.ok(proof.runtime.heapUsedBytes <= proof.runtime.maxHeapUsedBytes);
  assert.equal(proof.resources.transfer.chunkReceipts, report.shape.chunkCount);
  assert.equal(proof.resources.apply.mutationResources, report.shape.mutations);
  assert.equal(proof.resources.apply.atomicGroupMutationCount > 0, true);
  assert.equal(proof.resources.journals.allJournalsIntegrityOk, true);
  assert.equal(proof.resources.journals.durableJournalsContainNoRawValues, true);

  assert.deepEqual(proof.gates.map((gate) => gate.status), [
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
    'pass',
  ]);
  assert.equal(gateById(proof, 'bounded-runtime-resources').metrics.maxDurationMs, 10_000);
  assert.equal(gateById(proof, 'support-only-production-blockers-retained').metrics.speedClaimsAllowed, false);
  assert.equal(proof.release.productionThroughput, 'not-claimed');
  assert.equal(proof.release.productionClaimStatus, 'blocked');
  assert.equal(proof.release.speedClaimsAllowed, false);
  assert.ok(proof.release.productionBlockers.includes('production-storage-receipts-not-measured'));
  assert.ok(proof.release.productionBlockers.includes('production-row-batch-executor-not-measured'));
  assert.ok(proof.release.productionBlockers.includes('production-atomic-group-commit-not-measured'));
  assert.equal(proof.release.finalReleaseStatus, 'NO-GO-without-production-storage-receipts-and-external-durability-proof');
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assertProjectionHasNoRawBenchmarkValues(proof);
});

test('RPP-0723 variant 2 fails the runtime gate without changing transaction accounting', { concurrency: false }, () => {
  const report = smallBenchmark({ maxHeapUsedBytes: 1 });
  const proof = buildVariant2Proof(report);

  assert.equal(report.evidence.transactionBoundaryPolicy.status, 'passed');
  assert.equal(proof.status, 'failed');
  assert.equal(gateById(proof, 'rpp-0703-policy-passed').status, 'pass');
  assert.equal(gateById(proof, 'receipt-only-resume').status, 'pass');
  assert.equal(gateById(proof, 'transaction-boundary-accounting').status, 'pass');
  assert.equal(gateById(proof, 'bounded-runtime-resources').status, 'fail');
  assert.equal(proof.runtime.budgetStatus, 'failed');
  assert.equal(proof.runtime.heapWithinBudget, false);
  assert.equal(proof.runtime.maxHeapUsedBytes, 1);
  assert.equal(proof.resume.duplicateMutationWork, 0);
  assert.equal(proof.applyAccounting.noDuplicateMutationWork, true);
  assert.ok(proof.release.productionBlockers.includes('runtime-resource-budget-exceeded'));
  assertProjectionHasNoRawBenchmarkValues(proof);
});

function buildVariant2Proof(report) {
  const policy = report.evidence.transactionBoundaryPolicy;
  const replay = report.evidence.guardedTransfer.replayIdempotency;
  const runtime = report.evidence.runtimeBudget;
  const productionBlockers = productionThroughputBlockers(report);
  const boundarySequencePreserved = policy.transfer.transferFinalizeSequence
    < policy.apply.firstApplyBoundarySequence;
  const noDuplicateMutationWork = policy.resume.duplicateMutationWork === 0
    && policy.apply.duplicateMutationWork === 0
    && replay.mutationWork.duplicateMutationWork === 0;
  const runtimeWithinBudget = runtime.status === 'passed'
    && runtime.durationWithinBudget
    && runtime.heapWithinBudget;
  const supportOnlyBlockersRetained = report.throughput.productionThroughput === 'not-claimed'
    && report.claims.productionThroughput.status === 'blocked'
    && report.rolloutSafetyGates.summary.speedClaimsAllowed === false
    && productionBlockers.includes('production-storage-receipts-not-measured')
    && productionBlockers.includes('production-row-batch-executor-not-measured')
    && productionBlockers.includes('production-atomic-group-commit-not-measured');
  const gates = [
    proofGate('rpp-0703-policy-passed', policy.status === 'passed' && policy.variant === 1, {
      sourceVariant: policy.variant,
    }),
    proofGate('receipt-only-resume', policy.resume.receiptOnlyResumeSafe, {
      chunksSkippedByReceipt: policy.resume.chunksSkippedByReceipt,
      chunksToUpload: policy.resume.chunksToUpload,
      bytesToUpload: policy.resume.bytesToUpload,
    }),
    proofGate('no-duplicate-mutation-work', noDuplicateMutationWork, {
      resumeDuplicateMutationWork: policy.resume.duplicateMutationWork,
      applyDuplicateMutationWork: policy.apply.duplicateMutationWork,
      replayDuplicateMutationWork: replay.mutationWork.duplicateMutationWork,
    }),
    proofGate('transaction-boundary-accounting', boundarySequencePreserved
      && policy.transfer.exactReceiptMatches === report.shape.chunkCount
      && policy.apply.mutationWorkReplayedBeforeTransferFinalize === 0
      && policy.apply.freshMutationWorkDuringTransferResume === 0, {
      transferFinalizeSequence: policy.transfer.transferFinalizeSequence,
      firstApplyBoundarySequence: policy.apply.firstApplyBoundarySequence,
      exactReceiptMatches: policy.transfer.exactReceiptMatches,
    }),
    proofGate('chunk-replay-idempotency-retained', replay.idempotentReplaySafe
      && replay.attemptedReplayCount === report.shape.chunkCount * replay.replayAttemptsPerChunk
      && replay.idempotentSkips === replay.attemptedReplayCount
      && replay.bytes.bytesRewrittenDuringReplay === 0
      && replay.receipts.duplicateReceiptRecordsWritten === 0, {
      attemptedReplayCount: replay.attemptedReplayCount,
      idempotentSkips: replay.idempotentSkips,
    }),
    proofGate('live-remote-preconditions-retained',
      report.evidence.preconditions.everyMutationHasLiveRemotePrecondition
        && report.evidence.preconditions.liveRemoteMutationPreconditions === report.shape.mutations, {
        mutations: report.shape.mutations,
        liveRemoteMutationPreconditions: report.evidence.preconditions.liveRemoteMutationPreconditions,
      }),
    proofGate('bounded-runtime-resources', runtimeWithinBudget, {
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.maxDurationMs,
      heapUsedBytes: runtime.heapUsedBytes,
      maxHeapUsedBytes: runtime.maxHeapUsedBytes,
    }),
    proofGate('support-only-production-blockers-retained', supportOnlyBlockersRetained, {
      speedClaimsAllowed: report.rolloutSafetyGates.summary.speedClaimsAllowed,
      productionBlockers: productionBlockers.filter((blocker) => blocker.startsWith('production-')),
    }),
  ];
  const status = gates.every((gate) => gate.status === 'pass') ? 'passed' : 'failed';
  const publicEvidence = {
    rppId: 'RPP-0723',
    proofId,
    variant: 2,
    status,
    builtOn: {
      policyId: policy.policyId,
      variant: policy.variant,
      evidenceHash: policy.evidenceHash,
    },
    boundaryOrder: policy.boundaryOrder,
    transfer: {
      complete: policy.transfer.complete,
      manifestFinalized: policy.transfer.manifestFinalized,
      fileStagingFinalized: policy.transfer.fileStagingFinalized,
      manifestFinalizeSequence: policy.transfer.manifestFinalizeSequence,
      transferFinalizeSequence: policy.transfer.transferFinalizeSequence,
      chunkCount: policy.transfer.chunkCount,
      exactReceiptMatches: policy.transfer.exactReceiptMatches,
      duplicateReceiptKeys: policy.transfer.duplicateReceiptKeys,
      canonicalVisibleDuringTransfer: policy.transfer.canonicalVisibleDuringTransfer,
      planIdHash: digest(report.resources.transfer.planId),
      resourceKeyHash: digest(report.resources.transfer.resourceKey),
    },
    resume: {
      receiptOnlyResumeSafe: policy.resume.receiptOnlyResumeSafe,
      chunksSkippedByReceipt: policy.resume.chunksSkippedByReceipt,
      chunksToUpload: policy.resume.chunksToUpload,
      bytesSkippedByReceipt: policy.resume.bytesSkippedByReceipt,
      bytesToUpload: policy.resume.bytesToUpload,
      duplicateChunkBytes: policy.resume.duplicateChunkBytes,
      duplicateMutationWork: policy.resume.duplicateMutationWork,
      missingReceiptBlocksSkip: policy.resume.missingReceiptBlocksSkip,
      mismatchedReceiptBlocksSkip: policy.resume.mismatchedReceiptBlocksSkip,
    },
    applyAccounting: {
      firstApplyBoundarySequence: policy.apply.firstApplyBoundarySequence,
      applyOpenedAfterTransferFinalize: policy.apply.applyOpenedAfterTransferFinalize,
      boundarySequencePreserved,
      mutationWorkAllowedDuringTransferResume: policy.apply.mutationWorkAllowedDuringTransferResume,
      mutationWorkReplayedBeforeTransferFinalize:
        policy.apply.mutationWorkReplayedBeforeTransferFinalize,
      freshMutationWorkDuringTransferResume: policy.apply.freshMutationWorkDuringTransferResume,
      duplicateMutationWork: policy.apply.duplicateMutationWork,
      noDuplicateMutationWork: policy.apply.noDuplicateMutationWork,
      appliedMutations: report.results.appliedMutations,
      liveRemoteMutationPreconditions: report.evidence.preconditions.liveRemoteMutationPreconditions,
    },
    replay: {
      idempotentReplaySafe: replay.idempotentReplaySafe,
      replayAttemptsPerChunk: replay.replayAttemptsPerChunk,
      attemptedReplayCount: replay.attemptedReplayCount,
      idempotentSkips: replay.idempotentSkips,
      bytesRewrittenDuringReplay: replay.bytes.bytesRewrittenDuringReplay,
      duplicateReceiptRecordsWritten: replay.receipts.duplicateReceiptRecordsWritten,
      duplicateMutationWork: replay.mutationWork.duplicateMutationWork,
      applyBoundaryOpenedDuringReplay: replay.mutationWork.applyBoundaryOpenedDuringReplay,
    },
    runtime: {
      budgetStatus: runtime.status,
      profile: runtime.profile,
      durationMs: runtime.durationMs,
      maxDurationMs: runtime.maxDurationMs,
      durationWithinBudget: runtime.durationWithinBudget,
      heapUsedBytes: runtime.heapUsedBytes,
      maxHeapUsedBytes: runtime.maxHeapUsedBytes,
      heapWithinBudget: runtime.heapWithinBudget,
      conservativeBudgetReporting: runtime.conservativeBudgetReporting,
    },
    resources: {
      transfer: {
        chunkReceipts: report.resources.transfer.chunkReceipts,
        chunkManifestDigest: report.resources.transfer.chunkManifestDigest,
        finalizedHash: report.resources.transfer.finalizedHash,
      },
      apply: {
        mutationResources: report.resources.apply.mutationResources,
        rowResources: report.resources.apply.rowResources,
        atomicGroupMutationCount: report.resources.apply.atomicGroupMutationCount,
      },
      journals: {
        allJournalsIntegrityOk: report.evidence.journal.allJournalsIntegrityOk,
        durableJournalsContainNoRawValues: report.evidence.redaction.durableJournalsContainNoRawValues,
      },
    },
    gates,
    release: {
      supportOnly: true,
      productionThroughput: report.throughput.productionThroughput,
      productionClaimStatus: report.claims.productionThroughput.status,
      speedClaimsAllowed: report.rolloutSafetyGates.summary.speedClaimsAllowed,
      productionBlockers,
      finalReleaseStatus: 'NO-GO-without-production-storage-receipts-and-external-durability-proof',
    },
    redaction: 'hash-and-count-only',
  };

  return {
    ...publicEvidence,
    evidenceHash: digest(publicEvidence),
  };
}

function proofGate(id, passed, metrics = {}) {
  return {
    id,
    status: passed ? 'pass' : 'fail',
    metrics,
  };
}

function gateById(proof, id) {
  const gate = proof.gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `missing proof gate ${id}`);
  return gate;
}

function assertProjectionHasNoRawBenchmarkValues(proof) {
  const serialized = JSON.stringify(proof);
  for (const token of [
    'row-payload',
    'commerce_bench',
    'catalog identity',
    'catalog-export.bin',
    'wp-content/plugins',
    'benchmark-topic',
    'Benchmark child post',
    'Benchmark featured attachment',
  ]) {
    assert.equal(serialized.includes(token), false, `proof leaked raw benchmark token ${token}`);
  }
}
