import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChunkReplayIdempotencyEvidence,
  resolveChunkReplayAttempt,
} from '../src/chunk-replay-idempotency.js';

const scope = {
  planId: 'plan-rpp-0709',
  resourceKey: 'file:wp-content/uploads/2026/05/large.bin',
};

function manifestEntry(overrides = {}) {
  return {
    chunkIndex: 0,
    offsetBytes: 0,
    sizeBytes: 262_144,
    localResourceHash: `sha256:${'a'.repeat(64)}`,
    chunkDigest: `sha256:${'b'.repeat(64)}`,
    receiptKey: `${scope.planId}:${scope.resourceKey}:sha256:${'a'.repeat(64)}:chunk:0:0:262144:sha256:${'b'.repeat(64)}`,
    idempotencyKey: `${scope.planId}:${scope.resourceKey}:sha256:${'a'.repeat(64)}:chunk:0`,
    canonicalVisible: false,
    ...overrides,
  };
}

function receiptFor(entry, overrides = {}) {
  return {
    type: 'chunk-receipt',
    ...scope,
    state: 'staged',
    chunkCount: 1,
    chunkIndex: entry.chunkIndex,
    offsetBytes: entry.offsetBytes,
    sizeBytes: entry.sizeBytes,
    localResourceHash: entry.localResourceHash,
    chunkDigest: entry.chunkDigest,
    receiptKey: entry.receiptKey,
    idempotencyKey: entry.idempotencyKey,
    canonicalVisible: false,
    ...overrides,
  };
}

test('exact chunk replay returns the existing durable receipt without writing duplicate bytes', () => {
  const entry = manifestEntry();
  const result = resolveChunkReplayAttempt({
    ...scope,
    manifestEntry: entry,
    chunkReceiptRecords: [receiptFor(entry)],
  });

  assert.equal(result.status, 'receipt-returned');
  assert.equal(result.canSkipUpload, true);
  assert.equal(result.receiptKey, entry.receiptKey);
  assert.equal(result.bytesWritten, 0);
  assert.equal(result.receiptRecordsCreated, 0);
  assert.equal(result.mutationWork, 0);
  assert.equal(result.canonicalVisible, false);
});

test('chunk replay blocks idempotency-key conflicts and refuses receipt inference', () => {
  const entry = manifestEntry();
  const receipt = receiptFor(entry);
  const mismatch = manifestEntry({
    chunkDigest: `sha256:${'c'.repeat(64)}`,
  });

  const conflict = resolveChunkReplayAttempt({
    ...scope,
    manifestEntry: mismatch,
    chunkReceiptRecords: [receipt],
  });
  const missing = resolveChunkReplayAttempt({
    ...scope,
    manifestEntry: entry,
    chunkReceiptRecords: [],
  });

  assert.equal(conflict.status, 'blocked');
  assert.equal(conflict.reason, 'idempotency-key-conflict');
  assert.equal(conflict.canSkipUpload, false);
  assert.equal(conflict.bytesWritten, 0);
  assert.equal(missing.status, 'upload-required');
  assert.equal(missing.reason, 'missing-durable-receipt');
  assert.equal(missing.canSkipUpload, false);
  assert.equal(missing.bytesWritten, 0);
});

test('chunk replay idempotency evidence proves duplicate-free replay inside budgets', () => {
  const entries = [
    manifestEntry(),
    manifestEntry({
      chunkIndex: 1,
      offsetBytes: 262_144,
      chunkDigest: `sha256:${'d'.repeat(64)}`,
      receiptKey: `${scope.planId}:${scope.resourceKey}:sha256:${'a'.repeat(64)}:chunk:1:262144:262144:sha256:${'d'.repeat(64)}`,
      idempotencyKey: `${scope.planId}:${scope.resourceKey}:sha256:${'a'.repeat(64)}:chunk:1`,
    }),
  ];
  const evidence = buildChunkReplayIdempotencyEvidence({
    ...scope,
    profile: 'unit',
    manifestEntries: entries,
    chunkReceiptRecords: entries.map((entry) => receiptFor(entry)),
    timings: {
      totalMs: 120,
      chunkReplayDecisionMs: 2,
    },
  });

  assert.equal(evidence.status, 'passed');
  assert.equal(evidence.attempts.attemptedReplays, 2);
  assert.equal(evidence.attempts.exactReceiptReplays, 2);
  assert.equal(evidence.attempts.localResourceHashCovered, true);
  assert.equal(evidence.attempts.duplicateChunkBytes, 0);
  assert.equal(evidence.attempts.duplicateReceiptRecordsCreated, 0);
  assert.equal(evidence.probes.missingReceipt.status, 'upload-required');
  assert.equal(evidence.probes.mismatchedReplay.status, 'blocked');
  assert.equal(evidence.budgets.checks.totalRuntimeMs.passed, true);
  assert.equal(evidence.budgets.checks.chunkReplayDecisionMs.passed, true);
  assert.equal(evidence.budgets.largeSiteRunFinishesInsideDocumentedBudgets, true);
  assert.match(evidence.evidenceHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(evidence), new RegExp(entries[0].receiptKey));
});

test('chunk replay idempotency evidence fails closed when runtime budget is exceeded', () => {
  const entry = manifestEntry();
  const evidence = buildChunkReplayIdempotencyEvidence({
    ...scope,
    profile: 'unit',
    manifestEntries: [entry],
    chunkReceiptRecords: [receiptFor(entry)],
    timings: {
      totalMs: 60_001,
      chunkReplayDecisionMs: 2,
    },
  });

  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.budgets.checks.totalRuntimeMs.passed, false);
  assert.equal(evidence.budgets.largeSiteRunFinishesInsideDocumentedBudgets, false);
});
