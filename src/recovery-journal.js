import fs from 'node:fs';
import path from 'node:path';
import { assertEvidenceHasNoRawValues } from './evidence-redaction.js';
import { digest } from './stable-json.js';
import { deserializeResourceValue, resourceHash } from './resources.js';

export const RECOVERY_JOURNAL_SCHEMA_VERSION = 1;
const PRODUCTION_RECOVERY_JOURNAL_KIND = 'production-recovery-journal';
const PRODUCTION_RECOVERY_JOURNAL_SUPPORTED_SURFACE = 'claim-fenced-restart-readable';
const PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER = 'filesystem-compare-rename';
const PRODUCTION_RECOVERY_JOURNAL_OWNERSHIP_RECORD_TYPE = 'journal-ownership-recorded';
const checkedDbJournalSupportedSurface = 'claim-fenced-restart-readable';

const CLAIM_STATE_EVENT_TYPES = new Set([
  'recovery-claim-opened',
  'stale-claim-advanced',
]);
const CLAIM_APPEND_EVENT_TYPES = new Set([
  ...CLAIM_STATE_EVENT_TYPES,
  'stale-claim-rejected',
]);
const CLAIM_HASH_PATTERN = /^[a-f0-9]{64}$/;

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

function claimScopedConsumedRecord(records, claim) {
  if (
    !CLAIM_HASH_PATTERN.test(claim?.activeClaimHash || '')
    || typeof claim?.activeClaimId !== 'string'
    || claim.activeClaimId.length === 0
  ) {
    return null;
  }

  return (Array.isArray(records) ? records : []).find(
    (record) => record.type === 'recovery-journal-consumed'
      && record.claimHash === claim.activeClaimHash
      && record.claimId === claim.activeClaimId,
  ) || null;
}

function artifactRefsEqual(left, right) {
  const leftEntries = Object.entries(left ?? {}).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightEntries = Object.entries(right ?? {}).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return leftEntries.length === rightEntries.length
    && leftEntries.every(([leftKey, leftValue], index) => {
      const [rightKey, rightValue] = rightEntries[index] || [];
      return leftKey === rightKey && leftValue === rightValue;
    });
}

function claimScopedArtifactRefs(records, claim) {
  if (
    !CLAIM_HASH_PATTERN.test(claim?.activeClaimHash || '')
    || typeof claim?.activeClaimId !== 'string'
    || claim.activeClaimId.length === 0
  ) {
    return null;
  }

  const scopedRecord = (Array.isArray(records) ? [...records] : [])
    .reverse()
    .find(
      (record) => record.claimHash === claim.activeClaimHash
        && record.claimId === claim.activeClaimId
        && artifactRefsContractMatches(record.artifactRefs),
    );

  return scopedRecord ? { ...scopedRecord.artifactRefs } : null;
}

function claimScopedPlanId(records, claim) {
  if (
    !CLAIM_HASH_PATTERN.test(claim?.activeClaimHash || '')
    || typeof claim?.activeClaimId !== 'string'
    || claim.activeClaimId.length === 0
  ) {
    return null;
  }

  const scopedRecord = (Array.isArray(records) ? [...records] : [])
    .reverse()
    .find(
      (record) => CLAIM_STATE_EVENT_TYPES.has(record.type)
        && record.claimHash === claim.activeClaimHash
        && record.claimId === claim.activeClaimId
        && hasNonEmptyString(record.planId),
    );

  return scopedRecord?.planId || null;
}

function claimScopedOwnershipRecord(records, claim) {
  const ownershipRecords = (Array.isArray(records) ? [...records] : [])
    .reverse()
    .filter(productionRecoveryJournalOwnershipRecordContractMatches);

  if (
    CLAIM_HASH_PATTERN.test(claim?.activeClaimHash || '')
    && typeof claim?.activeClaimId === 'string'
    && claim.activeClaimId.length > 0
  ) {
    return ownershipRecords.find(
      (record) => record.claimHash === claim.activeClaimHash
        && record.claimId === claim.activeClaimId,
    ) || null;
  }

  return ownershipRecords.find(
    (record) => record.claimHash === null && record.claimId === null,
  ) || ownershipRecords[0] || null;
}

function persistedTargetEnvelopeMatchesPlan(records, plan) {
  const targets = (Array.isArray(records) ? records : [])
    .filter((record) => record.type === 'target-planned' && record.planId === plan?.id);
  const mutations = Array.isArray(plan?.mutations) ? plan.mutations : [];
  const targetByMutationId = new Map();
  const issues = [];

  for (const target of targets) {
    if (targetByMutationId.has(target.mutationId)) {
      issues.push({
        code: 'TARGET_PLANNED_DUPLICATE',
        mutationId: target.mutationId || null,
      });
      continue;
    }
    targetByMutationId.set(target.mutationId, target);
  }

  if (targetByMutationId.size !== mutations.length) {
    issues.push({
      code: 'TARGET_PLANNED_COUNT_MISMATCH',
      expected: mutations.length,
      actual: targetByMutationId.size,
    });
  }

  for (const mutation of mutations) {
    const target = targetByMutationId.get(mutation.id);
    if (!target) {
      issues.push({
        code: 'TARGET_PLANNED_MISSING',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
      });
      continue;
    }

    const expectedAfterHash = afterHashForMutation(mutation);
    if (target.resourceKey !== mutation.resourceKey) {
      issues.push({
        code: 'TARGET_PLANNED_RESOURCE_MISMATCH',
        mutationId: mutation.id,
        expected: mutation.resourceKey,
        actual: target.resourceKey,
      });
    }
    if (target.afterHash !== expectedAfterHash) {
      issues.push({
        code: 'TARGET_PLANNED_AFTER_HASH_MISMATCH',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
      });
    }
    if (hasNonEmptyString(mutation.remoteBeforeHash) && target.beforeHash !== mutation.remoteBeforeHash) {
      issues.push({
        code: 'TARGET_PLANNED_BEFORE_HASH_MISMATCH',
        mutationId: mutation.id,
        resourceKey: mutation.resourceKey,
      });
    }
  }

  return {
    matches: issues.length === 0,
    issues,
  };
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
  const trustedScope = /(packaged production plugin|checked live production-shaped)(?: recovery)? journal surface/i;
  const leaseFenceBoundary = dbJournal?.leaseFence?.boundary;
  const leaseFenceStorageGuard = dbJournal?.leaseFence?.storageGuard;
  const writerLease = dbJournal?.writerLease;
  const nestedWriterLease = dbJournal?.leaseFence?.writerLease;
  const productionAdapter = dbJournal?.ownership?.productionAdapter;
  const storageGuard = dbJournal?.storageGuard;
  const claim = dbJournal?.claim;

  return trustedScope.test(dbJournal?.scope || '')
    && durableJournalClaimContractMatches(claim)
    && dbJournal?.ownership?.ownsJournal === true
    && dbJournal?.ownership?.restartReadable === true
    && productionAdapter === 'wpdb-single-statement-cas'
    && dbJournal?.ownership?.supportedSurface === checkedDbJournalSupportedSurface
    && durableJournalWriterLeaseMatchesBoundary(writerLease, productionAdapter, claim)
    && durableJournalWriterLeaseMatchesBoundary(nestedWriterLease, productionAdapter, claim)
    && leaseFenceBoundary === 'wpdb-single-statement-cas'
    && leaseFenceStorageGuard === leaseFenceBoundary
    && writerLease?.storageGuard === leaseFenceBoundary
    && nestedWriterLease?.storageGuard === leaseFenceBoundary
    && productionAdapter === leaseFenceBoundary
    && dbJournal?.leaseFence?.fsyncEvidence === true
    && dbJournal?.leaseFence?.claimKeyUnique === true
    && dbJournal?.leaseFence?.monotonicSequence === true
    && dbJournal?.leaseFence?.restartReadable === true
    && dbJournal?.leaseFence?.staleClaimRejected === true
    && durableJournalStorageGuardMatchesBoundary(storageGuard, productionAdapter);
}

export function productionRecoveryJournalInspectionSurfaceIsPresent(inspection) {
  const journal = inspection?.journal;
  const ownership = journal?.ownership;
  const claim = inspection?.claim;
  const journalClaim = journal?.claim;
  const writerLease = journal?.writerLease;
  const leaseFence = inspection?.leaseFence;
  const leaseFenceWriterLease = leaseFence?.writerLease;
  const consumedIdentityMatches = journal?.consumed === true
    ? journal?.consumedClaimId === claim?.activeClaimId
      && journal?.consumedClaimHash === claim?.activeClaimHash
    : journal?.consumedClaimId == null && journal?.consumedClaimHash == null;

  return hasOwnProperties(journal, [
    'kind',
    'path',
    'journalPath',
    'checked',
    'artifactRefs',
    'productionAdapter',
    'supportedSurface',
    'ownership',
    'ownsJournal',
    'consumed',
    'staleClaimRejected',
    'restartReadable',
    'schemaVersion',
    'integrity',
    'records',
    'claim',
    'claimId',
    'claimHash',
    'consumedClaimId',
    'consumedClaimHash',
    'writerLease',
  ])
    && journal?.kind === PRODUCTION_RECOVERY_JOURNAL_KIND
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
    && recoveryJournalIntegrityContractMatches(journal?.integrity)
    && isPositiveInteger(journal?.records)
    && productionRecoveryJournalClaimContractMatches(claim)
    && productionRecoveryJournalClaimsAgree(journalClaim, claim)
    && journal?.claimId === claim.activeClaimId
    && journal?.claimHash === claim.activeClaimHash
    && consumedIdentityMatches
    && (!Object.hasOwn(journal, 'ownershipRecord')
      || journal.ownershipRecord === null
      || productionRecoveryJournalOwnershipSummaryContractMatches(journal.ownershipRecord, ownership, claim))
    && productionRecoveryJournalWriterLeaseContractMatches(writerLease, claim)
    && writerLease?.restartReadable === journal.restartReadable
    && writerLease?.staleClaimRejected === journal.staleClaimRejected
    && productionRecoveryJournalLeaseFenceContractMatches(leaseFence)
    && productionRecoveryJournalWriterLeaseContractMatches(leaseFenceWriterLease, claim)
    && productionRecoveryJournalWriterLeasesAgree(writerLease, leaseFenceWriterLease)
    && leaseFenceWriterLease?.storageGuard === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER
    && leaseFenceWriterLease?.restartReadable === journal.restartReadable
    && leaseFenceWriterLease?.staleClaimRejected === journal.staleClaimRejected
    && leaseFence?.restartReadable === journal.restartReadable
    && leaseFence?.staleClaimRejected === journal.staleClaimRejected;
}

function durableJournalWriterLeaseMatchesBoundary(writerLease, boundary, claim) {
  if (!writerLease || typeof writerLease !== 'object') {
    return false;
  }

  return writerLease.strategy === 'claim-fenced-single-writer'
    && (!hasNonEmptyString(claim?.activeClaimId) || writerLease.claimId === claim.activeClaimId)
    && (!hasNonEmptyString(claim?.activeClaimKeyHash) || writerLease.claimKeyHash === claim.activeClaimKeyHash)
    && writerLease.claimKeyUnique === true
    && writerLease.fsyncEvidence === true
    && writerLease.storageGuard === boundary
    && writerLease.monotonicSequence === true
    && writerLease.restartReadable === true
    && writerLease.staleClaimRejected === true;
}

function durableJournalClaimContractMatches(claim) {
  if (!hasOwnProperties(claim, [
    'status',
    'activeClaimId',
    'activeClaimKeyHash',
    'activeClaimSequence',
    'activeClaimEvent',
    'idempotencyKeyHash',
    'requestHash',
    'staleClaimRejected',
    'previousClaimId',
    'previousClaimKeyHash',
    'previousClaimSequence',
    'previousClaimEvent',
  ])) {
    return false;
  }

  const statusMatchesStaleClaim = (
    (claim.status === 'active' && claim.staleClaimRejected === false)
    || (claim.status === 'stale-claim-rejected' && claim.staleClaimRejected === true)
  );
  const eventMatchesStaleClaim = hasNonEmptyString(claim.activeClaimEvent)
    && checkedDurableJournalClaimEventMatches(claim.activeClaimEvent)
    && !(claim.staleClaimRejected === false && claim.activeClaimEvent === 'stale-claim-rejected')
    && !(claim.staleClaimRejected === true && claim.activeClaimEvent === 'idempotency-opened');
  const hasPreviousClaimIdentity = hasNonEmptyString(claim.previousClaimId)
    || hasNonEmptyString(claim.previousClaimKeyHash)
    || isPositiveInteger(claim.previousClaimSequence)
    || hasNonEmptyString(claim.previousClaimEvent);

  return hasNonEmptyString(claim.status)
    && hasNonEmptyString(claim.activeClaimId)
    && hasNonEmptyString(claim.activeClaimKeyHash)
    && isPositiveInteger(claim.activeClaimSequence)
    && hasNonEmptyString(claim.activeClaimEvent)
    && hasNonEmptyString(claim.idempotencyKeyHash)
    && hasNonEmptyString(claim.requestHash)
    && typeof claim.staleClaimRejected === 'boolean'
    && optionalClaimFieldIsOwnIfPresent(claim, 'previousStartedSequence')
    && optionalClaimFieldIsOwnIfPresent(claim, 'abandonedSequence')
    && optionalClaimFieldIsOwnIfPresent(claim, 'abandonedEvent')
    && statusMatchesStaleClaim
    && eventMatchesStaleClaim
    && (claim.staleClaimRejected !== true || hasPreviousClaimIdentity)
    && (!hasPreviousClaimIdentity || (
      hasNonEmptyString(claim.previousClaimId)
      && hasNonEmptyString(claim.previousClaimKeyHash)
      && isPositiveInteger(claim.previousClaimSequence)
      && hasNonEmptyString(claim.previousClaimEvent)
    ));
}

function optionalClaimFieldIsOwnIfPresent(claim, field) {
  return claim?.[field] === undefined
    || claim?.[field] === null
    || Object.hasOwn(claim, field);
}

function checkedDurableJournalClaimEventMatches(event) {
  return event === 'idempotency-opened'
    || event === 'stale-claim-retry-started'
    || event === 'stale-claim-retry-in-progress'
    || event === 'stale-claim-rejected';
}

function durableJournalStorageGuardMatchesBoundary(storageGuard, boundary) {
  if (storageGuard == null) {
    return true;
  }

  return storageGuard.boundary === boundary
    && storageGuard.operation === 'update'
    && storageGuard.outcome === 'applied';
}

function artifactRefsContractMatches(artifactRefs) {
  const entries = Object.entries(artifactRefs ?? {});
  return entries.length > 0
    && entries.every(([key, value]) => hasNonEmptyString(key) && hasNonEmptyString(value));
}

function productionRecoveryJournalOwnershipContractMatches(ownership) {
  return hasOwnProperties(ownership, [
    'ownsJournal',
    'restartReadable',
    'productionAdapter',
    'supportedSurface',
  ])
    && ownership?.ownsJournal === true
    && ownership?.restartReadable === true
    && ownership?.productionAdapter === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER
    && ownership?.supportedSurface === PRODUCTION_RECOVERY_JOURNAL_SUPPORTED_SURFACE;
}

function productionRecoveryJournalOwnershipRecordContractMatches(record) {
  return hasOwnProperties(record, [
    'sequence',
    'type',
    'state',
    'journalIdentityHash',
    'claimId',
    'claimHash',
    'ownership',
    'storageGuard',
    'fsync',
  ])
    && isPositiveInteger(record?.sequence)
    && record?.type === PRODUCTION_RECOVERY_JOURNAL_OWNERSHIP_RECORD_TYPE
    && record?.state === 'owned'
    && CLAIM_HASH_PATTERN.test(record?.journalIdentityHash || '')
    && (record?.claimId === null || hasNonEmptyString(record?.claimId))
    && (record?.claimHash === null || CLAIM_HASH_PATTERN.test(record?.claimHash || ''))
    && ((record?.claimId === null && record?.claimHash === null)
      || (hasNonEmptyString(record?.claimId) && CLAIM_HASH_PATTERN.test(record?.claimHash || '')))
    && productionRecoveryJournalOwnershipContractMatches(record?.ownership)
    && productionRecoveryJournalStorageGuardContractMatches(record?.storageGuard)
    && record?.fsync?.requested === true
    && record?.fsync?.strategy === 'after-append';
}

function productionRecoveryJournalOwnershipSummaryContractMatches(ownershipRecord, ownership, claim) {
  return hasOwnProperties(ownershipRecord, [
    'sequence',
    'type',
    'state',
    'journalIdentityHash',
    'claimId',
    'claimHash',
    'ownership',
    'storageGuard',
    'restartReadable',
    'fsync',
  ])
    && isPositiveInteger(ownershipRecord?.sequence)
    && ownershipRecord?.type === PRODUCTION_RECOVERY_JOURNAL_OWNERSHIP_RECORD_TYPE
    && ownershipRecord?.state === 'owned'
    && CLAIM_HASH_PATTERN.test(ownershipRecord?.journalIdentityHash || '')
    && ownershipRecord?.claimId === claim?.activeClaimId
    && ownershipRecord?.claimHash === claim?.activeClaimHash
    && productionRecoveryJournalOwnershipContractMatches(ownershipRecord?.ownership)
    && ownershipRecord?.ownership?.ownsJournal === ownership?.ownsJournal
    && ownershipRecord?.ownership?.restartReadable === ownership?.restartReadable
    && ownershipRecord?.ownership?.productionAdapter === ownership?.productionAdapter
    && ownershipRecord?.ownership?.supportedSurface === ownership?.supportedSurface
    && productionRecoveryJournalStorageGuardContractMatches(ownershipRecord?.storageGuard)
    && ownershipRecord?.restartReadable === true
    && ownershipRecord?.fsync?.requested === true
    && ownershipRecord?.fsync?.strategy === 'after-append';
}

function productionRecoveryJournalStorageGuardContractMatches(storageGuard) {
  return hasOwnProperties(storageGuard, [
    'boundary',
    'operation',
    'outcome',
  ])
    && storageGuard?.boundary === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER
    && storageGuard?.operation === 'append'
    && storageGuard?.outcome === 'ownership-recorded';
}

function productionRecoveryJournalClaimContractMatches(claim) {
  return hasOwnProperties(claim, [
    'status',
    'activeClaimId',
    'activeClaimHash',
    'previousClaimId',
    'previousClaimHash',
    'sequence',
    'type',
  ])
    && (claim?.status === 'active' || claim?.status === 'advanced')
    && hasNonEmptyString(claim?.activeClaimId)
    && CLAIM_HASH_PATTERN.test(claim?.activeClaimHash || '')
    && (claim?.previousClaimId === null || hasNonEmptyString(claim?.previousClaimId))
    && (claim?.previousClaimHash === null || CLAIM_HASH_PATTERN.test(claim?.previousClaimHash || ''))
    && isPositiveInteger(claim?.sequence)
    && CLAIM_STATE_EVENT_TYPES.has(claim?.type);
}

function productionRecoveryJournalClaimsAgree(journalClaim, inspectionClaim) {
  return productionRecoveryJournalClaimContractMatches(journalClaim)
    && productionRecoveryJournalClaimContractMatches(inspectionClaim)
    && journalClaim.activeClaimId === inspectionClaim.activeClaimId
    && journalClaim.activeClaimHash === inspectionClaim.activeClaimHash
    && journalClaim.previousClaimId === inspectionClaim.previousClaimId
    && journalClaim.previousClaimHash === inspectionClaim.previousClaimHash
    && journalClaim.sequence === inspectionClaim.sequence
    && journalClaim.type === inspectionClaim.type
    && journalClaim.status === inspectionClaim.status;
}

function productionRecoveryJournalWriterLeaseContractMatches(writerLease, claim) {
  return hasOwnProperties(writerLease, [
    'strategy',
    'claimId',
    'claimHash',
    'claimKeyUnique',
    'storageGuard',
    'fsyncEvidence',
    'monotonicSequence',
    'restartReadable',
    'staleClaimRejected',
  ])
    && writerLease?.strategy === 'claim-fenced-single-writer'
    && writerLease?.claimId === claim?.activeClaimId
    && writerLease?.claimHash === claim?.activeClaimHash
    && writerLease?.claimKeyUnique === true
    && writerLease?.storageGuard === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER
    && writerLease?.fsyncEvidence === true
    && writerLease?.monotonicSequence === true
    && writerLease?.restartReadable === true
    && typeof writerLease?.staleClaimRejected === 'boolean';
}

function productionRecoveryJournalWriterLeasesAgree(writerLease, nestedWriterLease) {
  return writerLease?.strategy === nestedWriterLease?.strategy
    && writerLease?.claimId === nestedWriterLease?.claimId
    && writerLease?.claimHash === nestedWriterLease?.claimHash
    && writerLease?.claimKeyUnique === nestedWriterLease?.claimKeyUnique
    && writerLease?.storageGuard === nestedWriterLease?.storageGuard
    && writerLease?.fsyncEvidence === nestedWriterLease?.fsyncEvidence
    && writerLease?.monotonicSequence === nestedWriterLease?.monotonicSequence
    && writerLease?.restartReadable === nestedWriterLease?.restartReadable
    && writerLease?.staleClaimRejected === nestedWriterLease?.staleClaimRejected;
}

function productionRecoveryJournalLeaseFenceContractMatches(leaseFence) {
  return hasOwnProperties(leaseFence, [
    'boundary',
    'storageGuard',
    'claimKeyUnique',
    'fsyncEvidence',
    'monotonicSequence',
    'restartReadable',
    'staleClaimRejected',
    'writerLease',
  ])
    && leaseFence?.boundary === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER
    && leaseFence?.storageGuard === PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER
    && leaseFence?.claimKeyUnique === true
    && leaseFence?.fsyncEvidence === true
    && leaseFence?.monotonicSequence === true
    && leaseFence?.restartReadable === true
    && typeof leaseFence?.staleClaimRejected === 'boolean';
}

function recoveryJournalIntegrityContractMatches(integrity) {
  return hasOwnProperties(integrity, ['status'])
    && integrity?.status === 'ok'
    && (!Object.hasOwn(integrity, 'reason')
      || integrity.reason === null
      || hasNonEmptyString(integrity.reason))
    && (!Object.hasOwn(integrity, 'errors') || Array.isArray(integrity.errors));
}

function appendProductionRecoveryJournalOwnershipRecord(journal, {
  filePath,
  plan,
  current,
  artifactRefs = {},
  claimId = null,
}) {
  const claimHash = claimId ? recoveryClaimHash(claimId) : null;
  return journal.appendEvent(PRODUCTION_RECOVERY_JOURNAL_OWNERSHIP_RECORD_TYPE, {
    planId: plan.id,
    state: 'owned',
    observedHash: digest(current),
    journalIdentityHash: digest({
      kind: PRODUCTION_RECOVERY_JOURNAL_KIND,
      storageAdapter: PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER,
      filePath,
    }),
    claimId,
    claimHash,
    artifactRefs,
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER,
      supportedSurface: PRODUCTION_RECOVERY_JOURNAL_SUPPORTED_SURFACE,
    },
    storageGuard: {
      boundary: PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER,
      operation: 'append',
      outcome: 'ownership-recorded',
    },
  });
}

function productionRecoveryJournalOwnershipFromRecord(ownershipRecord, persisted) {
  const restartReadable = persisted.integrity.status === 'ok';
  if (productionRecoveryJournalOwnershipRecordContractMatches(ownershipRecord)) {
    return {
      ...ownershipRecord.ownership,
      restartReadable: restartReadable && ownershipRecord.ownership.restartReadable === true,
    };
  }

  return {
    ownsJournal: true,
    restartReadable,
    productionAdapter: PRODUCTION_RECOVERY_JOURNAL_STORAGE_ADAPTER,
    supportedSurface: PRODUCTION_RECOVERY_JOURNAL_SUPPORTED_SURFACE,
  };
}

function productionRecoveryJournalOwnershipRecordSummary(ownershipRecord, persisted) {
  if (!productionRecoveryJournalOwnershipRecordContractMatches(ownershipRecord)) {
    return null;
  }

  return {
    sequence: ownershipRecord.sequence,
    type: ownershipRecord.type,
    state: ownershipRecord.state,
    journalIdentityHash: ownershipRecord.journalIdentityHash,
    claimId: ownershipRecord.claimId,
    claimHash: ownershipRecord.claimHash,
    ownership: {
      ...ownershipRecord.ownership,
      restartReadable: persisted.integrity.status === 'ok'
        && ownershipRecord.ownership.restartReadable === true,
    },
    storageGuard: { ...ownershipRecord.storageGuard },
    restartReadable: persisted.integrity.status === 'ok'
      && ownershipRecord.ownership.restartReadable === true,
    fsync: {
      requested: ownershipRecord.fsync.requested === true,
      strategy: ownershipRecord.fsync.strategy,
    },
  };
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

  const existingJournal = !truncate
    ? readRecoveryJournal(filePath)
    : { exists: false, records: [], integrity: { status: 'ok' } };
  if (!truncate && existingJournal.exists && existingJournal.integrity?.status !== 'ok') {
    throw new Error(`Refusing to append to invalid recovery journal: ${existingJournal.integrity.reason}`);
  }

  const nextClaimHash = claimId ? recoveryClaimHash(claimId) : null;
  const hasExistingPlanEnvelope = existingJournal.exists === true && existingJournal.records.length > 0;
  const existingClaim = hasExistingPlanEnvelope
    ? classifyRecoveryJournalClaims(existingJournal.records)
    : { status: 'none', activeClaimHash: null };
  const reusingActiveClaim = Boolean(
    claimId
      && hasExistingPlanEnvelope
      && existingClaim.status !== 'blocked'
      && existingClaim.activeClaimHash === nextClaimHash,
  );

  if (claimId && hasExistingPlanEnvelope && existingClaim.status === 'blocked') {
    throw new RecoveryJournalClaimStaleError(
      'Recovery journal claim state is blocked and cannot be reused.',
      {
        filePath,
        eventType: 'recovery-claim-opened',
        staleClaimId: claimId,
        staleClaimHash: nextClaimHash,
        activeClaimId: existingClaim.activeClaimId || null,
        activeClaimHash: existingClaim.activeClaimHash || null,
        activeClaimSequence: existingClaim.sequence || null,
        activeClaimType: existingClaim.type || null,
        reason: existingClaim.reason || null,
      },
    );
  }

  if (claimId && hasExistingPlanEnvelope && !reusingActiveClaim && existingClaim.status !== 'none') {
    const staleJournal = openRecoveryJournal(filePath, { truncate: false, now });
    try {
      appendRecoveryClaimOpened(staleJournal, {
        plan,
        current,
        claimId,
        artifactRefs,
        reason: 'Production recovery journal claim opened.',
      });
    } finally {
      staleJournal.close();
    }
  }

  let journal;
  if (reusingActiveClaim) {
    const persistedArtifactRefs = claimScopedArtifactRefs(existingJournal.records, existingClaim);
    const persistedPlanId = claimScopedPlanId(existingJournal.records, existingClaim);
    const targetEnvelope = persistedTargetEnvelopeMatchesPlan(existingJournal.records, plan);

    if (!artifactRefsEqual(persistedArtifactRefs, artifactRefs)) {
      throw new Error(
        'openProductionRecoveryJournal() requires artifactRefs to match the persisted active claim evidence when reopening a claim-fenced production recovery journal.',
      );
    }

    if (persistedPlanId !== plan.id) {
      throw new Error(
        'openProductionRecoveryJournal() requires plan.id to match the persisted active claim evidence when reopening a claim-fenced production recovery journal.',
      );
    }

    if (!targetEnvelope.matches) {
      const error = new Error(
        'openProductionRecoveryJournal() requires target-planned records to match the persisted active claim evidence when reopening a claim-fenced production recovery journal.',
      );
      error.code = 'RECOVERY_JOURNAL_TARGET_ENVELOPE_MISMATCH';
      error.details = { issues: targetEnvelope.issues };
      throw error;
    }

    journal = openRecoveryJournal(filePath, { truncate: false, now, claimId });
    journal.claimOpened = true;
    journal.appendEvent('journal-retry-opened', {
      planId: plan.id,
      state: 'retrying-active-claim',
      observedHash: digest(current),
      artifactRefs,
    });
    if (!claimScopedOwnershipRecord(existingJournal.records, existingClaim)) {
      appendProductionRecoveryJournalOwnershipRecord(journal, {
        filePath,
        plan,
        current,
        artifactRefs,
        claimId,
      });
    }
  } else {
    journal = openRecoveryJournal(filePath, { truncate, now });
    journal.appendEvent('journal-opened', {
      planId: plan.id,
      state: 'opened',
      observedHash: digest(current),
      artifactRefs,
    });
    appendProductionRecoveryJournalOwnershipRecord(journal, {
      filePath,
      plan,
      current,
      artifactRefs,
      claimId,
    });

    for (const mutation of plan.mutations) {
      journal.appendEvent('target-planned', plannedTargetPayload({ plan, mutation, current }));
    }

    if (claimId) {
      appendRecoveryClaimOpened(journal, {
        plan,
        current,
        claimId,
        artifactRefs,
        reason: 'Production recovery journal claim opened.',
      });
      journal.claimOpened = true;
    }
  }

  journal.productionAdapter = 'openProductionRecoveryJournal';
  journal.ownsJournal = true;
  journal.restartReadable = true;
  journal.claimId = claimId;
  journal.claimHash = claimId ? recoveryClaimHash(claimId) : null;
  journal.claimFenced = Boolean(journal.claimHash);
  journal.artifactRefs = { ...artifactRefs };
  journal.schemaVersion = RECOVERY_JOURNAL_SCHEMA_VERSION;
  journal.inspect = function inspectProductionRecoveryJournal() {
    const persisted = readRecoveryJournal(filePath);
    const claim = summarizeProductionRecoveryJournalClaim(persisted);
    const ownershipRecord = claimScopedOwnershipRecord(persisted.records, claim);
    const ownership = productionRecoveryJournalOwnershipFromRecord(ownershipRecord, persisted);
    const staleClaimRejected = claimScopedStaleClaimRejectionEvidence(persisted.records, claim);
    const writerLease = productionRecoveryJournalWriterLease(persisted, claim);
    const consumedRecord = claimScopedConsumedRecord(persisted.records, claim);
    const consumed = Boolean(consumedRecord);
    const consumedClaimId = consumed ? consumedRecord.claimId : null;
    const consumedClaimHash = consumed ? consumedRecord.claimHash : null;
    const leaseFence = {
      boundary: 'filesystem-compare-rename',
      storageGuard: 'filesystem-compare-rename',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: persisted.integrity.status === 'ok',
      restartReadable: persisted.integrity.status === 'ok',
      staleClaimRejected,
      writerLease,
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
        ownershipRecord: productionRecoveryJournalOwnershipRecordSummary(
          ownershipRecord,
          persisted,
        ),
        claimId,
        ownsJournal: true,
        claimHash: claimId ? recoveryClaimHash(claimId) : null,
        consumed,
        consumedClaimId,
        consumedClaimHash,
        restartReadable: persisted.integrity.status === 'ok',
        schemaVersion: persisted.records[0]?.schemaVersion ?? null,
        integrity: persisted.integrity,
        records: persisted.records.length,
        staleClaimRejected,
        claim,
        storageGuard: {
          boundary: 'filesystem-compare-rename',
          operation: 'update',
          outcome: 'applied',
        },
        writerLease,
        leaseFence,
      },
      claim,
      leaseFence,
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
      claimId,
      claimHash: nextClaimHash,
      previousClaimId: claim.activeClaimId || null,
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
        staleClaimId: claimId,
        staleClaimHash: nextClaimHash,
        activeClaimId: claim.activeClaimId || null,
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
  const incompleteTargets = (plan.mutations || [])
    .map((mutation) => ({
      mutationId: mutation.id,
      resourceKey: mutation.resourceKey,
      expectedHash: afterHashForMutation(mutation),
      observedHash: resourceHash(current, mutation.resource),
    }))
    .filter((target) => target.observedHash !== target.expectedHash);

  if (incompleteTargets.length > 0) {
    const error = new Error(
      'Refusing to mark recovery journal completed before every planned target matches its after hash.',
    );
    error.code = 'RECOVERY_JOURNAL_INCOMPLETE_APPLY';
    error.details = {
      planId: plan.id,
      incompleteTargets,
    };
    throw error;
  }

  return journal.appendEvent('journal-completed', {
    planId: plan.id,
    state: 'completed',
    observedHash: digest(current),
    artifactRefs,
  });
}

export function readRecoveryJournal(filePath) {
  return readRecoveryJournalFile(filePath);
}

export function migrateRecoveryJournalSchema(filePath, options = {}) {
  assertAllowedOptionKeys(
    options,
    new Set([]),
    'migrateRecoveryJournalSchema()',
  );
  const legacyRead = readRecoveryJournalFile(filePath, {
    allowMissingSchemaVersion: true,
  });

  if (!legacyRead.exists) {
    return {
      filePath,
      exists: false,
      schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      migrated: false,
      records: 0,
      migratedRecords: 0,
      preservedRows: true,
      restartReadable: false,
      recordSchemaVersions: [],
      integrity: legacyRead.integrity,
    };
  }

  if (legacyRead.integrity.status !== 'ok') {
    return {
      filePath,
      exists: true,
      schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      migrated: false,
      records: legacyRead.records.length,
      migratedRecords: 0,
      preservedRows: false,
      restartReadable: false,
      recordSchemaVersions: recordSchemaVersions(legacyRead.records),
      integrity: legacyRead.integrity,
    };
  }

  const migratedRecords = legacyRead.records.map((record) => (
    Object.hasOwn(record, 'schemaVersion')
      ? { ...record }
      : { schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION, ...record }
  ));
  const migratedCount = legacyRead.records.filter((record) => !Object.hasOwn(record, 'schemaVersion')).length;

  if (migratedCount > 0) {
    writeRecoveryJournalRecordsAtomically(filePath, migratedRecords);
  }

  const restarted = readRecoveryJournal(filePath);
  const preservedRows = recoveryJournalRowsMatchIgnoringSchemaVersion(
    legacyRead.records,
    restarted.records,
  );

  return {
    filePath,
    exists: true,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    migrated: migratedCount > 0,
    records: restarted.records.length,
    migratedRecords: migratedCount,
    preservedRows,
    restartReadable: restarted.integrity.status === 'ok',
    recordSchemaVersions: recordSchemaVersions(restarted.records),
    integrity: restarted.integrity,
  };
}

export function readSqliteRecoveryJournalTable(database, options = {}) {
  assertAllowedOptionKeys(
    options,
    new Set(['tableName', 'allowMissingSchemaVersion', 'allowMissingTableSchemaVersion']),
    'readSqliteRecoveryJournalTable()',
  );
  const tableName = normalizeSqliteIdentifier(options.tableName ?? 'recovery_journal', 'SQLite recovery journal table name');
  const table = sqliteRecoveryJournalTableSchema(database, tableName);

  if (!table.exists) {
    return {
      storage: 'sqlite',
      tableName,
      exists: false,
      records: [],
      rows: [],
      schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      tableSchemaVersion: null,
      tableSchemaVersions: [],
      recordSchemaVersions: [],
      schemaVersionColumnPresent: false,
      integrity: {
        status: 'missing',
        reason: `SQLite recovery journal table ${tableName} is missing.`,
        errors: [{
          line: null,
          code: 'JOURNAL_TABLE_MISSING',
          message: `SQLite recovery journal table ${tableName} is missing.`,
        }],
      },
    };
  }

  const allowMissingSchemaVersion = options.allowMissingSchemaVersion === true;
  const allowMissingTableSchemaVersion = options.allowMissingTableSchemaVersion === true;
  const missingColumns = ['sequence', 'record_json']
    .filter((column) => !table.columns.has(column));
  const schemaVersionColumnPresent = table.columns.has('schema_version');
  const errors = missingColumns.map((column) => ({
    line: null,
    code: 'JOURNAL_TABLE_SCHEMA_MISSING_COLUMN',
    message: `SQLite recovery journal table ${tableName} is missing required column ${column}.`,
  }));

  if (!schemaVersionColumnPresent && !allowMissingTableSchemaVersion) {
    errors.push({
      line: null,
      code: 'JOURNAL_TABLE_SCHEMA_VERSION_MISSING',
      message: `SQLite recovery journal table ${tableName} does not record schema_version.`,
    });
  }

  const rawRows = missingColumns.length === 0
    ? sqliteRecoveryJournalRows(database, tableName, { schemaVersionColumnPresent })
    : [];
  const records = [];
  const rows = [];

  for (const rawRow of rawRows) {
    const sequence = normalizeSqliteInteger(rawRow.sequence);
    const tableSchemaVersion = schemaVersionColumnPresent
      ? normalizeSqliteInteger(rawRow.schema_version)
      : null;
    const rowLine = Number.isInteger(sequence) ? sequence : null;

    if (!Number.isInteger(sequence)) {
      errors.push({
        line: rowLine,
        code: 'JOURNAL_TABLE_SEQUENCE_INVALID',
        message: 'SQLite recovery journal row sequence must be an integer.',
      });
    }
    if (schemaVersionColumnPresent) {
      if (tableSchemaVersion === RECOVERY_JOURNAL_SCHEMA_VERSION) {
        // Supported table row schema.
      } else if (allowMissingTableSchemaVersion && tableSchemaVersion === null) {
        // Legacy table row that will be migrated.
      } else {
        errors.push({
          line: rowLine,
          code: 'JOURNAL_TABLE_SCHEMA_UNSUPPORTED',
          message: `Unsupported SQLite recovery journal table schema ${rawRow.schema_version}.`,
        });
      }
    }
    if (typeof rawRow.record_json !== 'string') {
      errors.push({
        line: rowLine,
        code: 'JOURNAL_TABLE_RECORD_INVALID',
        message: 'SQLite recovery journal record_json must be a string.',
      });
      continue;
    }

    try {
      const record = JSON.parse(rawRow.record_json);
      assertJournalRecordHasNoRawValues(record);
      records.push(record);
      rows.push({
        sequence,
        tableSchemaVersion,
      });
      if (Number.isInteger(sequence) && Number.isInteger(record.sequence) && record.sequence !== sequence) {
        errors.push({
          line: rowLine,
          code: 'JOURNAL_TABLE_SEQUENCE_MISMATCH',
          message: `SQLite recovery journal row ${sequence} stores record sequence ${record.sequence}.`,
        });
      }
    } catch (error) {
      errors.push({
        line: rowLine,
        code: error.code || 'JOURNAL_TABLE_RECORD_INVALID',
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
    if (record.schemaVersion === RECOVERY_JOURNAL_SCHEMA_VERSION) {
      continue;
    }
    if (allowMissingSchemaVersion && !Object.hasOwn(record, 'schemaVersion')) {
      continue;
    }
    errors.push({
      line: null,
      code: 'JOURNAL_SCHEMA_UNSUPPORTED',
      message: `Unsupported recovery journal schema ${record.schemaVersion}.`,
    });
    break;
  }

  const tableSchemaVersions = recordTableSchemaVersions(rows);

  return {
    storage: 'sqlite',
    tableName,
    exists: true,
    records,
    rows,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    tableSchemaVersion: tableSchemaVersions.length === 1 ? tableSchemaVersions[0] : null,
    tableSchemaVersions,
    recordSchemaVersions: recordSchemaVersions(records),
    schemaVersionColumnPresent,
    integrity: errors.length === 0
      ? { status: 'ok', reason: null, errors: [] }
      : { status: 'blocked', reason: 'SQLite recovery journal table is corrupt or uses an unsupported schema.', errors },
  };
}

export function migrateSqliteRecoveryJournalTableSchema(database, options = {}) {
  assertAllowedOptionKeys(
    options,
    new Set(['tableName']),
    'migrateSqliteRecoveryJournalTableSchema()',
  );
  const tableName = normalizeSqliteIdentifier(options.tableName ?? 'recovery_journal', 'SQLite recovery journal table name');
  const legacyRead = readSqliteRecoveryJournalTable(database, {
    tableName,
    allowMissingSchemaVersion: true,
    allowMissingTableSchemaVersion: true,
  });

  if (!legacyRead.exists) {
    return {
      storage: 'sqlite',
      tableName,
      exists: false,
      schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      tableSchemaVersion: null,
      migrated: false,
      records: 0,
      migratedRecords: 0,
      updatedTableRows: 0,
      schemaVersionColumnAdded: false,
      preservedRows: true,
      restartReadable: false,
      recordSchemaVersions: [],
      tableSchemaVersions: [],
      integrity: legacyRead.integrity,
      journal: legacyRead,
    };
  }

  if (legacyRead.integrity.status !== 'ok') {
    return {
      storage: 'sqlite',
      tableName,
      exists: true,
      schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      tableSchemaVersion: legacyRead.tableSchemaVersion,
      migrated: false,
      records: legacyRead.records.length,
      migratedRecords: 0,
      updatedTableRows: 0,
      schemaVersionColumnAdded: false,
      preservedRows: false,
      restartReadable: false,
      recordSchemaVersions: legacyRead.recordSchemaVersions,
      tableSchemaVersions: legacyRead.tableSchemaVersions,
      integrity: legacyRead.integrity,
      journal: legacyRead,
    };
  }

  const quotedTableName = quoteSqliteIdentifier(tableName);
  const schemaVersionColumnAdded = legacyRead.schemaVersionColumnPresent !== true;
  const rowUpdates = legacyRead.records
    .map((record, index) => {
      const row = legacyRead.rows[index] || {};
      const recordMissingSchemaVersion = !Object.hasOwn(record, 'schemaVersion');
      const tableMissingSchemaVersion = row.tableSchemaVersion !== RECOVERY_JOURNAL_SCHEMA_VERSION;
      if (!recordMissingSchemaVersion && !tableMissingSchemaVersion) {
        return null;
      }
      return {
        sequence: record.sequence,
        record: recordMissingSchemaVersion
          ? { schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION, ...record }
          : { ...record },
      };
    })
    .filter(Boolean);

  if (schemaVersionColumnAdded || rowUpdates.length > 0) {
    let transactionStarted = false;
    try {
      sqliteExec(database, 'BEGIN IMMEDIATE');
      transactionStarted = true;
      if (schemaVersionColumnAdded) {
        sqliteExec(
          database,
          `ALTER TABLE ${quotedTableName} ADD COLUMN ${quoteSqliteIdentifier('schema_version')} INTEGER NOT NULL DEFAULT ${RECOVERY_JOURNAL_SCHEMA_VERSION}`,
        );
      }
      const update = sqlitePrepare(
        database,
        `UPDATE ${quotedTableName} SET ${quoteSqliteIdentifier('record_json')} = ?, ${quoteSqliteIdentifier('schema_version')} = ? WHERE ${quoteSqliteIdentifier('sequence')} = ?`,
      );
      for (const row of rowUpdates) {
        sqliteRunStatement(
          update,
          [
            JSON.stringify(row.record),
            RECOVERY_JOURNAL_SCHEMA_VERSION,
            row.sequence,
          ],
        );
      }
      sqliteExec(database, 'COMMIT');
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        try {
          sqliteExec(database, 'ROLLBACK');
        } catch {
          // Preserve the original migration failure.
        }
      }
      throw error;
    }
  }

  const restarted = readSqliteRecoveryJournalTable(database, { tableName });
  const preservedRows = recoveryJournalRowsMatchIgnoringSchemaVersion(
    legacyRead.records,
    restarted.records,
  );

  return {
    storage: 'sqlite',
    tableName,
    exists: true,
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    tableSchemaVersion: restarted.tableSchemaVersion,
    migrated: schemaVersionColumnAdded || rowUpdates.length > 0,
    records: restarted.records.length,
    migratedRecords: legacyRead.records.filter((record) => !Object.hasOwn(record, 'schemaVersion')).length,
    updatedTableRows: rowUpdates.length,
    schemaVersionColumnAdded,
    preservedRows,
    restartReadable: restarted.integrity.status === 'ok',
    recordSchemaVersions: restarted.recordSchemaVersions,
    tableSchemaVersions: restarted.tableSchemaVersions,
    integrity: restarted.integrity,
    journal: restarted,
  };
}

function readRecoveryJournalFile(filePath, options = {}) {
  const allowMissingSchemaVersion = options.allowMissingSchemaVersion === true;
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
    if (record.schemaVersion === RECOVERY_JOURNAL_SCHEMA_VERSION) {
      continue;
    }
    if (allowMissingSchemaVersion && !Object.hasOwn(record, 'schemaVersion')) {
      continue;
    }
    errors.push({
      line: null,
      code: 'JOURNAL_SCHEMA_UNSUPPORTED',
      message: `Unsupported recovery journal schema ${record.schemaVersion}.`,
    });
    break;
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

export function readRecoveryJournalPage(filePath, options = {}) {
  assertAllowedOptionKeys(
    options,
    new Set(['offset', 'limit']),
    'readRecoveryJournalPage()',
  );
  const persisted = readRecoveryJournal(filePath);
  const totalRecords = persisted.records.length;
  const offset = normalizeNonNegativeInteger(options.offset ?? 0, 'readRecoveryJournalPage() offset');
  const limit = normalizePositiveInteger(options.limit ?? Math.max(totalRecords, 1), 'readRecoveryJournalPage() limit');
  const records = persisted.records.slice(offset, offset + limit);
  const nextOffset = offset + records.length < totalRecords ? offset + records.length : null;

  return {
    ...persisted,
    records,
    page: {
      offset,
      limit,
      returned: records.length,
      totalRecords,
      nextOffset,
      hasMore: nextOffset !== null,
    },
  };
}

export function readRecoveryJournalPaged(filePath, options = {}) {
  assertAllowedOptionKeys(
    options,
    new Set(['pageSize']),
    'readRecoveryJournalPaged()',
  );
  const pageSize = normalizePositiveInteger(options.pageSize ?? 100, 'readRecoveryJournalPaged() pageSize');
  const records = [];
  const pages = [];
  let offset = 0;
  let latestPage = null;

  do {
    latestPage = readRecoveryJournalPage(filePath, { offset, limit: pageSize });
    records.push(...latestPage.records);
    pages.push(latestPage.page);
    offset = latestPage.page.nextOffset ?? offset;
  } while (latestPage.page.hasMore && latestPage.integrity.status === 'ok');

  return {
    ...latestPage,
    records,
    page: {
      mode: 'paged-readback',
      pageSize,
      pages: pages.length,
      totalRecords: latestPage?.page?.totalRecords ?? records.length,
      ranges: pages.map((page) => ({
        offset: page.offset,
        returned: page.returned,
        nextOffset: page.nextOffset,
      })),
    },
  };
}

export function assertJournalRecordHasNoRawValues(record) {
  assertEvidenceHasNoRawValues(record, {
    label: 'Recovery journal record',
    code: 'JOURNAL_RAW_VALUE_FIELD',
  });
}

export function classifyRecoveryJournalClaims(records) {
  const claimRecords = (Array.isArray(records) ? records : [])
    .filter((record) => CLAIM_STATE_EVENT_TYPES.has(record.type));
  if (claimRecords.length === 0) {
    return {
      status: 'none',
      activeClaimId: null,
      activeClaimHash: null,
      previousClaimId: null,
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

    const claimIdentity = this.claimFenced && !CLAIM_APPEND_EVENT_TYPES.has(type)
      ? { claimId: this.claimId, claimHash: this.claimHash }
      : {};
    const record = {
      schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      sequence: this.nextSequence,
      type,
      timestamp: timestampFor(this.now),
      ...claimIdentity,
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
          staleClaimId: this.claimId,
          staleClaimHash: this.claimHash,
          activeClaimId: null,
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
          staleClaimId: this.claimId,
          staleClaimHash: this.claimHash,
          activeClaimId: claim.activeClaimId || null,
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

function summarizeProductionRecoveryJournalClaim(persisted) {
  const claimState = classifyRecoveryJournalClaims(persisted.records);
  if (claimState.status === 'none' || claimState.status === 'blocked') {
    return undefined;
  }

  return {
    status: claimScopedStaleClaimRejectionEvidence(persisted.records, claimState)
      ? 'advanced'
      : 'active',
    activeClaimId: claimState.activeClaimId || null,
    activeClaimHash: claimState.activeClaimHash || null,
    previousClaimId: claimState.previousClaimId || null,
    previousClaimHash: claimState.previousClaimHash || null,
    sequence: claimState.sequence ?? null,
    type: claimState.type || null,
  };
}

function productionRecoveryJournalWriterLease(persisted, claimSummary) {
  return {
    strategy: 'claim-fenced-single-writer',
    claimId: claimSummary?.activeClaimId || null,
    claimHash: claimSummary?.activeClaimHash || null,
    claimKeyUnique: true,
    fsyncEvidence: true,
    storageGuard: 'filesystem-compare-rename',
    monotonicSequence: persisted.integrity.status === 'ok',
    restartReadable: persisted.integrity.status === 'ok',
    staleClaimRejected: hasStaleClaimRejectionEvidence(persisted.records),
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

function writeRecoveryJournalRecordsAtomically(filePath, records) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.schema-migration-${process.pid}-${Date.now()}.tmp`,
  );
  let fd;
  let renamed = false;

  try {
    fd = fs.openSync(tempPath, 'wx');
    const text = records.length > 0
      ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
      : '';
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    fs.renameSync(tempPath, filePath);
    renamed = true;
    fsyncDirectory(dir);
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
    if (!renamed) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // Best-effort cleanup only.
      }
    }
  }
}

function fsyncDirectory(dir) {
  let dirFd;
  try {
    dirFd = fs.openSync(dir, 'r');
    fs.fsyncSync(dirFd);
  } catch {
    // Some platforms/filesystems do not allow fsync() on directories; the
    // journal rows were already fsynced before rename.
  } finally {
    if (dirFd !== undefined) {
      fs.closeSync(dirFd);
    }
  }
}

function recoveryJournalRowsMatchIgnoringSchemaVersion(leftRows, rightRows) {
  if (!Array.isArray(leftRows) || !Array.isArray(rightRows) || leftRows.length !== rightRows.length) {
    return false;
  }

  return leftRows.every((leftRow, index) => (
    JSON.stringify(recoveryJournalRowWithoutSchemaVersion(leftRow))
      === JSON.stringify(recoveryJournalRowWithoutSchemaVersion(rightRows[index]))
  ));
}

function recoveryJournalRowWithoutSchemaVersion(record) {
  const { schemaVersion, ...rest } = record;
  return rest;
}

function recordSchemaVersions(records) {
  return [...new Set(
    (Array.isArray(records) ? records : [])
      .map((record) => record.schemaVersion)
      .filter((schemaVersion) => schemaVersion !== undefined),
  )].sort((left, right) => left - right);
}

function recordTableSchemaVersions(rows) {
  return [...new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => row.tableSchemaVersion)
      .filter((schemaVersion) => schemaVersion !== undefined && schemaVersion !== null),
  )].sort((left, right) => left - right);
}

function sqliteRecoveryJournalTableSchema(database, tableName) {
  const exists = Boolean(sqliteGet(
    database,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  ));
  if (!exists) {
    return { exists: false, columns: new Set() };
  }

  return {
    exists: true,
    columns: new Set(
      sqliteAll(database, `PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`)
        .map((column) => column.name),
    ),
  };
}

function sqliteRecoveryJournalRows(database, tableName, { schemaVersionColumnPresent }) {
  const selectedColumns = [
    quoteSqliteIdentifier('sequence'),
    quoteSqliteIdentifier('record_json'),
    ...(schemaVersionColumnPresent ? [quoteSqliteIdentifier('schema_version')] : []),
  ];
  return sqliteAll(
    database,
    `SELECT ${selectedColumns.join(', ')} FROM ${quoteSqliteIdentifier(tableName)} ORDER BY ${quoteSqliteIdentifier('sequence')} ASC`,
  );
}

function sqlitePrepare(database, sql) {
  if (!database || typeof database.prepare !== 'function') {
    throw new Error('SQLite recovery journal migration requires a database object with prepare(sql).');
  }
  return database.prepare(sql);
}

function sqliteAll(database, sql, params = []) {
  const statement = sqlitePrepare(database, sql);
  if (!statement || typeof statement.all !== 'function') {
    throw new Error('SQLite recovery journal migration requires prepared statements with all(...params).');
  }
  return statement.all(...params);
}

function sqliteGet(database, sql, params = []) {
  const statement = sqlitePrepare(database, sql);
  if (!statement || typeof statement.get !== 'function') {
    throw new Error('SQLite recovery journal migration requires prepared statements with get(...params).');
  }
  return statement.get(...params);
}

function sqliteRunStatement(statement, params = []) {
  if (!statement || typeof statement.run !== 'function') {
    throw new Error('SQLite recovery journal migration requires prepared statements with run(...params).');
  }
  return statement.run(...params);
}

function sqliteExec(database, sql) {
  if (!database || typeof database.exec !== 'function') {
    throw new Error('SQLite recovery journal migration requires a database object with exec(sql).');
  }
  return database.exec(sql);
}

function normalizeSqliteIdentifier(identifier, label) {
  if (typeof identifier !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`${label} must contain only ASCII letters, numbers, and underscores, and must not start with a number.`);
  }
  return identifier;
}

function quoteSqliteIdentifier(identifier) {
  return `"${normalizeSqliteIdentifier(identifier, 'SQLite identifier')}"`;
}

function normalizeSqliteInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value;
  }
  const asNumber = Number(value);
  return Number.isInteger(asNumber) ? asNumber : value;
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

function normalizeNonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function normalizePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function hasOwnProperties(candidate, keys) {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }

  return keys.every((key) => Object.hasOwn(candidate, key));
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
