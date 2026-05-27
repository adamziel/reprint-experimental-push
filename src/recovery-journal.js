import fs from 'node:fs';
import path from 'node:path';
import { digest } from './stable-json.js';
import { deserializeResourceValue, resourceHash } from './resources.js';

export const RECOVERY_JOURNAL_SCHEMA_VERSION = 1;
const PRODUCTION_RECOVERY_JOURNAL_KIND = 'production-recovery-journal';
const PRODUCTION_RECOVERY_JOURNAL_SUPPORTED_SURFACE = 'claim-fenced-restart-readable';
const PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER = 'filesystem-compare-rename';
const CHECKED_DB_JOURNAL_SUPPORTED_SURFACE = 'claim-fenced-restart-readable';

const CLAIM_STATE_EVENT_TYPES = new Set([
  'recovery-claim-opened',
  'stale-claim-advanced',
]);
const CLAIM_APPEND_EVENT_TYPES = new Set([
  ...CLAIM_STATE_EVENT_TYPES,
  'stale-claim-rejected',
]);
const CHECKED_CLAIM_EVENT_TYPES = new Set([
  'idempotency-opened',
  'stale-claim-retry-started',
  'stale-claim-retry-in-progress',
  'stale-claim-rejected',
]);
const CLAIM_HASH_PATTERN = /^[a-f0-9]{64}$/;

const RAW_VALUE_KEYS = new Set([
  'body',
  'content',
  'contents',
  'data',
  'raw',
  'value',
  'values',
  'beforeValue',
  'afterValue',
]);

export class RecoveryJournalClaimStaleError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'RecoveryJournalClaimStaleError';
    this.code = 'RECOVERY_CLAIM_STALE';
    this.details = details;
  }
}

function hasStaleClaimRejectionEvidence(records) {
  return (Array.isArray(records) ? records : []).some(
    (record) => record.type === 'stale-claim-advanced' || record.type === 'stale-claim-rejected',
  );
}

function claimScopedStaleClaimRejectionEvidence(records, claim) {
  if (!CLAIM_HASH_PATTERN.test(claim?.activeClaimHash || '')) {
    return false;
  }

  return (Array.isArray(records) ? records : []).some(
    (record) => (record.type === 'stale-claim-advanced' || record.type === 'stale-claim-rejected')
      && (record.claimHash === claim.activeClaimHash
        || record.previousClaimHash === claim.activeClaimHash),
  );
}

function assertAllowedOptionKeys(options, allowedKeys, operationName) {
  const providedOptions = options && typeof options === 'object' ? options : {};
  const unexpectedKeys = Object.keys(providedOptions).filter((key) => !allowedKeys.has(key));
  if (unexpectedKeys.length > 0) {
    throw new Error(
      `${operationName} received unsupported option keys: ${unexpectedKeys.sort().join(', ')}`,
    );
  }
}

function artifactRefsContractMatches(artifactRefs) {
  const entries = Object.entries(artifactRefs ?? {});
  return entries.length > 0
    && entries.every(([key, value]) => hasNonEmptyString(key) && hasNonEmptyString(value));
}

function assertProductionRecoveryArtifactRefs(artifactRefs, operationName) {
  if (!artifactRefsContractMatches(artifactRefs)) {
    throw new Error(
      `${operationName} requires non-empty artifactRefs for claim-fenced production recovery journals.`,
    );
  }
}

export function openRecoveryJournal(filePath, options = {}) {
  const flags = options.truncate ? 'w+' : 'a+';
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let existing = { records: [] };

  if (!options.truncate) {
    existing = readRecoveryJournal(filePath);
    if (existing.exists && existing.integrity.status !== 'ok') {
      throw new Error(`Refusing to append to invalid recovery journal: ${existing.integrity.reason}`);
    }
  }

  const fd = fs.openSync(filePath, flags);
  const nextSequence = existing.records.reduce(
    (next, record) => Math.max(next, record.sequence + 1),
    1,
  );

  return new RecoveryJournalWriter(filePath, fd, nextSequence, {
    now: options.now,
    claimId: options.claimId || options.claim?.id || null,
  });
}

export function checkedDurableJournalBoundarySatisfied(dbJournal) {
  const writerLease = dbJournal?.writerLease;
  const nestedWriterLease = dbJournal?.leaseFence?.writerLease;
  const productionAdapter = dbJournal?.ownership?.productionAdapter;
  const leaseFenceBoundary = dbJournal?.leaseFence?.boundary;
  const claim = dbJournal?.claim;
  return dbJournal?.schemaVersion === RECOVERY_JOURNAL_SCHEMA_VERSION
    && /(packaged production plugin|checked live production-shaped) journal surface/i.test(dbJournal?.scope || '')
    && dbJournal?.acceptedOnCheckedBoundary === true
    && dbJournal?.ownership?.ownsJournal === true
    && dbJournal?.ownership?.restartReadable === true
    && productionAdapter === 'wpdb-single-statement-cas'
    && dbJournal?.ownership?.supportedSurface === CHECKED_DB_JOURNAL_SUPPORTED_SURFACE
    && writerLeaseContractMatches(writerLease, claim)
    && writerLeaseContractMatches(nestedWriterLease, claim)
    && writerLeaseContractsAgree(writerLease, nestedWriterLease)
    && checkedBoundaryPersistedEvidenceMatches(dbJournal)
    && checkedBoundaryStorageGuardMatches(dbJournal, productionAdapter, writerLease, nestedWriterLease, leaseFenceBoundary)
    && leaseFenceBoundary === 'wpdb-single-statement-cas'
    && writerLease?.storageGuard === leaseFenceBoundary
    && nestedWriterLease?.storageGuard === leaseFenceBoundary
    && productionAdapter === leaseFenceBoundary
    && durableJournalClaimContractMatches(claim)
    && durableJournalClaimEvidenceContractMatches(claim, dbJournal?.claimEvidence)
    && dbJournal?.leaseFence?.claimKeyUnique === true
    && dbJournal?.leaseFence?.fsyncEvidence === true
    && dbJournal?.leaseFence?.monotonicSequence === true
    && dbJournal?.leaseFence?.restartReadable === true
    && dbJournal?.leaseFence?.staleClaimRejected === true;
}

export function checkedDurableJournalBoundaryContractIsPresent(dbJournal) {
  return checkedDurableJournalBoundarySatisfied(dbJournal);
}

export function productionRecoveryJournalInspectionSurfaceIsPresent(inspection) {
  const journal = inspection?.journal;
  const ownership = journal?.ownership;
  const claim = inspection?.claim;
  const journalClaim = journal?.claim;
  const writerLease = journal?.writerLease;
  const leaseFence = inspection?.leaseFence;
  const leaseFenceWriterLease = leaseFence?.writerLease;

  return journal?.kind === PRODUCTION_RECOVERY_JOURNAL_KIND
    && hasNonEmptyString(journal?.path)
    && journal.path === journal.journalPath
    && Array.isArray(journal?.checked)
    && journal.checked.length > 0
    && journal.checked.every(hasNonEmptyString)
    && journal.checked.includes(journal.journalPath)
    && artifactRefsContractMatches(journal?.artifactRefs)
    && journal?.productionAdapter === 'openProductionRecoveryJournal'
    && journal?.supportedSurface === PRODUCTION_RECOVERY_JOURNAL_SUPPORTED_SURFACE
    && productionRecoveryJournalOwnershipContractMatches(ownership)
    && journal?.ownsJournal === true
    && typeof journal?.consumed === 'boolean'
    && typeof journal?.staleClaimRejected === 'boolean'
    && journal?.restartReadable === true
    && journal?.schemaVersion === RECOVERY_JOURNAL_SCHEMA_VERSION
    && journal?.integrity?.status === 'ok'
    && isPositiveInteger(journal?.records)
    && productionRecoveryJournalClaimContractMatches(claim)
    && productionRecoveryJournalClaimsAgree(journalClaim, claim)
    && journal?.claimId === claim.activeClaimId
    && journal?.claimHash === claim.activeClaimHash
    && productionRecoveryJournalWriterLeaseContractMatches(writerLease, claim)
    && productionRecoveryJournalLeaseFenceContractMatches(leaseFence)
    && productionRecoveryJournalWriterLeaseContractMatches(leaseFenceWriterLease, claim)
    && productionRecoveryJournalWriterLeasesAgree(writerLease, leaseFenceWriterLease)
    && leaseFenceWriterLease?.storageGuard === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER
    && leaseFenceWriterLease?.restartReadable === journal.restartReadable
    && leaseFenceWriterLease?.staleClaimRejected === journal.staleClaimRejected
    && leaseFence?.restartReadable === journal.restartReadable
    && leaseFence?.staleClaimRejected === journal.staleClaimRejected;
}

function checkedBoundaryPersistedEvidenceMatches(dbJournal) {
  return hasNonEmptyString(dbJournal?.table)
    && isPositiveInteger(dbJournal?.rowCount)
    && Array.isArray(dbJournal?.latestRows)
    && dbJournal.latestRows.length > 0
    && checkedBoundaryLatestRowsEvidenceMatches(dbJournal.latestRows)
    && Array.isArray(dbJournal?.eventSummaries)
    && dbJournal.eventSummaries.length > 0
    && checkedBoundaryEventSummariesEvidenceMatches(dbJournal.eventSummaries)
    && checkedBoundaryIdempotencyEvidenceMatches(dbJournal)
    && checkedBoundaryStaleClaimEvidenceMatches(dbJournal);
}

function checkedBoundaryLatestRowsEvidenceMatches(latestRows) {
  return latestRows.some(
    (row) => hasNonEmptyString(row?.event)
      && isPositiveInteger(checkedBoundaryLatestRowSequence(row)),
  );
}

function checkedBoundaryLatestRowSequence(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const id = isPositiveInteger(row.id) ? row.id : null;
  const sequence = isPositiveInteger(row.sequence) ? row.sequence : null;
  if (id !== null && sequence !== null && id !== sequence) {
    return null;
  }

  return id ?? sequence ?? null;
}

function checkedBoundaryEventSummariesEvidenceMatches(eventSummaries) {
  return eventSummaries.some(
    (summary) => hasNonEmptyString(summary?.event)
      && isPositiveInteger(summary?.count)
      && isPositiveInteger(summary?.latestId),
  );
}

function checkedBoundaryIdempotencyEvidenceMatches(dbJournal) {
  const idempotencyEvidence = dbJournal?.idempotencyEvidence;
  const claimIdempotencyKeyHash = dbJournal?.claim?.idempotencyKeyHash;
  const activeClaimSequence = dbJournal?.claim?.activeClaimSequence;
  return Array.isArray(idempotencyEvidence)
    && idempotencyEvidence.length > 0
    && idempotencyEvidence.some(
      (summary) => hasNonEmptyString(summary?.idempotencyKeyHash)
        && isPositiveInteger(summary?.events)
        && isPositiveInteger(summary?.requestHashes)
        && isPositiveInteger(summary?.latestId)
        && (!hasNonEmptyString(claimIdempotencyKeyHash)
          || summary.idempotencyKeyHash === claimIdempotencyKeyHash)
        && (!isPositiveInteger(activeClaimSequence)
          || summary.latestId >= activeClaimSequence),
    );
}

function checkedBoundaryStaleClaimEvidenceMatches(dbJournal) {
  if (dbJournal?.claim?.staleClaimRejected !== true) {
    return true;
  }

  const staleClaimEvidenceFloor = checkedBoundaryStaleClaimEvidenceFloor(dbJournal?.claim);
  const staleClaimRows = Array.isArray(dbJournal?.latestRows)
    ? dbJournal.latestRows.filter((row) => {
      const rowSequence = checkedBoundaryLatestRowSequence(row);
      return checkedBoundaryStaleClaimEventMatches(row?.event)
        && isPositiveInteger(rowSequence)
        && rowSequence >= staleClaimEvidenceFloor;
    })
    : [];

  if (staleClaimRows.length > 0) {
    const hasRejectedRow = staleClaimRows.some(
      (row) => row?.event === 'stale-claim-rejected'
        && checkedBoundaryStaleClaimRowMatches(row, dbJournal?.claim),
    );
    if (!hasRejectedRow) {
      return false;
    }

    if (checkedBoundaryRequiresAbandonedLatestRow(dbJournal?.claim)) {
      return staleClaimRows.some(
        (row) => row?.event === 'stale-claim-abandoned'
          && checkedBoundaryStaleClaimRowMatches(row, dbJournal?.claim),
      );
    }

    return true;
  }

  return false;
}

function checkedBoundaryRequiresAbandonedLatestRow(claim) {
  return hasNonEmptyString(claim?.previousClaimId)
    || isPositiveInteger(claim?.abandonedSequence)
    || isPositiveInteger(claim?.previousStartedSequence)
    || isPositiveInteger(claim?.previousClaimSequence)
    || hasNonEmptyString(claim?.previousClaimKeyHash);
}

function checkedBoundaryStaleClaimRowMatches(row, claim) {
  if (!row || typeof row !== 'object') {
    return false;
  }

  if (row.event === 'stale-claim-rejected') {
    if (
      hasNonEmptyString(claim?.activeClaimId)
      && row.claimId !== claim.activeClaimId
    ) {
      return false;
    }

    if (
      isPositiveInteger(claim?.activeClaimSequence)
      && checkedBoundaryLatestRowSequence(row) !== claim.activeClaimSequence
    ) {
      return false;
    }

    if (
      hasNonEmptyString(claim?.activeClaimKeyHash)
      && !hasNonEmptyString(row.claimKeyHash)
    ) {
      return false;
    }

    if (
      hasNonEmptyString(claim?.activeClaimKeyHash)
      && row.claimKeyHash !== claim.activeClaimKeyHash
    ) {
      return false;
    }
  }

  if (row.event === 'stale-claim-abandoned') {
    if (
      hasNonEmptyString(claim?.previousClaimId)
      && row.claimId !== claim.previousClaimId
    ) {
      return false;
    }

    if (
      isPositiveInteger(claim?.abandonedSequence)
      && checkedBoundaryLatestRowSequence(row) !== claim.abandonedSequence
    ) {
      return false;
    }

    if (
      isPositiveInteger(claim?.previousStartedSequence)
      && cursorSequence(row?.resourceHashEvidence?.startedCursor) !== claim.previousStartedSequence
    ) {
      return false;
    }

    if (
      isPositiveInteger(claim?.previousClaimSequence)
      && cursorSequence(row?.resourceHashEvidence?.claimCursor) !== claim.previousClaimSequence
    ) {
      return false;
    }

    if (
      hasNonEmptyString(claim?.previousClaimKeyHash)
      && !hasNonEmptyString(row.claimKeyHash)
    ) {
      return false;
    }

    if (
      hasNonEmptyString(claim?.previousClaimKeyHash)
      && row.claimKeyHash !== claim.previousClaimKeyHash
    ) {
      return false;
    }
  }

  if (!claim || typeof claim !== 'object') {
    return true;
  }

  if (hasNonEmptyString(row.claimKeyHash)) {
    const claimKeyMatches = row.claimKeyHash === claim.activeClaimKeyHash
      || row.claimKeyHash === claim.previousClaimKeyHash;
    if (!claimKeyMatches) {
      return false;
    }
  }

  if (
    hasNonEmptyString(claim?.idempotencyKeyHash)
    && !hasNonEmptyString(row.idempotencyKeyHash)
  ) {
    return false;
  }

  if (
    hasNonEmptyString(claim?.idempotencyKeyHash)
    && row.idempotencyKeyHash !== claim.idempotencyKeyHash
  ) {
    return false;
  }

  if (
    hasNonEmptyString(claim?.requestHash)
    && !hasNonEmptyString(row.requestHash)
  ) {
    return false;
  }

  if (
    hasNonEmptyString(claim?.requestHash)
    && row.requestHash !== claim.requestHash
  ) {
    return false;
  }

  return true;
}

function checkedBoundaryStaleClaimEvidenceFloor(claim) {
  if (!claim || typeof claim !== 'object') {
    return 1;
  }

  let floor = 1;
  if (
    claim.activeClaimEvent === 'stale-claim-rejected'
    && isPositiveInteger(claim.activeClaimSequence)
  ) {
    floor = Math.max(floor, claim.activeClaimSequence);
  }

  for (const sequence of [
    claim.abandonedSequence,
    claim.previousStartedSequence,
    claim.previousClaimSequence,
  ]) {
    if (isPositiveInteger(sequence)) {
      floor = Math.max(floor, sequence);
    }
  }

  return floor;
}

function checkedBoundaryStaleClaimEventMatches(event) {
  return event === 'stale-claim-abandoned'
    || event === 'stale-claim-rejected';
}

function checkedBoundaryStorageGuardMatches(dbJournal, productionAdapter, writerLease, nestedWriterLease, leaseFenceBoundary) {
  const storageGuard = dbJournal?.storageGuard;
  return storageGuardContractMatches(storageGuard)
    && storageGuard.boundary === productionAdapter
    && storageGuard.boundary === writerLease?.storageGuard
    && storageGuard.boundary === leaseFenceBoundary
    && storageGuard.boundary === nestedWriterLease?.storageGuard
    && storageGuard.operation === 'update'
    && storageGuard.outcome === 'applied';
}

function productionRecoveryJournalOwnershipContractMatches(ownership) {
  return ownership?.ownsJournal === true
    && ownership?.restartReadable === true
    && ownership?.productionAdapter === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER
    && ownership?.supportedSurface === PRODUCTION_RECOVERY_JOURNAL_SUPPORTED_SURFACE;
}

function productionRecoveryJournalClaimContractMatches(claim) {
  if (!claim || typeof claim !== 'object') {
    return false;
  }

  const validStatus = claim.status === 'active' || claim.status === 'advanced';
  const validType = claim.type === 'recovery-claim-opened' || claim.type === 'stale-claim-advanced';
  const hasPreviousClaimIdentity = hasNonEmptyString(claim.previousClaimId)
    || CLAIM_HASH_PATTERN.test(claim.previousClaimHash || '');

  return validStatus
    && hasNonEmptyString(claim.activeClaimId)
    && CLAIM_HASH_PATTERN.test(claim.activeClaimHash || '')
    && isPositiveInteger(claim.sequence)
    && validType
    && (claim.status !== 'advanced' || claim.type === 'stale-claim-advanced')
    && (!hasPreviousClaimIdentity || (
      hasNonEmptyString(claim.previousClaimId)
      && CLAIM_HASH_PATTERN.test(claim.previousClaimHash || '')
    ));
}

function productionRecoveryJournalClaimsAgree(journalClaim, inspectionClaim) {
  if (!productionRecoveryJournalClaimContractMatches(journalClaim)) {
    return false;
  }

  for (const key of [
    'status',
    'activeClaimId',
    'activeClaimHash',
    'previousClaimId',
    'previousClaimHash',
    'sequence',
    'type',
    'staleThresholdMs',
    'previousClaimAgeMs',
    'reason',
  ]) {
    if (journalClaim?.[key] !== inspectionClaim?.[key]) {
      return false;
    }
  }

  return true;
}

function productionRecoveryJournalWriterLeaseContractMatches(writerLease, claim) {
  return typeof writerLease?.strategy === 'string'
    && writerLease.strategy.length > 0
    && writerLease?.claimKeyUnique === true
    && writerLease?.fsyncEvidence === true
    && writerLease?.monotonicSequence === true
    && writerLease?.restartReadable === true
    && typeof writerLease?.staleClaimRejected === 'boolean'
    && writerLease?.claimId === claim?.activeClaimId
    && writerLease?.claimHash === claim?.activeClaimHash
    && writerLease?.storageGuard === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER;
}

function productionRecoveryJournalWriterLeasesAgree(writerLease, nestedWriterLease) {
  return ['strategy', 'claimKeyUnique', 'fsyncEvidence', 'storageGuard', 'monotonicSequence', 'restartReadable', 'staleClaimRejected']
    .every((key) => writerLease?.[key] === nestedWriterLease?.[key])
    && writerLease?.claimId === nestedWriterLease?.claimId
    && writerLease?.claimHash === nestedWriterLease?.claimHash;
}

function productionRecoveryJournalLeaseFenceContractMatches(leaseFence) {
  return leaseFence?.boundary === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER
    && leaseFence?.storageGuard === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER
    && leaseFence?.claimKeyUnique === true
    && leaseFence?.fsyncEvidence === true
    && leaseFence?.monotonicSequence === true
    && typeof leaseFence?.restartReadable === 'boolean'
    && typeof leaseFence?.staleClaimRejected === 'boolean';
}

function storageGuardContractMatches(candidate) {
  return typeof candidate?.boundary === 'string'
    && candidate.boundary.length > 0
    && typeof candidate?.operation === 'string'
    && candidate.operation.length > 0
    && typeof candidate?.outcome === 'string'
    && candidate.outcome.length > 0;
}

function durableJournalClaimContractMatches(claim) {
  if (!claim || typeof claim !== 'object') {
    return false;
  }

  const statusMatchesStaleClaim = (
    (claim.status === 'active' && claim.staleClaimRejected === false)
    || (claim.status === 'stale-claim-rejected' && claim.staleClaimRejected === true)
  );
  const eventMatchesStaleClaim = hasNonEmptyString(claim.activeClaimEvent)
    && CHECKED_CLAIM_EVENT_TYPES.has(claim.activeClaimEvent)
    && !(claim.staleClaimRejected === false && claim.activeClaimEvent === 'stale-claim-rejected')
    && !(claim.staleClaimRejected === true && claim.activeClaimEvent === 'idempotency-opened');
  const requiresConsumedRetryLineage = claim.staleClaimRejected === true
    && (
      claim.activeClaimEvent === 'stale-claim-retry-started'
      || claim.activeClaimEvent === 'stale-claim-retry-in-progress'
      || claim.activeClaimEvent === 'stale-claim-rejected'
    );
  const hasPreviousClaimIdentity = hasNonEmptyString(claim.previousClaimKeyHash)
    || Number.isInteger(claim.previousClaimSequence)
    || hasNonEmptyString(claim.previousClaimEvent);
  const hasAbandonedClaimIdentity = Number.isInteger(claim.abandonedSequence)
    || hasNonEmptyString(claim.abandonedEvent);

  return hasNonEmptyString(claim.status)
    && hasNonEmptyString(claim.activeClaimId)
    && hasNonEmptyString(claim.activeClaimKeyHash)
    && isPositiveInteger(claim.activeClaimSequence)
    && hasNonEmptyString(claim.activeClaimEvent)
    && hasNonEmptyString(claim.idempotencyKeyHash)
    && hasNonEmptyString(claim.requestHash)
    && typeof claim.staleClaimRejected === 'boolean'
    && statusMatchesStaleClaim
    && eventMatchesStaleClaim
    && (!hasPreviousClaimIdentity || (
      hasNonEmptyString(claim.previousClaimId)
      && hasNonEmptyString(claim.previousClaimKeyHash)
      && isPositiveInteger(claim.previousClaimSequence)
      && hasNonEmptyString(claim.previousClaimEvent)
    ))
    && (!hasAbandonedClaimIdentity || (
      isPositiveInteger(claim.abandonedSequence)
      && hasNonEmptyString(claim.abandonedEvent)
    ))
    && (!isPositiveInteger(claim.previousStartedSequence) || hasPreviousClaimIdentity)
    && (claim.staleClaimRejected !== true || hasPreviousClaimIdentity)
    && (!requiresConsumedRetryLineage || (
      isPositiveInteger(claim.previousStartedSequence)
      && isPositiveInteger(claim.abandonedSequence)
      && hasNonEmptyString(claim.abandonedEvent)
      && hasNonEmptyString(claim.previousClaimKeyHash)
      && isPositiveInteger(claim.previousClaimSequence)
      && hasNonEmptyString(claim.previousClaimEvent)
    ));
}

function durableJournalClaimEvidenceContractMatches(claim, claimEvidence) {
  if (!claim || typeof claim !== 'object') {
    return false;
  }
  if (!claimEvidence || typeof claimEvidence !== 'object') {
    return false;
  }

  const activeRow = claimEvidence.activeRow;
  if (!durableJournalClaimEvidenceRowMatches(activeRow, {
    claimId: claim.activeClaimId,
    sequence: claim.activeClaimSequence,
    event: claim.activeClaimEvent,
    claimKeyHash: claim.activeClaimKeyHash,
    idempotencyKeyHash: claim.idempotencyKeyHash,
    requestHash: claim.requestHash,
  })) {
    return false;
  }

  const needsAbandonedRow = isPositiveInteger(claim.abandonedSequence)
    || hasNonEmptyString(claim.abandonedEvent)
    || isPositiveInteger(claim.previousStartedSequence)
    || isPositiveInteger(claim.previousClaimSequence);
  if (needsAbandonedRow) {
    if (!durableJournalClaimEvidenceRowMatches(claimEvidence.abandonedRow, {
      claimId: claim.previousClaimId,
      sequence: claim.abandonedSequence,
      event: claim.abandonedEvent,
      claimKeyHash: claim.previousClaimKeyHash,
      idempotencyKeyHash: claim.idempotencyKeyHash,
      requestHash: claim.requestHash,
    })) {
      return false;
    }
  }

  if (
    isPositiveInteger(claim.previousStartedSequence)
    && cursorSequence(claimEvidence?.abandonedRow?.startedCursor) !== claim.previousStartedSequence
  ) {
    return false;
  }

  const needsPreviousRow = isPositiveInteger(claim.previousClaimSequence)
    || hasNonEmptyString(claim.previousClaimKeyHash)
    || hasNonEmptyString(claim.previousClaimEvent);
  if (needsPreviousRow) {
    if (!durableJournalClaimEvidenceRowMatches(claimEvidence.previousRow, {
      claimId: claim.previousClaimId,
      sequence: claim.previousClaimSequence,
      event: claim.previousClaimEvent,
      claimKeyHash: claim.previousClaimKeyHash,
      idempotencyKeyHash: claim.idempotencyKeyHash,
      requestHash: claim.requestHash,
    })) {
      return false;
    }
  }

  if (
    isPositiveInteger(claim.previousClaimSequence)
    && cursorSequence(claimEvidence?.abandonedRow?.claimCursor) !== claim.previousClaimSequence
  ) {
    return false;
  }

  return true;
}

function durableJournalClaimEvidenceRowMatches(row, expected) {
  if (!row || typeof row !== 'object') {
    return false;
  }
  return (!hasNonEmptyString(expected.claimId) || row.claimId === expected.claimId)
    && (!isPositiveInteger(expected.sequence) || row.sequence === expected.sequence)
    && (!hasNonEmptyString(expected.event) || row.event === expected.event)
    && (!hasNonEmptyString(expected.claimKeyHash) || row.claimKeyHash === expected.claimKeyHash)
    && (!hasNonEmptyString(expected.idempotencyKeyHash) || row.idempotencyKeyHash === expected.idempotencyKeyHash)
    && (!hasNonEmptyString(expected.requestHash) || row.requestHash === expected.requestHash);
}

function cursorSequence(cursor) {
  if (typeof cursor !== 'string') {
    return null;
  }
  const match = /^db-journal:(\d+)$/.exec(cursor);
  if (!match) {
    return null;
  }
  const sequence = Number.parseInt(match[1], 10);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : null;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function writerLeaseContractMatches(candidate, claim) {
  return typeof candidate?.strategy === 'string'
    && candidate.strategy.length > 0
    && candidate?.claimId === claim?.activeClaimId
    && candidate?.claimKeyHash === claim?.activeClaimKeyHash
    && candidate?.claimKeyUnique === true
    && candidate?.fsyncEvidence === true
    && typeof candidate?.storageGuard === 'string'
    && candidate.storageGuard.length > 0
    && candidate?.monotonicSequence === true
    && candidate?.restartReadable === true
    && candidate?.staleClaimRejected === true;
}

function writerLeaseContractsAgree(writerLease, nestedWriterLease) {
  for (const key of [
    'strategy',
    'claimKeyUnique',
    'fsyncEvidence',
    'storageGuard',
    'monotonicSequence',
    'restartReadable',
    'staleClaimRejected',
  ]) {
    if (writerLease?.[key] !== nestedWriterLease?.[key]) {
      return false;
    }
  }

  return writerLease?.claimId === nestedWriterLease?.claimId
    && writerLease?.claimKeyHash === nestedWriterLease?.claimKeyHash;
}

function assertProductionRecoveryClaimId(claimId, operationName) {
  if (typeof claimId !== 'string' || claimId.length === 0) {
    throw new Error(
      `${operationName} requires a non-empty claimId for claim-fenced production recovery journals.`,
    );
  }
}

export function openProductionRecoveryJournal(options) {
  assertAllowedOptionKeys(
    options,
    new Set(['filePath', 'plan', 'current', 'artifactRefs', 'now', 'truncate', 'claimId']),
    'openProductionRecoveryJournal()',
  );
  const {
    filePath,
    plan,
    current,
    artifactRefs = {},
    now,
    truncate = true,
    claimId = null,
  } = options;
  assertProductionRecoveryClaimId(claimId, 'openProductionRecoveryJournal()');
  assertProductionRecoveryArtifactRefs(artifactRefs, 'openProductionRecoveryJournal()');
  const existingJournal = truncate ? null : readRecoveryJournal(filePath);
  const hasExistingPlanEnvelope = Boolean(existingJournal?.exists && existingJournal.records.length > 0);
  const journal = hasExistingPlanEnvelope
    ? openRecoveryJournal(filePath, { truncate, now })
    : openPlanRecoveryJournal({
        filePath,
        plan,
        current,
        artifactRefs,
        now,
        truncate,
      });

  const nextClaimHash = recoveryClaimHash(claimId);
  const existingClaim = hasExistingPlanEnvelope
    ? classifyRecoveryJournalClaims(existingJournal.records)
    : { status: 'none', activeClaimHash: null };
  const reusingActiveClaim =
    existingClaim.status !== 'blocked' && existingClaim.activeClaimHash === nextClaimHash;

  if (!reusingActiveClaim) {
    appendRecoveryClaimOpened(journal, {
      plan,
      current,
      claimId,
      artifactRefs,
      reason: 'Production recovery journal claim opened.',
    });
  }
  journal.claimId = claimId;
  journal.claimHash = nextClaimHash;
  journal.claimFenced = true;

  journal.kind = PRODUCTION_RECOVERY_JOURNAL_KIND;
  journal.productionAdapter = 'openProductionRecoveryJournal';
  journal.supportedSurface = PRODUCTION_RECOVERY_JOURNAL_SUPPORTED_SURFACE;
  journal.ownsJournal = true;
  journal.restartReadable = true;
  journal.journalPath = filePath;
  journal.claimId = claimId;
  journal.artifactRefs = { ...artifactRefs };
  journal.schemaVersion = RECOVERY_JOURNAL_SCHEMA_VERSION;
  journal.inspect = function inspectProductionRecoveryJournal() {
    const persisted = readRecoveryJournal(filePath);
    const claim = classifyRecoveryJournalClaims(persisted.records);
    const persistedClaimId = claim.activeClaimId || claimId;
    const claimHash = persistedClaimId ? recoveryClaimHash(persistedClaimId) : null;
    const restartReadable = persisted.integrity.status === 'ok';
    const staleClaimRejected = claimScopedStaleClaimRejectionEvidence(persisted.records, claim);
    const writerLease = {
      strategy: 'claim-fenced-single-writer',
      claimId: persistedClaimId,
      claimHash,
      claimKeyUnique: true,
      storageGuard: PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable,
      staleClaimRejected,
    };
    const ownership = {
      ownsJournal: true,
      restartReadable,
      productionAdapter: PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER,
      supportedSurface: PRODUCTION_RECOVERY_JOURNAL_SUPPORTED_SURFACE,
    };
    return {
      journal: {
        kind: PRODUCTION_RECOVERY_JOURNAL_KIND,
        path: filePath,
        journalPath: filePath,
        checked: [filePath],
        artifactRefs: { ...artifactRefs },
        productionAdapter: 'openProductionRecoveryJournal',
        supportedSurface: PRODUCTION_RECOVERY_JOURNAL_SUPPORTED_SURFACE,
        ownership,
        claim,
        claimId: persistedClaimId,
        ownsJournal: true,
        claimHash,
        consumed: persisted.records.some((record) => record.type === 'recovery-journal-consumed'),
        restartReadable,
        schemaVersion: persisted.records[0]?.schemaVersion ?? null,
        integrity: persisted.integrity,
        records: persisted.records.length,
        staleClaimRejected,
        writerLease,
      },
      leaseFence: {
        boundary: PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER,
        storageGuard: PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER,
        claimKeyUnique: true,
        fsyncEvidence: true,
        monotonicSequence: true,
        restartReadable,
        staleClaimRejected,
        writerLease,
      },
      claim,
    };
  };

  return journal;
}

export function consumeProductionRecoveryJournal(options) {
  assertAllowedOptionKeys(
    options,
    new Set(['filePath', 'plan', 'current', 'artifactRefs', 'claimId']),
    'consumeProductionRecoveryJournal()',
  );
  const {
    filePath,
    plan,
    current,
    artifactRefs = {},
    claimId = null,
  } = options;
  assertProductionRecoveryClaimId(claimId, 'consumeProductionRecoveryJournal()');
  assertProductionRecoveryArtifactRefs(artifactRefs, 'consumeProductionRecoveryJournal()');
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current,
    artifactRefs,
    truncate: false,
    claimId,
  });

  try {
    journal.appendEvent('recovery-journal-consumed', {
      planId: plan.id,
      state: 'consumed',
      observedHash: digest(current),
      artifactRefs,
    });
  } catch (error) {
    journal.close();
    throw error;
  }

  const inspection = journal.inspect();
  journal.close();
  return {
    ...inspection,
    consumed: true,
  };
}

export function openPlanRecoveryJournal({
  filePath,
  plan,
  current,
  artifactRefs = {},
  now,
  truncate = true,
  claimId = null,
}) {
  const journal = openRecoveryJournal(filePath, { truncate, now, claimId });
  journal.appendEvent('journal-opened', {
    planId: plan.id,
    state: 'opened',
    observedHash: digest(current),
    artifactRefs,
  });

  for (const mutation of plan.mutations) {
    journal.appendEvent('target-planned', plannedTargetPayload({ plan, mutation, current }));
  }

  return journal;
}

export function recoveryClaimHash(claimId) {
  if (typeof claimId !== 'string' || claimId.length === 0) {
    throw new Error('Recovery journal claim id must be a non-empty string.');
  }
  return digest({ recoveryJournalClaim: claimId });
}

export function appendRecoveryClaimOpened(journal, {
  plan,
  current,
  claimId,
  staleThresholdMs,
  artifactRefs = {},
  reason = 'Recovery claim opened.',
}) {
  const nextClaimHash = recoveryClaimHash(claimId);
  const persisted = readRecoveryJournal(journal.filePath);
  if (persisted.integrity.status !== 'ok') {
    throw new Error(`Refusing to append to invalid recovery journal: ${persisted.integrity.reason}`);
  }
  const claim = classifyRecoveryJournalClaims(persisted.records);
  if (claim.status !== 'none' && claim.activeClaimHash !== nextClaimHash) {
    journal.appendEvent('stale-claim-rejected', {
      planId: plan.id,
      state: 'rejected',
      claimHash: nextClaimHash,
      previousClaimHash: claim.activeClaimHash,
      observedHash: digest(current),
      staleThresholdMs: normalizeOptionalNonNegativeInteger(staleThresholdMs),
      reason,
      artifactRefs,
    });
    throw new RecoveryJournalClaimStaleError(
      'Recovery journal claim was superseded before this production claim could open.',
      {
        filePath: journal.filePath,
        eventType: 'recovery-claim-opened',
        staleClaimHash: nextClaimHash,
        activeClaimHash: claim.activeClaimHash,
        activeClaimSequence: claim.sequence,
        activeClaimType: claim.type,
        reason: claim.reason || null,
      },
    );
  }
  return journal.appendEvent('recovery-claim-opened', {
    planId: plan.id,
    state: 'active',
    claimId,
    claimHash: nextClaimHash,
    observedHash: digest(current),
    staleThresholdMs: normalizeOptionalNonNegativeInteger(staleThresholdMs),
    reason,
    artifactRefs,
  });
}

export function appendStaleClaimAdvanced(journal, {
  plan,
  current,
  previousClaimId,
  claimId,
  staleThresholdMs,
  previousClaimAgeMs,
  artifactRefs = {},
  reason = 'Previous recovery claim exceeded the stale threshold.',
}) {
  return journal.appendEvent('stale-claim-advanced', {
    planId: plan.id,
    state: 'advanced',
    previousClaimId,
    previousClaimHash: recoveryClaimHash(previousClaimId),
    claimId,
    claimHash: recoveryClaimHash(claimId),
    observedHash: digest(current),
    staleThresholdMs: normalizeOptionalNonNegativeInteger(staleThresholdMs),
    previousClaimAgeMs: normalizeOptionalNonNegativeInteger(previousClaimAgeMs),
    reason,
    artifactRefs,
  });
}

export function appendMutationObserved(journal, {
  plan,
  mutation,
  current,
  state,
  artifactRefs = {},
}) {
  return journal.appendEvent('mutation-observed', {
    planId: plan.id,
    mutationId: mutation.id,
    resourceKey: mutation.resourceKey,
    beforeHash: beforeHashForMutation(mutation, current),
    afterHash: afterHashForMutation(mutation),
    state,
    observedHash: resourceHash(current, mutation.resource),
    artifactRefs,
  });
}

export function appendJournalCompleted(journal, {
  plan,
  current,
  artifactRefs = {},
}) {
  return journal.appendEvent('journal-completed', {
    planId: plan.id,
    state: 'completed',
    observedHash: digest(current),
    artifactRefs,
  });
}

export function readRecoveryJournal(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return emptyRead(filePath, 'missing', 'Recovery journal file is missing.');
    }
    throw error;
  }

  if (text.length === 0) {
    return {
      filePath,
      exists: true,
      records: [],
      integrity: { status: 'ok', reason: null, errors: [] },
    };
  }

  const truncated = !text.endsWith('\n');
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  const records = [];
  const errors = [];

  for (const [index, line] of lines.entries()) {
    if (line.length === 0) {
      continue;
    }
    try {
      const record = JSON.parse(line);
      assertJournalRecordHasNoRawValues(record);
      records.push(record);
    } catch (error) {
      errors.push({
        line: index + 1,
        code: error.code || 'JOURNAL_RECORD_INVALID',
        message: error.message,
      });
    }
  }

  let expectedSequence = 1;
  for (const record of records) {
    if (!Number.isInteger(record.sequence) || record.sequence !== expectedSequence) {
      errors.push({
        line: null,
        code: 'JOURNAL_SEQUENCE_INVALID',
        message: `Expected journal sequence ${expectedSequence}.`,
      });
      break;
    }
    expectedSequence++;
  }

  for (const record of records) {
    if (record.schemaVersion !== RECOVERY_JOURNAL_SCHEMA_VERSION) {
      errors.push({
        line: null,
        code: 'JOURNAL_SCHEMA_UNSUPPORTED',
        message: `Unsupported recovery journal schema ${record.schemaVersion}.`,
      });
      break;
    }
  }

  if (truncated) {
    errors.push({
      line: lines.length,
      code: 'JOURNAL_TRUNCATED',
      message: 'Recovery journal does not end with a newline-delimited complete record.',
    });
  }

  return {
    filePath,
    exists: true,
    records,
    integrity: errors.length === 0
      ? { status: 'ok', reason: null, errors: [] }
      : { status: 'blocked', reason: 'Recovery journal is corrupt or truncated.', errors },
  };
}

export function assertJournalRecordHasNoRawValues(record) {
  visitRecord(record, []);
}

export function classifyRecoveryJournalClaims(records) {
  const claimRecords = (Array.isArray(records) ? records : [])
    .filter((record) => CLAIM_STATE_EVENT_TYPES.has(record.type));
  if (claimRecords.length === 0) {
    return {
      status: 'none',
      activeClaimHash: null,
      previousClaimHash: null,
      sequence: null,
      type: null,
    };
  }

  for (const record of claimRecords) {
    if (!CLAIM_HASH_PATTERN.test(record.claimHash || '')) {
      return blockedClaimState(record, 'Recovery claim record is missing a valid claim hash.');
    }
    if (
      record.type === 'stale-claim-advanced'
      && !CLAIM_HASH_PATTERN.test(record.previousClaimHash || '')
    ) {
      return blockedClaimState(record, 'Advanced stale-claim record is missing a valid previous claim hash.');
    }
  }

  const latest = claimRecords.at(-1);
  return {
    status: latest.type === 'stale-claim-advanced' ? 'advanced' : 'active',
    activeClaimId: latest.claimId || null,
    activeClaimHash: latest.claimHash,
    previousClaimId: latest.previousClaimId || null,
    previousClaimHash: latest.previousClaimHash || null,
    sequence: latest.sequence,
    type: latest.type,
    staleThresholdMs: latest.staleThresholdMs ?? null,
    previousClaimAgeMs: latest.previousClaimAgeMs ?? null,
    reason: latest.reason || null,
  };
}

class RecoveryJournalWriter {
  constructor(filePath, fd, nextSequence, options = {}) {
    this.filePath = filePath;
    this.fd = fd;
    this.nextSequence = nextSequence;
    this.now = options.now;
    this.claimId = options.claimId || null;
    this.claimHash = options.claimId ? recoveryClaimHash(options.claimId) : null;
    this.claimFenced = Boolean(this.claimHash);
    this.closed = false;
  }

  appendEvent(type, payload = {}) {
    if (this.closed) {
      throw new Error('Recovery journal is closed.');
    }
    this.assertCurrentClaim(type);

    const record = {
      schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      sequence: this.nextSequence,
      type,
      timestamp: timestampFor(this.now),
      ...payload,
      fsync: {
        requested: true,
        strategy: 'after-append',
      },
    };
    assertJournalRecordHasNoRawValues(record);

    fs.writeSync(this.fd, `${JSON.stringify(record)}\n`);
    fs.fsyncSync(this.fd);
    this.nextSequence++;
    return record;
  }

  assertCurrentClaim(eventType = 'journal-append') {
    if (!this.claimHash || CLAIM_APPEND_EVENT_TYPES.has(eventType)) {
      return;
    }

    const persisted = readRecoveryJournal(this.filePath);
    if (persisted.integrity.status !== 'ok') {
      throw new Error(`Refusing to append to invalid recovery journal: ${persisted.integrity.reason}`);
    }

    const claim = classifyRecoveryJournalClaims(persisted.records);
    if (claim.status === 'none') {
      throw new RecoveryJournalClaimStaleError(
        'Recovery journal has no active claim for this fenced writer.',
        {
          filePath: this.filePath,
          eventType,
          staleClaimHash: this.claimHash,
          activeClaimHash: null,
          activeClaimSequence: null,
          activeClaimType: null,
        },
      );
    }
    if (claim.status === 'blocked' || claim.activeClaimHash !== this.claimHash) {
      throw new RecoveryJournalClaimStaleError(
        'Recovery journal claim was superseded before this fenced writer could append.',
        {
          filePath: this.filePath,
          eventType,
          staleClaimHash: this.claimHash,
          activeClaimHash: claim.activeClaimHash,
          activeClaimSequence: claim.sequence,
          activeClaimType: claim.type,
          reason: claim.reason || null,
        },
      );
    }
  }

  close() {
    if (!this.closed) {
      fs.closeSync(this.fd);
      this.closed = true;
    }
  }
}

function blockedClaimState(record, reason) {
  return {
    status: 'blocked',
    activeClaimId: record.claimId || null,
    activeClaimHash: record.claimHash || null,
    previousClaimId: record.previousClaimId || null,
    previousClaimHash: record.previousClaimHash || null,
    sequence: record.sequence || null,
    type: record.type || null,
    reason,
  };
}

function plannedTargetPayload({ plan, mutation, current }) {
  return {
    planId: plan.id,
    mutationId: mutation.id,
    resourceKey: mutation.resourceKey,
    beforeHash: beforeHashForMutation(mutation, current),
    afterHash: afterHashForMutation(mutation),
    state: 'planned',
    artifactRefs: {},
  };
}

function beforeHashForMutation(mutation, current) {
  return mutation.remoteBeforeHash || resourceHash(current, mutation.resource);
}

function afterHashForMutation(mutation) {
  return mutation.localHash || digest(deserializeResourceValue(mutation.value));
}

function timestampFor(now) {
  if (now instanceof Date) {
    return now.toISOString();
  }
  if (typeof now === 'function') {
    const value = now();
    return value instanceof Date ? value.toISOString() : String(value);
  }
  return new Date().toISOString();
}

function normalizeOptionalNonNegativeInteger(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Recovery claim timing evidence must be a non-negative integer.');
  }
  return value;
}

function visitRecord(value, pathParts) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitRecord(item, [...pathParts, String(index)]));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (RAW_VALUE_KEYS.has(key)) {
      const error = new Error(`Recovery journal record contains raw-value field ${[...pathParts, key].join('.')}.`);
      error.code = 'JOURNAL_RAW_VALUE_FIELD';
      throw error;
    }
    visitRecord(child, [...pathParts, key]);
  }
}

function emptyRead(filePath, status, reason) {
  return {
    filePath,
    exists: false,
    records: [],
    integrity: {
      status,
      reason,
      errors: [{ line: null, code: 'JOURNAL_MISSING', message: reason }],
    },
  };
}
