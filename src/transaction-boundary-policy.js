import { digest } from './stable-json.js';

export const TRANSACTION_BOUNDARY_POLICY_ID = 'rpp-0703-transaction-boundary-policy';
export const TRANSACTION_BOUNDARY_POLICY_VARIANT = 1;

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

export function buildChunkTransferTransactionBoundaryPolicy({
  planId,
  resourceKey,
  manifestDigest = null,
  assembledHash = null,
  manifestEntries,
  chunkReceiptRecords,
  journalRecords = [],
  resumeRecords = [],
}) {
  const entries = requireArray(manifestEntries, 'manifestEntries');
  const receipts = requireArray(chunkReceiptRecords, 'chunkReceiptRecords');
  const records = requireArray(journalRecords, 'journalRecords');
  const resumeJournalRecords = requireArray(resumeRecords, 'resumeRecords');
  const manifestRecord = findManifestFinalizedRecord(records, {
    planId,
    resourceKey,
    manifestDigest,
  });
  const fileStagingFinalizedRecord = findFileStagingFinalizedRecord(records, {
    planId,
    resourceKey,
    assembledHash,
  });
  const receiptMatches = entries.map((entry) => ({
    chunkIndex: entry.chunkIndex,
    offsetBytes: entry.offsetBytes,
    sizeBytes: entry.sizeBytes,
    receiptKeyHash: digest(entry.receiptKey || null),
    matched: Boolean(exactReceiptForManifestEntry(receipts, { planId, resourceKey }, entry)),
  }));
  const exactReceiptMatches = receiptMatches.filter((match) => match.matched).length;
  const chunksToUpload = entries.length - exactReceiptMatches;
  const bytesSkippedByReceipt = entries
    .filter((entry) => exactReceiptForManifestEntry(receipts, { planId, resourceKey }, entry))
    .reduce((sum, entry) => sum + integerOrZero(entry.sizeBytes), 0);
  const bytesToUpload = entries
    .filter((entry) => !exactReceiptForManifestEntry(receipts, { planId, resourceKey }, entry))
    .reduce((sum, entry) => sum + integerOrZero(entry.sizeBytes), 0);
  const duplicateReceiptKeys = duplicateCount(receipts
    .map((record) => record?.receiptKey)
    .filter((receiptKey) => typeof receiptKey === 'string' && receiptKey.length > 0));
  const firstEntry = entries[0] || null;
  const firstReceipt = firstEntry
    ? exactReceiptForManifestEntry(receipts, { planId, resourceKey }, firstEntry)
    : null;
  const missingReceiptBlocksSkip = firstEntry && firstReceipt
    ? !exactReceiptForManifestEntry(
      receipts.filter((record) => record !== firstReceipt),
      { planId, resourceKey },
      firstEntry,
    )
    : entries.length === 0;
  const mismatchedReceiptBlocksSkip = firstEntry && firstReceipt
    ? !receiptMatchesManifestEntry(
      {
        ...firstReceipt,
        chunkDigest: `sha256:${'0'.repeat(64)}`,
      },
      { planId, resourceKey },
      firstEntry,
    )
    : entries.length === 0;
  const transferFinalizeSequence = sequenceNumber(fileStagingFinalizedRecord);
  const manifestFinalizeSequence = sequenceNumber(manifestRecord);
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
  const transferComplete = entries.length > 0
    && exactReceiptMatches === entries.length
    && duplicateReceiptKeys === 0
    && Boolean(manifestRecord)
    && Boolean(fileStagingFinalizedRecord);
  const noDuplicateMutationWork = resumeFreshMutationWork === 0
    && mutationWorkBeforeTransferFinalize === 0;
  const receiptOnlyResumeSafe = transferComplete
    && missingReceiptBlocksSkip
    && mismatchedReceiptBlocksSkip
    && noDuplicateMutationWork;
  const status = receiptOnlyResumeSafe && applyOpenedAfterTransferFinalize
    ? 'passed'
    : 'blocked';

  const publicEvidence = {
    policyId: TRANSACTION_BOUNDARY_POLICY_ID,
    variant: TRANSACTION_BOUNDARY_POLICY_VARIANT,
    status,
    boundaryOrder: [
      'chunk-transfer-transaction',
      'file-staging-finalize-boundary',
      'apply-mutation-transaction',
    ],
    transfer: {
      transaction: 'chunk-transfer',
      completionRule: 'complete-after-durable-receipts-and-finalized-staging',
      complete: transferComplete,
      manifestFinalized: Boolean(manifestRecord),
      fileStagingFinalized: Boolean(fileStagingFinalizedRecord),
      manifestFinalizeSequence,
      transferFinalizeSequence,
      chunkCount: entries.length,
      exactReceiptMatches,
      duplicateReceiptKeys,
      canonicalVisibleDuringTransfer: receipts.some((record) => record?.canonicalVisible === true),
    },
    resume: {
      transaction: 'chunk-transfer',
      status: receiptOnlyResumeSafe ? 'passed' : 'blocked',
      receiptOnlyResumeSafe,
      chunksSkippedByReceipt: exactReceiptMatches,
      chunksToUpload,
      bytesSkippedByReceipt,
      bytesToUpload,
      duplicateChunkBytes: 0,
      duplicateMutationWork: resumeFreshMutationWork,
      missingReceiptBlocksSkip,
      mismatchedReceiptBlocksSkip,
      resumeCursorFields: [
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
    },
    apply: {
      transaction: 'mutation-apply',
      opensAfter: 'file-staging-finalized',
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

function findManifestFinalizedRecord(records, { planId, resourceKey, manifestDigest }) {
  return records.find((record) => (
    record?.type === 'chunk-manifest-finalized'
      && record.planId === planId
      && record.resourceKey === resourceKey
      && (manifestDigest === null || record.manifestDigest === manifestDigest)
  )) || null;
}

function findFileStagingFinalizedRecord(records, { planId, resourceKey, assembledHash }) {
  return records.find((record) => (
    record?.type === 'file-staging-finalized'
      && record.planId === planId
      && record.resourceKey === resourceKey
      && (assembledHash === null || record.assembledHash === assembledHash)
  )) || null;
}

function firstRecordSequence(records, types) {
  const sequences = records
    .filter((record) => types.includes(record?.type))
    .map(sequenceNumber)
    .filter((sequence) => sequence !== null);
  return sequences.length === 0 ? null : Math.min(...sequences);
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

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`Transaction boundary policy requires ${label} to be an array.`);
  }
  return value;
}
