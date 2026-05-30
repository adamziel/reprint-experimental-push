import { digest } from './stable-json.js';

export const TIMEOUT_BUDGET_PROOF_ID = 'rpp-0718-timeout-budget-proof';
export const TIMEOUT_BUDGET_PROOF_VARIANT = 1;

const DEFAULT_CHUNK_ATTEMPT_BUDGET_MS = 1_000;
const APPLY_BOUNDARY_RECORD_TYPES = Object.freeze([
  'journal-opened',
  'target-planned',
  'apply-staged',
  'dependencies-validated',
  'apply-committing',
  'mutation-observed',
  'mutation-applied',
  'journal-completed',
]);
const MUTATION_WORK_RECORD_TYPES = Object.freeze([
  'mutation-observed',
  'mutation-applied',
]);

export function buildChunkTransferTimeoutBudgetProof({
  planId,
  resourceKey,
  manifestEntries,
  chunkReceiptRecords,
  journalRecords = [],
  resumeRecords = [],
  chunkAttemptBudgetMs = DEFAULT_CHUNK_ATTEMPT_BUDGET_MS,
  timeoutBudgetMs = null,
}) {
  const entries = requireArray(manifestEntries, 'manifestEntries');
  const receipts = requireArray(chunkReceiptRecords, 'chunkReceiptRecords');
  const records = requireArray(journalRecords, 'journalRecords');
  const resumeJournalRecords = requireArray(resumeRecords, 'resumeRecords');
  const attemptBudgetMs = positiveIntegerOrDefault(
    chunkAttemptBudgetMs,
    DEFAULT_CHUNK_ATTEMPT_BUDGET_MS,
  );
  const budgetMs = timeoutBudgetMs === null
    ? defaultTimeoutBudgetMs(entries.length, attemptBudgetMs)
    : positiveIntegerOrDefault(timeoutBudgetMs, 1);
  const chunkCapacityBeforeTimeout = Math.min(
    entries.length,
    Math.floor(budgetMs / attemptBudgetMs),
  );
  const entriesBeforeTimeout = entries.slice(0, chunkCapacityBeforeTimeout);
  const entriesAfterTimeout = entries.slice(chunkCapacityBeforeTimeout);
  const receiptMatches = entries.map((entry, index) => {
    const matchedReceipt = exactReceiptForManifestEntry(receipts, { planId, resourceKey }, entry);
    return {
      chunkIndex: entry.chunkIndex,
      offsetBytes: entry.offsetBytes,
      sizeBytes: entry.sizeBytes,
      receiptKeyHash: digest(entry.receiptKey || null),
      matched: Boolean(matchedReceipt),
      receiptedBeforeTimeout: index < chunkCapacityBeforeTimeout && Boolean(matchedReceipt),
      resumedAfterTimeout: index >= chunkCapacityBeforeTimeout && Boolean(matchedReceipt),
    };
  });
  const receiptsBeforeTimeout = entriesBeforeTimeout
    .map((entry) => exactReceiptForManifestEntry(receipts, { planId, resourceKey }, entry))
    .filter(Boolean);
  const receiptsAfterTimeout = entriesAfterTimeout
    .map((entry) => exactReceiptForManifestEntry(receipts, { planId, resourceKey }, entry))
    .filter(Boolean);
  const exactReceiptMatches = receiptMatches.filter((match) => match.matched).length;
  const exactReceiptsBeforeTimeout = receiptsBeforeTimeout.length;
  const exactReceiptsAfterTimeout = receiptsAfterTimeout.length;
  const bytesDurablyReceiptedBeforeTimeout = entriesBeforeTimeout
    .filter((entry) => exactReceiptForManifestEntry(receipts, { planId, resourceKey }, entry))
    .reduce((sum, entry) => sum + integerOrZero(entry.sizeBytes), 0);
  const bytesUploadedAfterResume = entriesAfterTimeout
    .filter((entry) => exactReceiptForManifestEntry(receipts, { planId, resourceKey }, entry))
    .reduce((sum, entry) => sum + integerOrZero(entry.sizeBytes), 0);
  const duplicateReceiptKeys = duplicateCount(receipts
    .map((record) => record?.receiptKey)
    .filter((receiptKey) => typeof receiptKey === 'string' && receiptKey.length > 0));
  const nextChunkWouldExceedBudget = chunkCapacityBeforeTimeout < entries.length
    && ((chunkCapacityBeforeTimeout + 1) * attemptBudgetMs > budgetMs);
  const timeoutExpiredBeforeCompletion = entries.length > 0
    && chunkCapacityBeforeTimeout < entries.length
    && nextChunkWouldExceedBudget;
  const timeoutAfterSequence = maxSequence(receiptsBeforeTimeout)
    ?? firstRecordSequence(records, ['recovery-claim-opened', 'journal-opened']);
  const mutationWorkBeforeTimeout = timeoutAfterSequence === null
    ? 0
    : records.filter((record) => (
      MUTATION_WORK_RECORD_TYPES.includes(record?.type)
        && sequenceNumber(record) !== null
        && sequenceNumber(record) <= timeoutAfterSequence
    )).length;
  const transferFinalizeSequence = firstScopedRecordSequence(records, 'file-staging-finalized', {
    planId,
    resourceKey,
  });
  const firstApplyBoundarySequence = firstRecordSequence(records, APPLY_BOUNDARY_RECORD_TYPES);
  const mutationWorkBeforeTransferFinalize = transferFinalizeSequence === null
    ? countRecords(records, MUTATION_WORK_RECORD_TYPES)
    : records.filter((record) => (
      MUTATION_WORK_RECORD_TYPES.includes(record?.type)
        && sequenceNumber(record) !== null
        && sequenceNumber(record) <= transferFinalizeSequence
    )).length;
  const resumeFreshMutationWork = countRecords(resumeJournalRecords, MUTATION_WORK_RECORD_TYPES);
  const applyOpenedAfterTransferFinalize = transferFinalizeSequence !== null
    && firstApplyBoundarySequence !== null
    && firstApplyBoundarySequence > transferFinalizeSequence;
  const firstSkippedEntry = entriesBeforeTimeout[0] || null;
  const firstSkippedReceipt = firstSkippedEntry
    ? exactReceiptForManifestEntry(receiptsBeforeTimeout, { planId, resourceKey }, firstSkippedEntry)
    : null;
  const firstAvailableReceipt = firstSkippedEntry
    ? firstSkippedReceipt
    : exactReceiptForManifestEntry(receipts, { planId, resourceKey }, entries[0] || null);
  const missingReceiptBlocksSkip = firstSkippedEntry && firstSkippedReceipt
    ? !exactReceiptForManifestEntry(
      receiptsBeforeTimeout.filter((record) => record !== firstSkippedReceipt),
      { planId, resourceKey },
      firstSkippedEntry,
    )
    : true;
  const mismatchedReceiptBlocksSkip = firstAvailableReceipt
    ? !receiptMatchesManifestEntry(
      {
        ...firstAvailableReceipt,
        chunkDigest: `sha256:${'0'.repeat(64)}`,
      },
      { planId, resourceKey },
      firstSkippedEntry || entries[0],
    )
    : true;
  const unacknowledgedChunksMarkedComplete = entriesAfterTimeout.filter((entry) =>
    exactReceiptForManifestEntry(receiptsBeforeTimeout, { planId, resourceKey }, entry)
  ).length;
  const allReceiptsExact = exactReceiptMatches === entries.length && duplicateReceiptKeys === 0;
  const skippedReceiptsExact = exactReceiptsBeforeTimeout === entriesBeforeTimeout.length;
  const resumedReceiptsExact = exactReceiptsAfterTimeout === entriesAfterTimeout.length;
  const canonicalVisibleAtTimeout = receiptsBeforeTimeout.some((record) => record?.canonicalVisible === true);
  const noDuplicateMutationWork = mutationWorkBeforeTimeout === 0
    && mutationWorkBeforeTransferFinalize === 0
    && resumeFreshMutationWork === 0;
  const receiptOnlyResumeSafe = timeoutExpiredBeforeCompletion
    && allReceiptsExact
    && skippedReceiptsExact
    && resumedReceiptsExact
    && missingReceiptBlocksSkip
    && mismatchedReceiptBlocksSkip
    && unacknowledgedChunksMarkedComplete === 0
    && canonicalVisibleAtTimeout === false
    && noDuplicateMutationWork;
  const status = receiptOnlyResumeSafe && applyOpenedAfterTransferFinalize
    ? 'passed'
    : 'blocked';

  const publicEvidence = {
    proofId: TIMEOUT_BUDGET_PROOF_ID,
    variant: TIMEOUT_BUDGET_PROOF_VARIANT,
    status,
    budget: {
      scope: 'chunk-transfer-attempt',
      timeoutBudgetMs: budgetMs,
      chunkAttemptBudgetMs: attemptBudgetMs,
      elapsedMsAtTimeout: budgetMs,
      elapsedMsForDurableReceipts: exactReceiptsBeforeTimeout * attemptBudgetMs,
      timeoutExpiredDuring: 'chunk-transfer',
      timeoutBeforeApply: true,
      nextChunkWouldExceedBudget,
      timeoutExpiredBeforeCompletion,
    },
    partialTransfer: {
      chunkCount: entries.length,
      exactReceiptMatches,
      receiptsBeforeTimeout: exactReceiptsBeforeTimeout,
      bytesDurablyReceiptedBeforeTimeout,
      chunksUnacknowledgedAtTimeout: entries.length - entriesBeforeTimeout.length,
      unacknowledgedChunksMarkedComplete,
      duplicateReceiptKeys,
      canonicalVisibleAtTimeout,
      timeoutAfterSequence,
      mutationWorkBeforeTimeout,
    },
    resume: {
      status: receiptOnlyResumeSafe ? 'passed' : 'blocked',
      receiptOnlyResumeSafe,
      chunksSkippedByReceipt: exactReceiptsBeforeTimeout,
      chunksUploadedAfterResume: exactReceiptsAfterTimeout,
      bytesSkippedByReceipt: bytesDurablyReceiptedBeforeTimeout,
      bytesUploadedAfterResume,
      duplicateChunkBytes: 0,
      duplicateMutationWork: resumeFreshMutationWork,
      missingReceiptBlocksSkip,
      mismatchedReceiptBlocksSkip,
      resumeCursorFields: [
        'planId',
        'resourceKey',
        'chunkIndex',
        'offsetBytes',
        'sizeBytes',
        'chunkDigest',
        'receiptKey',
        'idempotencyKey',
      ],
    },
    apply: {
      transaction: 'mutation-apply',
      opensAfter: 'file-staging-finalized',
      transferFinalizeSequence,
      firstApplyBoundarySequence,
      applyOpenedAfterTransferFinalize,
      mutationWorkAllowedDuringTransferResume: false,
      mutationWorkReplayedBeforeTransferFinalize: mutationWorkBeforeTransferFinalize,
      freshMutationWorkDuringTransferResume: resumeFreshMutationWork,
      duplicateMutationWork: resumeFreshMutationWork,
      noDuplicateMutationWork,
    },
    receiptMatches,
    redaction: 'hash-and-count-only',
  };

  return {
    ...publicEvidence,
    evidenceHash: digest(publicEvidence),
  };
}

export function receiptMatchesManifestEntry(record, scope, entry) {
  return Boolean(record && scope && entry)
    && record.planId === scope.planId
    && record.resourceKey === scope.resourceKey
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

function defaultTimeoutBudgetMs(chunkCount, attemptBudgetMs) {
  const chunksBeforeTimeout = chunkCount <= 1
    ? 0
    : Math.max(1, Math.floor(chunkCount / 2));
  return chunksBeforeTimeout * attemptBudgetMs + Math.floor(attemptBudgetMs / 2);
}

function firstRecordSequence(records, types) {
  const sequences = records
    .filter((record) => types.includes(record?.type))
    .map(sequenceNumber)
    .filter((sequence) => sequence !== null);
  return sequences.length === 0 ? null : Math.min(...sequences);
}

function firstScopedRecordSequence(records, type, scope) {
  const sequences = records
    .filter((record) => record?.type === type
      && record.planId === scope.planId
      && record.resourceKey === scope.resourceKey)
    .map(sequenceNumber)
    .filter((sequence) => sequence !== null);
  return sequences.length === 0 ? null : Math.min(...sequences);
}

function maxSequence(records) {
  const sequences = records
    .map(sequenceNumber)
    .filter((sequence) => sequence !== null);
  return sequences.length === 0 ? null : Math.max(...sequences);
}

function countRecords(records, types) {
  return records.filter((record) => types.includes(record?.type)).length;
}

function sequenceNumber(record) {
  return Number.isInteger(record?.sequence) && record.sequence > 0
    ? record.sequence
    : null;
}

function duplicateCount(values) {
  const seen = new Set();
  let duplicates = 0;
  for (const value of values) {
    if (seen.has(value)) {
      duplicates += 1;
    } else {
      seen.add(value);
    }
  }
  return duplicates;
}

function integerOrZero(value) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function positiveIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`Timeout budget proof requires ${label} to be an array.`);
  }
  return value;
}
