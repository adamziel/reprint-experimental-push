import { digest } from './stable-json.js';

export const CHUNK_REPLAY_IDEMPOTENCY_POLICY_ID = 'rpp-0709-chunk-replay-idempotency';
export const CHUNK_REPLAY_IDEMPOTENCY_VARIANT = 1;

export const DEFAULT_CHUNK_REPLAY_BUDGETS = Object.freeze({
  unit: Object.freeze({
    maxTotalMs: 60_000,
    maxChunkReplayDecisionMs: 1_000,
    maxDuplicateChunkBytes: 0,
    maxDuplicateReceiptRecordsCreated: 0,
    maxDuplicateMutationWork: 0,
  }),
  ci: Object.freeze({
    maxTotalMs: 180_000,
    maxChunkReplayDecisionMs: 2_500,
    maxDuplicateChunkBytes: 0,
    maxDuplicateReceiptRecordsCreated: 0,
    maxDuplicateMutationWork: 0,
  }),
  guardedLarge: Object.freeze({
    maxTotalMs: 900_000,
    maxChunkReplayDecisionMs: 10_000,
    maxDuplicateChunkBytes: 0,
    maxDuplicateReceiptRecordsCreated: 0,
    maxDuplicateMutationWork: 0,
  }),
});

export function buildChunkReplayIdempotencyEvidence({
  profile = 'ci',
  planId,
  resourceKey,
  manifestEntries,
  chunkReceiptRecords,
  timings = {},
  budgets = DEFAULT_CHUNK_REPLAY_BUDGETS,
  replayAttemptsPerChunk = 1,
}) {
  const entries = requireArray(manifestEntries, 'manifestEntries');
  const receipts = requireArray(chunkReceiptRecords, 'chunkReceiptRecords');
  const replayBudget = chunkReplayBudgetForProfile(profile, budgets);
  const exactReplayAttempts = [];

  for (const entry of entries) {
    for (let attemptIndex = 0; attemptIndex < replayAttemptsPerChunk; attemptIndex++) {
      const result = resolveChunkReplayAttempt({
        planId,
        resourceKey,
        manifestEntry: entry,
        chunkReceiptRecords: receipts,
      });
      exactReplayAttempts.push(summarizeReplayAttempt({ entry, attemptIndex, result }));
    }
  }

  const firstEntry = entries[0] || null;
  const firstReceipt = firstEntry
    ? exactReceiptForManifestEntry(receipts, { planId, resourceKey }, firstEntry)
    : null;
  const missingReceiptProbe = firstEntry
    ? resolveChunkReplayAttempt({
      planId,
      resourceKey,
      manifestEntry: firstEntry,
      chunkReceiptRecords: receipts.filter((record) => record !== firstReceipt),
    })
    : emptyReplayProbe('upload-required', 'no-manifest-entry');
  const mismatchedReplayProbe = firstEntry
    ? resolveChunkReplayAttempt({
      planId,
      resourceKey,
      manifestEntry: mismatchedReplayEntry(firstEntry),
      chunkReceiptRecords: receipts,
    })
    : emptyReplayProbe('blocked', 'no-manifest-entry');

  const duplicateChunkBytes = exactReplayAttempts.reduce(
    (sum, attempt) => sum + attempt.bytesWritten,
    0,
  );
  const duplicateReceiptRecordsCreated = exactReplayAttempts.reduce(
    (sum, attempt) => sum + attempt.receiptRecordsCreated,
    0,
  );
  const duplicateMutationWork = exactReplayAttempts.reduce(
    (sum, attempt) => sum + attempt.mutationWork,
    0,
  );
  const exactReceiptReplays = exactReplayAttempts.filter((attempt) =>
    attempt.status === 'receipt-returned').length;
  const chunksCovered = new Set(exactReplayAttempts.map((attempt) => attempt.chunkIndex)).size;
  const localResourceHashCovered = entries.every((entry) =>
    typeof entry.localResourceHash === 'string'
    && entry.localResourceHash.startsWith('sha256:'));
  const everyExactReplayReturnedReceipt = exactReplayAttempts.length === entries.length * replayAttemptsPerChunk
    && exactReplayAttempts.every((attempt) => attempt.status === 'receipt-returned');
  const budgetChecks = buildBudgetChecks({
    budget: replayBudget,
    timings,
    duplicateChunkBytes,
    duplicateReceiptRecordsCreated,
    duplicateMutationWork,
  });
  const largeSiteRunFinishesInsideDocumentedBudgets = Object.values(budgetChecks)
    .every((check) => check.passed);
  const replaySafe = entries.length > 0
    && everyExactReplayReturnedReceipt
    && chunksCovered === entries.length
    && localResourceHashCovered
    && missingReceiptProbe.status === 'upload-required'
    && mismatchedReplayProbe.status === 'blocked'
    && duplicateChunkBytes === 0
    && duplicateReceiptRecordsCreated === 0
    && duplicateMutationWork === 0
    && exactReplayAttempts.every((attempt) => attempt.canonicalVisible === false);

  const publicEvidence = {
    policyId: CHUNK_REPLAY_IDEMPOTENCY_POLICY_ID,
    variant: CHUNK_REPLAY_IDEMPOTENCY_VARIANT,
    status: replaySafe && largeSiteRunFinishesInsideDocumentedBudgets ? 'passed' : 'blocked',
    profile,
    replayContract: {
      exactReplay: 'return-existing-durable-receipt-without-writing-bytes',
      missingReceipt: 'upload-required; do-not-infer-from-staging-object',
      mismatchedIdempotencyKeyReplay: 'block-idempotency-key-conflict',
      canonicalVisibility: 'chunk-replay-never-publishes-live-path',
    },
    scopeFields: [
      'planId',
      'resourceKey',
      'localResourceHash',
      'chunkIndex',
      'offsetBytes',
      'sizeBytes',
      'chunkDigest',
      'receiptKey',
      'idempotencyKey',
    ],
    attempts: {
      attemptedReplays: exactReplayAttempts.length,
      exactReceiptReplays,
      chunksCovered,
      bytesCovered: entries.reduce((sum, entry) => sum + integerOrZero(entry.sizeBytes), 0),
      duplicateChunkBytes,
      duplicateReceiptRecordsCreated,
      duplicateMutationWork,
      localResourceHashCovered,
      canonicalVisibleDuringReplay: exactReplayAttempts.some((attempt) =>
        attempt.canonicalVisible === true),
    },
    probes: {
      missingReceipt: summarizeReplayProbe(missingReceiptProbe),
      mismatchedReplay: summarizeReplayProbe(mismatchedReplayProbe),
    },
    budgets: {
      documentedProfile: profile,
      maxTotalMs: replayBudget.maxTotalMs,
      maxChunkReplayDecisionMs: replayBudget.maxChunkReplayDecisionMs,
      maxDuplicateChunkBytes: replayBudget.maxDuplicateChunkBytes,
      maxDuplicateReceiptRecordsCreated: replayBudget.maxDuplicateReceiptRecordsCreated,
      maxDuplicateMutationWork: replayBudget.maxDuplicateMutationWork,
      checks: budgetChecks,
      largeSiteRunFinishesInsideDocumentedBudgets,
    },
    replayAttempts: exactReplayAttempts,
    redaction: 'receipt-and-idempotency-keys-hashed',
  };

  return {
    ...publicEvidence,
    evidenceHash: digest(publicEvidence),
  };
}

export function resolveChunkReplayAttempt({
  planId,
  resourceKey,
  manifestEntry,
  chunkReceiptRecords,
}) {
  const receipts = requireArray(chunkReceiptRecords, 'chunkReceiptRecords');
  if (!manifestEntry) {
    return emptyReplayProbe('upload-required', 'missing-manifest-entry');
  }

  const scope = { planId, resourceKey };
  const exactReceipt = exactReceiptForManifestEntry(receipts, scope, manifestEntry);
  if (exactReceipt) {
    return {
      status: 'receipt-returned',
      reason: 'exact-durable-receipt',
      canSkipUpload: true,
      receiptKey: exactReceipt.receiptKey,
      idempotencyKey: exactReceipt.idempotencyKey,
      bytesWritten: 0,
      receiptRecordsCreated: 0,
      mutationWork: 0,
      canonicalVisible: false,
    };
  }

  const sameIdempotencyRecord = receipts.find((record) =>
    record?.planId === planId
    && record.resourceKey === resourceKey
    && record.idempotencyKey === manifestEntry.idempotencyKey);
  if (sameIdempotencyRecord) {
    return {
      status: 'blocked',
      reason: sameIdempotencyRecord.canonicalVisible === true
        ? 'canonical-visible-receipt-conflict'
        : 'idempotency-key-conflict',
      canSkipUpload: false,
      receiptKey: sameIdempotencyRecord.receiptKey,
      idempotencyKey: sameIdempotencyRecord.idempotencyKey,
      bytesWritten: 0,
      receiptRecordsCreated: 0,
      mutationWork: 0,
      canonicalVisible: sameIdempotencyRecord.canonicalVisible === true,
    };
  }

  return {
    status: 'upload-required',
    reason: 'missing-durable-receipt',
    canSkipUpload: false,
    receiptKey: null,
    idempotencyKey: manifestEntry.idempotencyKey || null,
    bytesWritten: 0,
    receiptRecordsCreated: 0,
    mutationWork: 0,
    canonicalVisible: false,
  };
}

export function chunkReplayBudgetForProfile(profile, budgets = DEFAULT_CHUNK_REPLAY_BUDGETS) {
  const budget = budgets[profile] || budgets.ci;
  if (!budget) {
    throw new Error(`Chunk replay idempotency budget is missing for profile: ${profile}`);
  }
  return budget;
}

export function receiptMatchesManifestEntry(record, scope, entry) {
  return Boolean(record && entry)
    && record.planId === scope.planId
    && record.resourceKey === scope.resourceKey
    && record.localResourceHash === entry.localResourceHash
    && record.chunkIndex === entry.chunkIndex
    && record.offsetBytes === entry.offsetBytes
    && record.sizeBytes === entry.sizeBytes
    && record.chunkDigest === entry.chunkDigest
    && record.receiptKey === entry.receiptKey
    && record.idempotencyKey === entry.idempotencyKey
    && record.canonicalVisible === false;
}

function exactReceiptForManifestEntry(records, scope, entry) {
  return records.find((record) => receiptMatchesManifestEntry(record, scope, entry)) || null;
}

function summarizeReplayAttempt({ entry, attemptIndex, result }) {
  return {
    chunkIndex: entry.chunkIndex,
    attemptIndex,
    status: result.status,
    reason: result.reason,
    canSkipUpload: result.canSkipUpload,
    idempotencyKeyHash: digest(result.idempotencyKey || entry.idempotencyKey || null),
    receiptKeyHash: digest(result.receiptKey || null),
    bytesWritten: result.bytesWritten,
    receiptRecordsCreated: result.receiptRecordsCreated,
    mutationWork: result.mutationWork,
    canonicalVisible: result.canonicalVisible,
  };
}

function summarizeReplayProbe(result) {
  return {
    status: result.status,
    reason: result.reason,
    canSkipUpload: result.canSkipUpload,
    idempotencyKeyHash: digest(result.idempotencyKey || null),
    receiptKeyHash: digest(result.receiptKey || null),
    bytesWritten: result.bytesWritten,
    receiptRecordsCreated: result.receiptRecordsCreated,
    mutationWork: result.mutationWork,
    canonicalVisible: result.canonicalVisible,
  };
}

function mismatchedReplayEntry(entry) {
  return {
    ...entry,
    chunkDigest: `sha256:${'0'.repeat(64)}`,
  };
}

function emptyReplayProbe(status, reason) {
  return {
    status,
    reason,
    canSkipUpload: false,
    receiptKey: null,
    idempotencyKey: null,
    bytesWritten: 0,
    receiptRecordsCreated: 0,
    mutationWork: 0,
    canonicalVisible: false,
  };
}

function buildBudgetChecks({
  budget,
  timings,
  duplicateChunkBytes,
  duplicateReceiptRecordsCreated,
  duplicateMutationWork,
}) {
  const totalMs = finiteNumberOrNull(timings.totalMs);
  const chunkReplayDecisionMs = finiteNumberOrNull(timings.chunkReplayDecisionMs);

  return {
    totalRuntimeMs: {
      actualMs: totalMs,
      maxMs: budget.maxTotalMs,
      passed: totalMs !== null && totalMs <= budget.maxTotalMs,
    },
    chunkReplayDecisionMs: {
      actualMs: chunkReplayDecisionMs,
      maxMs: budget.maxChunkReplayDecisionMs,
      passed: chunkReplayDecisionMs !== null
        && chunkReplayDecisionMs <= budget.maxChunkReplayDecisionMs,
    },
    duplicateChunkBytes: {
      actual: duplicateChunkBytes,
      max: budget.maxDuplicateChunkBytes,
      passed: duplicateChunkBytes <= budget.maxDuplicateChunkBytes,
    },
    duplicateReceiptRecordsCreated: {
      actual: duplicateReceiptRecordsCreated,
      max: budget.maxDuplicateReceiptRecordsCreated,
      passed: duplicateReceiptRecordsCreated <= budget.maxDuplicateReceiptRecordsCreated,
    },
    duplicateMutationWork: {
      actual: duplicateMutationWork,
      max: budget.maxDuplicateMutationWork,
      passed: duplicateMutationWork <= budget.maxDuplicateMutationWork,
    },
  };
}

function finiteNumberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function integerOrZero(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`Chunk replay idempotency requires ${label} to be an array.`);
  }
  return value;
}
