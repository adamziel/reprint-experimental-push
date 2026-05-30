import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGuardedExecutorBenchmark } from '../scripts/bench/guarded-executor-benchmark.js';

const fixedNow = new Date('2026-05-24T00:00:00.000Z');

function tempBenchmarkDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0718-timeout-budget-proof-'));
}

test('RPP-0718 timeout budget proof resumes chunk transfer without duplicate mutation work', { concurrency: false }, () => {
  const report = runGuardedExecutorBenchmark({
    profile: 'unit',
    fileBytes: 1024 * 1024,
    chunkSizeBytes: 256 * 1024,
    rowCount: 8,
    rowPayloadBytes: 64,
    now: fixedNow,
    tempDir: tempBenchmarkDir(),
  });
  const proof = report.evidence.timeoutBudgetProof;

  assert.equal(proof.proofId, 'rpp-0718-timeout-budget-proof');
  assert.equal(proof.variant, 1);
  assert.equal(proof.status, 'passed');
  assert.equal(report.evidence.guardedTransfer.timeoutBudgetProof.evidenceHash, proof.evidenceHash);

  assert.equal(proof.budget.scope, 'chunk-transfer-attempt');
  assert.equal(proof.budget.timeoutExpiredDuring, 'chunk-transfer');
  assert.equal(proof.budget.timeoutBeforeApply, true);
  assert.equal(proof.budget.nextChunkWouldExceedBudget, true);
  assert.equal(proof.budget.timeoutExpiredBeforeCompletion, true);
  assert.ok(proof.budget.elapsedMsForDurableReceipts < proof.budget.elapsedMsAtTimeout);

  assert.equal(proof.partialTransfer.chunkCount, report.shape.chunkCount);
  assert.ok(proof.partialTransfer.receiptsBeforeTimeout > 0);
  assert.ok(proof.partialTransfer.receiptsBeforeTimeout < report.shape.chunkCount);
  assert.ok(proof.partialTransfer.chunksUnacknowledgedAtTimeout > 0);
  assert.equal(proof.partialTransfer.unacknowledgedChunksMarkedComplete, 0);
  assert.equal(proof.partialTransfer.canonicalVisibleAtTimeout, false);
  assert.equal(proof.partialTransfer.mutationWorkBeforeTimeout, 0);

  assert.equal(proof.resume.receiptOnlyResumeSafe, true);
  assert.equal(proof.resume.chunksSkippedByReceipt, proof.partialTransfer.receiptsBeforeTimeout);
  assert.equal(
    proof.resume.chunksUploadedAfterResume,
    report.shape.chunkCount - proof.partialTransfer.receiptsBeforeTimeout,
  );
  assert.equal(proof.resume.bytesSkippedByReceipt, proof.partialTransfer.bytesDurablyReceiptedBeforeTimeout);
  assert.equal(proof.resume.duplicateChunkBytes, 0);
  assert.equal(proof.resume.duplicateMutationWork, 0);
  assert.equal(proof.resume.missingReceiptBlocksSkip, true);
  assert.equal(proof.resume.mismatchedReceiptBlocksSkip, true);
  assert.deepEqual(proof.resume.resumeCursorFields, [
    'planId',
    'resourceKey',
    'chunkIndex',
    'offsetBytes',
    'sizeBytes',
    'chunkDigest',
    'receiptKey',
    'idempotencyKey',
  ]);

  assert.equal(proof.apply.applyOpenedAfterTransferFinalize, true);
  assert.ok(proof.apply.transferFinalizeSequence < proof.apply.firstApplyBoundarySequence);
  assert.equal(proof.apply.mutationWorkAllowedDuringTransferResume, false);
  assert.equal(proof.apply.mutationWorkReplayedBeforeTransferFinalize, 0);
  assert.equal(proof.apply.freshMutationWorkDuringTransferResume, 0);
  assert.equal(proof.apply.duplicateMutationWork, 0);
  assert.equal(proof.apply.noDuplicateMutationWork, true);

  assert.equal(proof.receiptMatches.length, report.shape.chunkCount);
  assert.ok(proof.receiptMatches.every((match) => match.matched === true));
  assert.ok(proof.receiptMatches.some((match) => match.receiptedBeforeTimeout === true));
  assert.ok(proof.receiptMatches.some((match) => match.resumedAfterTimeout === true));
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(proof), /row-payload|commerce_bench|catalog identity/);
});
