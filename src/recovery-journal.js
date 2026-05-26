import fs from 'node:fs';
import path from 'node:path';
import { digest } from './stable-json.js';
import { deserializeResourceValue, resourceHash } from './resources.js';

export const RECOVERY_JOURNAL_SCHEMA_VERSION = 1;

const CLAIM_EVENT_TYPES = new Set([
  'recovery-claim-opened',
  'stale-claim-advanced',
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

export class UnsupportedProductionRecoveryJournalError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'UnsupportedProductionRecoveryJournalError';
    this.code = 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL';
    this.details = details;
  }
}

export function createUnsupportedProductionRecoveryJournal(reason = 'Production recovery journal support is not available in this worktree.') {
  const details = {
    reason,
    kind: 'production-recovery-journal',
    productionAdapter: true,
    ownsJournal: false,
    ownsRemoteArtifact: false,
    restartReadable: false,
    leaseFence: null,
    writerLease: null,
    journalPath: null,
    artifactRefs: Object.freeze({
      journal: null,
      remote: null,
    }),
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
  };
  const missingDependency = Object.freeze([
    'production recovery journal adapter marker',
    'explicit production recovery adapter marker',
    'restart-readable recovery journal adapter',
    'explicit journal ownership fencing',
    'stable-storage flush or fsync semantics',
    'durable writer cleanup',
    'restart-readable recovery inspection',
    'restart-readable recovery artifact references',
    'restart-readable remote recovery artifact ownership',
    'owned restart-readable recovery journal path',
    'restart-readable recovery journal schema',
    'fencing or lease ownership for the journal writer',
    'journal-readable inspection records with sequence and type',
  ]);

  const throwUnsupported = (method) => {
    throw new UnsupportedProductionRecoveryJournalError(reason, {
      ...details,
      method,
    });
  };

  return Object.freeze({
    ...details,
    supportedSurface: 'production-recovery-journal-adapter',
    missingDependency,
    appendEvent() {
      return throwUnsupported('appendEvent');
    },
    inspect() {
      return throwUnsupported('inspect');
    },
    assertCurrentClaim() {
      return throwUnsupported('assertCurrentClaim');
    },
    flush() {
      return throwUnsupported('flush');
    },
    close() {
      return throwUnsupported('close');
    },
  });
}

export function openProductionRecoveryJournal(filePathOrOptions, options = {}) {
  const normalized = normalizeProductionRecoveryJournalOptions(filePathOrOptions, options);
  const { filePath } = normalized;
  const claimId = normalized.claimId || normalized.claim?.id || null;
  const claimHash = claimId ? recoveryClaimHash(claimId) : null;
  const writerLease = Object.hasOwn(normalized, 'writerLease')
    ? freezeProductionWriterLease(normalized.writerLease)
    : null;
  const ownsRemoteArtifact = Object.hasOwn(normalized, 'ownsRemoteArtifact')
    ? normalized.ownsRemoteArtifact === true
    : false;
  const remoteArtifactPath = Object.hasOwn(normalized, 'remoteArtifactPath')
    ? normalized.remoteArtifactPath
    : null;
  if (!claimId) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires an explicit claimId.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (!isCanonicalAbsolutePath(filePath)) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires a canonical absolute journal path.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (ownsRemoteArtifact && remoteArtifactPath === null) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires an explicit remote artifact path when remote ownership is claimed.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (remoteArtifactPath !== null && !ownsRemoteArtifact) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires owned remote artifact references.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (remoteArtifactPath !== null && !isCanonicalAbsolutePath(remoteArtifactPath)) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires a canonical remote artifact path.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (remoteArtifactPath !== null && remoteArtifactPath === filePath) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires a distinct owned remote artifact path.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (!isValidProductionWriterLease(writerLease)) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires an explicit fenced writer lease.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  assertProductionClaimIdentityMatchesWriterLease({
    claimId,
    writerLease,
    filePath,
    ownsRemoteArtifact,
    remoteArtifactPath,
  });

  const persistedArtifactRefs = persistedProductionArtifactRefs(filePath);
  if (persistedArtifactRefs.invalidReason) {
    throw new UnsupportedProductionRecoveryJournalError(
      persistedArtifactRefs.invalidReason,
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        persistedArtifactRefs: Object.freeze({
          journal: persistedArtifactRefs.journal,
          remote: persistedArtifactRefs.remote,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (
    remoteArtifactPath !== null
    && persistedArtifactRefs.remote === null
    && persistedArtifactRefs.hasRecords === true
  ) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires reopening with the persisted remote artifact ownership state.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        persistedArtifactRefs: Object.freeze({
          journal: persistedArtifactRefs.journal,
          remote: persistedArtifactRefs.remote,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (
    persistedArtifactRefs.remote !== null
    && remoteArtifactPath !== persistedArtifactRefs.remote
  ) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires reopening with the persisted owned remote artifact path.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        persistedArtifactRefs: Object.freeze({
          journal: persistedArtifactRefs.journal,
          remote: persistedArtifactRefs.remote,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }

  const journal = openRecoveryJournal(filePath, {
    truncate: normalized.truncate,
    now: normalized.now,
    claimId,
  });
  const leaseFence = freezeProductionWriterLease(writerLease);
  const assertProductionWriterLeaseCurrent = (eventType) => {
    if (
      !CLAIM_EVENT_TYPES.has(eventType)
      && writerLease
      && Object.hasOwn(writerLease, 'epoch')
    ) {
      const persisted = readRecoveryJournal(journal.filePath);
      if (persisted.integrity.status !== 'ok') {
        throw new Error(`Refusing to append to invalid recovery journal: ${persisted.integrity.reason}`);
      }
      const claim = classifyRecoveryJournalClaims(persisted.records);
      if (!productionLeaseIdentitiesMatch(claim.activeClaimLease, writerLease)) {
        throw new RecoveryJournalClaimStaleError(
          'Recovery journal lease fence was superseded before this fenced writer could append.',
          {
            filePath: journal.filePath,
            eventType,
            staleClaimHash: claimHash,
            activeClaimHash: claim.activeClaimHash,
            activeClaimLease: claim.activeClaimLease,
            writerLease,
            activeClaimSequence: claim.sequence,
            activeClaimType: claim.type,
            reason: claim.reason || null,
          },
        );
      }
    }
  };

  return Object.freeze({
    kind: 'production-recovery-journal',
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact,
    leaseFence,
    writerLease,
    claimHash,
    journalPath: journal.filePath,
    artifactRefs: Object.freeze({
      journal: journal.filePath,
      remote: remoteArtifactPath,
    }),
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    appendEvent(type, payload) {
      assertProductionWriterLeaseCurrent(type);
      return journal.appendEvent(type, payload);
    },
    inspect() {
      const artifactRefs = {
        journal: journal.filePath,
        remote: remoteArtifactPath,
      };
      return {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        leaseFence,
        writerLease,
        claimHash,
        journalPath: journal.filePath,
        ...readRecoveryJournal(journal.filePath),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs,
      };
    },
    assertCurrentClaim(eventType) {
      assertProductionWriterLeaseCurrent(eventType);
      return journal.assertCurrentClaim(eventType);
    },
    flush() {
      return journal.flush?.() || undefined;
    },
    close() {
      journal.close();
    },
  });
}

export function consumeProductionRecoveryJournal(options) {
  const normalized = normalizeProductionRecoveryJournalOptions(options);
  const {
    filePath,
    plan,
    current,
    claimId = null,
  } = normalized;
  const writerLease = Object.hasOwn(normalized, 'writerLease')
    ? freezeProductionWriterLease(normalized.writerLease)
    : null;
  const leaseFence = freezeProductionWriterLease(writerLease);
  const artifactRefs = normalizeProductionArtifactRefs(
    normalized.artifactRefs,
    filePath,
    normalized.remoteArtifactPath ?? null,
  );
  const journal = openProductionRecoveryJournal({
    ...normalized,
    truncate: false,
    claimId,
  });

  try {
    journal.appendEvent('recovery-journal-consumed', {
      planId: plan?.id || null,
      state: 'consumed',
      observedHash: current ? digest(current) : null,
      artifactRefs,
    });
  } catch (error) {
    journal.close();
    throw error;
  }

  const inspection = journal.inspect();
  journal.close();

  const records = Array.isArray(inspection.records) ? inspection.records : [];
  const staleClaimRejected = records.some((record) => record.type === 'stale-claim-advanced');
  const consumed = records.some((record) => record.type === 'recovery-journal-consumed');
  const monotonicSequence = records.every((record, index) => record?.sequence === index + 1);

  return {
    journal: {
      kind: 'production-recovery-journal',
      path: filePath,
      journalPath: filePath,
      checked: [filePath],
      artifactRefs,
      productionAdapter: 'openProductionRecoveryJournal',
      supportedSurface: 'production-recovery-journal-adapter',
      claimId,
      ownsJournal: true,
      ownsRemoteArtifact: normalized.ownsRemoteArtifact === true,
      claimHash: claimId ? recoveryClaimHash(claimId) : null,
      consumed,
      restartReadable: inspection.integrity?.status === 'ok',
      writerLease,
      leaseFence,
      schemaVersion: inspection.schemaVersion ?? null,
      integrity: inspection.integrity,
      records: records.length,
      staleClaimRejected,
    },
    leaseFence: {
      storageGuard: 'filesystem-compare-rename',
      fsyncEvidence: records.every((record) => record?.fsync?.requested === true),
      monotonicSequence,
      staleClaimRejected,
    },
    consumed,
  };
}

export function describeProductionRecoveryJournal(writer) {
  if (
    !writer
    || !Object.hasOwn(writer, 'kind')
    || writer.kind !== 'production-recovery-journal'
  ) {
    return null;
  }

  const productionAdapter = Object.hasOwn(writer, 'productionAdapter') && writer.productionAdapter === true;
  const supportedSurface = Object.hasOwn(writer, 'supportedSurface')
    && writer.supportedSurface === 'production-recovery-journal-adapter'
    ? writer.supportedSurface
    : null;
  const restartReadable = Object.hasOwn(writer, 'restartReadable') && writer.restartReadable === true;
  const ownsJournal = Object.hasOwn(writer, 'ownsJournal') && writer.ownsJournal === true;
  const claimsRemoteArtifactOwnership = Object.hasOwn(writer, 'ownsRemoteArtifact') && writer.ownsRemoteArtifact === true;
  const journalPath = Object.hasOwn(writer, 'journalPath') && isCanonicalAbsolutePath(writer.journalPath)
    ? writer.journalPath
    : null;
  const writerLease = Object.hasOwn(writer, 'writerLease') && isValidProductionWriterLease(writer.writerLease)
    ? Object.freeze({ ...writer.writerLease })
    : null;
  const rawLeaseFence = Object.hasOwn(writer, 'leaseFence') && isValidProductionWriterLease(writer.leaseFence)
    ? writer.leaseFence
    : null;
  const leaseFence = rawLeaseFence && writerLease && productionLeaseIdentitiesMatch(rawLeaseFence, writerLease)
    ? Object.freeze({ ...rawLeaseFence })
    : null;
  const rawArtifactRefs = Object.hasOwn(writer, 'artifactRefs') && isStrictPlainObject(writer.artifactRefs)
    ? writer.artifactRefs
    : null;
  const artifactRefs = Object.freeze({
    journal: rawArtifactRefs
      && journalPath
      && Object.hasOwn(rawArtifactRefs, 'journal')
      && isCanonicalAbsolutePath(rawArtifactRefs.journal)
      && rawArtifactRefs.journal === journalPath
      ? rawArtifactRefs.journal
      : null,
    remote: rawArtifactRefs
      && claimsRemoteArtifactOwnership
      && Object.hasOwn(rawArtifactRefs, 'remote')
      && isCanonicalAbsolutePath(rawArtifactRefs.remote)
      && rawArtifactRefs.remote !== journalPath
      && rawArtifactRefs.remote !== rawArtifactRefs.journal
      ? rawArtifactRefs.remote
      : null,
  });
  const ownsRemoteArtifact = claimsRemoteArtifactOwnership && artifactRefs.remote !== null;

  return Object.freeze({
    kind: writer.kind,
    productionAdapter,
    supportedSurface,
    restartReadable,
    ownsJournal,
    ownsRemoteArtifact,
    leaseFence,
    writerLease,
    journalPath,
    artifactRefs,
    schemaVersion: Object.hasOwn(writer, 'schemaVersion') ? writer.schemaVersion : null,
  });
}

function isValidProductionWriterLease(writerLease) {
  const ownKeys = Reflect.ownKeys(writerLease ?? {});
  return (
    isStrictPlainObject(writerLease)
    && !hasHiddenOwnStringKeys(writerLease)
    && ownKeys.every((key) => key === 'id' || key === 'epoch')
    && Object.hasOwn(writerLease, 'id')
    && typeof writerLease.id === 'string'
    && writerLease.id.trim().length > 0
    && writerLease.id.trim() === writerLease.id
    && (
      !Object.hasOwn(writerLease, 'epoch')
      || (Number.isInteger(writerLease.epoch) && writerLease.epoch >= 0)
    )
  );
}

function productionLeaseIdentitiesMatch(left, right) {
  return isValidProductionWriterLease(left)
    && isValidProductionWriterLease(right)
    && left.id === right.id
    && (
      (!Object.hasOwn(left, 'epoch') && !Object.hasOwn(right, 'epoch'))
      || (
        Object.hasOwn(left, 'epoch')
        && Object.hasOwn(right, 'epoch')
        && left.epoch === right.epoch
      )
    );
}

function normalizeProductionRecoveryJournalOptions(filePathOrOptions, options = {}) {
  const looksLikeCompatibilityOverload = Boolean(
    filePathOrOptions
    && typeof filePathOrOptions === 'object'
    && (
      'filePath' in filePathOrOptions
      || 'plan' in filePathOrOptions
      || 'current' in filePathOrOptions
      || 'artifactRefs' in filePathOrOptions
    )
  );
  if (looksLikeCompatibilityOverload && !isStrictPlainObject(filePathOrOptions)) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal compatibility overload requires a strict plain options object.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: false,
        ownsJournal: false,
        ownsRemoteArtifact: false,
        journalPath: null,
        artifactRefs: Object.freeze({
          journal: null,
          remote: null,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (
    isStrictPlainObject(filePathOrOptions)
    && (
      Object.hasOwn(filePathOrOptions, 'filePath')
      || Object.hasOwn(filePathOrOptions, 'plan')
      || Object.hasOwn(filePathOrOptions, 'current')
      || Object.hasOwn(filePathOrOptions, 'artifactRefs')
    )
  ) {
    const legacyOptions = { ...filePathOrOptions };
    if (Object.hasOwn(legacyOptions, 'artifactRefs') && !isStrictPlainObject(legacyOptions.artifactRefs)) {
      throw new UnsupportedProductionRecoveryJournalError(
        'Production recovery journal compatibility overload requires strict plain artifact refs.',
        {
          kind: 'production-recovery-journal',
          productionAdapter: true,
          supportedSurface: 'production-recovery-journal-adapter',
          restartReadable: false,
          ownsJournal: false,
          ownsRemoteArtifact: false,
          journalPath: typeof legacyOptions.filePath === 'string' ? legacyOptions.filePath : null,
          artifactRefs: Object.freeze({
            journal: null,
            remote: null,
          }),
          schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        },
      );
    }
    const legacyArtifactRefs = Object.hasOwn(legacyOptions, 'artifactRefs') && isStrictPlainObject(legacyOptions.artifactRefs)
      ? legacyOptions.artifactRefs
      : null;
    if (
      legacyArtifactRefs
      && Reflect.ownKeys(legacyArtifactRefs).some((key) => key !== 'journal' && key !== 'remote')
    ) {
      throw new UnsupportedProductionRecoveryJournalError(
        'Production recovery journal compatibility overload allows only artifactRefs.journal and artifactRefs.remote.',
        {
          kind: 'production-recovery-journal',
          productionAdapter: true,
          supportedSurface: 'production-recovery-journal-adapter',
          restartReadable: false,
          ownsJournal: false,
          ownsRemoteArtifact: Object.hasOwn(legacyArtifactRefs, 'remote'),
          journalPath: typeof legacyOptions.filePath === 'string' ? legacyOptions.filePath : null,
          artifactRefs: Object.freeze({
            journal: Object.hasOwn(legacyArtifactRefs, 'journal') ? legacyArtifactRefs.journal : null,
            remote: Object.hasOwn(legacyArtifactRefs, 'remote') ? legacyArtifactRefs.remote : null,
          }),
          schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        },
      );
    }
    if (
      legacyArtifactRefs
      && Object.hasOwn(legacyArtifactRefs, 'journal')
      && legacyArtifactRefs.journal !== legacyOptions.filePath
    ) {
      throw new UnsupportedProductionRecoveryJournalError(
        'Production recovery journal compatibility overload requires artifactRefs.journal to match the owned journal path.',
        {
          kind: 'production-recovery-journal',
          productionAdapter: true,
          supportedSurface: 'production-recovery-journal-adapter',
          restartReadable: false,
          ownsJournal: false,
          ownsRemoteArtifact: Object.hasOwn(legacyArtifactRefs, 'remote'),
          journalPath: typeof legacyOptions.filePath === 'string' ? legacyOptions.filePath : null,
          artifactRefs: Object.freeze({
            journal: legacyArtifactRefs.journal,
            remote: Object.hasOwn(legacyArtifactRefs, 'remote') ? legacyArtifactRefs.remote : null,
          }),
          schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        },
      );
    }
    const explicitRemoteArtifactPath = Object.hasOwn(legacyOptions, 'remoteArtifactPath')
      ? legacyOptions.remoteArtifactPath
      : undefined;
    const remoteArtifactPath = explicitRemoteArtifactPath !== undefined
      ? explicitRemoteArtifactPath
      : (
        legacyArtifactRefs && Object.hasOwn(legacyArtifactRefs, 'remote')
          ? legacyArtifactRefs.remote
          : null
      );
    const hasExplicitWriterLease = Object.hasOwn(legacyOptions, 'writerLease');
    const hasExplicitClaimId = Object.hasOwn(legacyOptions, 'claimId')
      && typeof legacyOptions.claimId === 'string'
      && legacyOptions.claimId.trim().length > 0;
    if (!hasExplicitWriterLease && !hasExplicitClaimId) {
      throw new UnsupportedProductionRecoveryJournalError(
        'Production recovery journal compatibility overload requires an explicit claimId or writerLease.',
        {
          kind: 'production-recovery-journal',
          productionAdapter: true,
          supportedSurface: 'production-recovery-journal-adapter',
          restartReadable: false,
          ownsJournal: false,
          ownsRemoteArtifact: remoteArtifactPath !== null,
          journalPath: typeof legacyOptions.filePath === 'string' ? legacyOptions.filePath : null,
          artifactRefs: Object.freeze({
            journal: null,
            remote: null,
          }),
          schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        },
      );
    }
    return {
      ...legacyOptions,
      writerLease: hasExplicitWriterLease
        ? legacyOptions.writerLease
        : { id: legacyOptions.claimId },
      ownsRemoteArtifact: Object.hasOwn(legacyOptions, 'ownsRemoteArtifact')
        ? legacyOptions.ownsRemoteArtifact === true
        : remoteArtifactPath !== null && remoteArtifactPath !== undefined && remoteArtifactPath !== '',
      remoteArtifactPath,
    };
  }

  return {
    ...options,
    filePath: filePathOrOptions,
  };
}

function normalizeProductionArtifactRefs(artifactRefs, journalPath, remoteArtifactPath = null) {
  const writerArtifactRefs = isStrictPlainObject(artifactRefs) ? artifactRefs : {};
  if (Reflect.ownKeys(writerArtifactRefs).some((key) => key !== 'journal' && key !== 'remote')) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal consumption allows only artifactRefs.journal and artifactRefs.remote.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact: remoteArtifactPath !== null,
        journalPath,
        artifactRefs: Object.freeze({
          journal: Object.hasOwn(writerArtifactRefs, 'journal') ? writerArtifactRefs.journal : journalPath,
          remote: Object.hasOwn(writerArtifactRefs, 'remote') ? writerArtifactRefs.remote : remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  const persistedArtifactRefs = persistedProductionArtifactRefs(journalPath);
  if (persistedArtifactRefs.invalidReason) {
    throw new UnsupportedProductionRecoveryJournalError(
      persistedArtifactRefs.invalidReason,
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact: remoteArtifactPath !== null,
        journalPath,
        artifactRefs: Object.freeze({
          journal: Object.hasOwn(writerArtifactRefs, 'journal') ? writerArtifactRefs.journal : journalPath,
          remote: Object.hasOwn(writerArtifactRefs, 'remote') ? writerArtifactRefs.remote : remoteArtifactPath,
        }),
        persistedArtifactRefs: Object.freeze({
          journal: persistedArtifactRefs.journal,
          remote: persistedArtifactRefs.remote,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (
    remoteArtifactPath !== null
    && persistedArtifactRefs.remote === null
    && persistedArtifactRefs.hasRecords === true
  ) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal consumption requires the persisted remote artifact ownership state.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact: true,
        journalPath,
        artifactRefs: Object.freeze({
          journal: Object.hasOwn(writerArtifactRefs, 'journal') ? writerArtifactRefs.journal : journalPath,
          remote: Object.hasOwn(writerArtifactRefs, 'remote') ? writerArtifactRefs.remote : remoteArtifactPath,
        }),
        persistedArtifactRefs: Object.freeze({
          journal: persistedArtifactRefs.journal,
          remote: persistedArtifactRefs.remote,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (
    persistedArtifactRefs.remote !== null
    && remoteArtifactPath !== persistedArtifactRefs.remote
  ) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal consumption requires the persisted owned remote artifact path.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact: remoteArtifactPath !== null,
        journalPath,
        artifactRefs: Object.freeze({
          journal: Object.hasOwn(writerArtifactRefs, 'journal') ? writerArtifactRefs.journal : journalPath,
          remote: Object.hasOwn(writerArtifactRefs, 'remote') ? writerArtifactRefs.remote : remoteArtifactPath,
        }),
        persistedArtifactRefs: Object.freeze({
          journal: persistedArtifactRefs.journal,
          remote: persistedArtifactRefs.remote,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (remoteArtifactPath !== null && remoteArtifactPath === journalPath) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal consumption requires a distinct owned remote artifact path.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact: true,
        journalPath,
        artifactRefs: Object.freeze({
          journal: Object.hasOwn(writerArtifactRefs, 'journal') ? writerArtifactRefs.journal : journalPath,
          remote: Object.hasOwn(writerArtifactRefs, 'remote') ? writerArtifactRefs.remote : remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (
    Object.hasOwn(writerArtifactRefs, 'journal')
    && writerArtifactRefs.journal !== journalPath
  ) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal consumption requires artifactRefs.journal to match the owned journal path.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact: remoteArtifactPath !== null,
        journalPath,
        artifactRefs: Object.freeze({
          journal: writerArtifactRefs.journal,
          remote: Object.hasOwn(writerArtifactRefs, 'remote') ? writerArtifactRefs.remote : remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  if (
    Object.hasOwn(writerArtifactRefs, 'remote')
    && (
      writerArtifactRefs.remote !== remoteArtifactPath
      || (
        persistedArtifactRefs.remote !== null
        && writerArtifactRefs.remote !== persistedArtifactRefs.remote
      )
    )
  ) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal consumption requires artifactRefs.remote to match the owned remote artifact path.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact: remoteArtifactPath !== null,
        journalPath,
        artifactRefs: Object.freeze({
          journal: Object.hasOwn(writerArtifactRefs, 'journal') ? writerArtifactRefs.journal : journalPath,
          remote: writerArtifactRefs.remote,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
  return {
    journal: Object.hasOwn(writerArtifactRefs, 'journal') ? writerArtifactRefs.journal : journalPath,
    remote: Object.hasOwn(writerArtifactRefs, 'remote') ? writerArtifactRefs.remote : remoteArtifactPath,
  };
}

function assertProductionClaimIdentityMatchesWriterLease({
  claimId,
  writerLease,
  filePath,
  ownsRemoteArtifact,
  remoteArtifactPath,
}) {
  if (
    typeof claimId === 'string'
    && claimId.length > 0
    && isValidProductionWriterLease(writerLease)
    && writerLease.id !== claimId
  ) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires claimId to match writerLease.id.',
      {
        kind: 'production-recovery-journal',
        productionAdapter: true,
        supportedSurface: 'production-recovery-journal-adapter',
        restartReadable: true,
        ownsJournal: true,
        ownsRemoteArtifact,
        writerLease,
        journalPath: filePath,
        artifactRefs: Object.freeze({
          journal: filePath,
          remote: remoteArtifactPath,
        }),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
      },
    );
  }
}

function persistedProductionArtifactRefs(journalPath) {
  const persisted = readRecoveryJournal(journalPath);
  if (persisted.integrity?.status === 'blocked') {
    return {
      hasRecords: Array.isArray(persisted.records) && persisted.records.length > 0,
      journal: null,
      remote: null,
      invalidReason: 'Production recovery journal persistence is corrupt or truncated.',
    };
  }
  if (persisted.integrity?.status !== 'ok') {
    return {
      hasRecords: Array.isArray(persisted.records) && persisted.records.length > 0,
      journal: null,
      remote: null,
      invalidReason: null,
    };
  }

  let persistedJournalPath = null;
  let persistedRemoteArtifactPath = null;
  let sawRecordWithoutJournalArtifactRef = false;
  let sawRecordWithoutRemoteArtifactRef = false;

  for (let index = persisted.records.length - 1; index >= 0; index -= 1) {
    const record = persisted.records[index];
    if (!Object.hasOwn(record ?? {}, 'artifactRefs')) {
      if (typeof record?.artifactRefs !== 'undefined') {
        return {
          hasRecords: true,
          journal: null,
          remote: null,
          invalidReason: 'Production recovery journal persistence includes invalid artifact references.',
        };
      }
      continue;
    }
    const artifactRefs = record.artifactRefs;
    if (!isStrictPlainObject(artifactRefs)) {
      return {
        hasRecords: true,
        journal: null,
        remote: null,
        invalidReason: 'Production recovery journal persistence includes invalid artifact references.',
      };
    }
    const hasAnyArtifactRefKeys = Reflect.ownKeys(artifactRefs).length > 0;

    if (Reflect.ownKeys(artifactRefs).some((key) => key !== 'journal' && key !== 'remote')) {
      return {
        hasRecords: true,
        journal: null,
        remote: null,
        invalidReason: 'Production recovery journal persistence includes undeclared artifact reference keys.',
      };
    }

    if (
      Object.hasOwn(artifactRefs, 'journal')
      && !isCanonicalAbsolutePath(artifactRefs.journal)
    ) {
      if (artifactRefs.journal === null) {
        return {
          hasRecords: true,
          journal: null,
          remote: null,
          invalidReason: 'Production recovery journal persistence cleared an owned journal artifact path.',
        };
      }
      return {
        hasRecords: true,
        journal: null,
        remote: null,
        invalidReason: 'Production recovery journal persistence includes an invalid owned journal artifact path.',
      };
    }
    if (Object.hasOwn(artifactRefs, 'remote')) {
      if (artifactRefs.remote === null) {
        return {
          hasRecords: true,
          journal: null,
          remote: null,
          invalidReason: 'Production recovery journal persistence cleared an owned remote artifact path.',
        };
      }
      if (
        !isCanonicalAbsolutePath(artifactRefs.remote)
        || artifactRefs.remote === artifactRefs.journal
      ) {
        return {
          hasRecords: true,
          journal: null,
          remote: null,
          invalidReason: 'Production recovery journal persistence includes an invalid owned remote artifact path.',
        };
      }
    }

    if (
      !Object.hasOwn(artifactRefs, 'journal')
      && hasAnyArtifactRefKeys
      && persistedJournalPath !== null
    ) {
      return {
        hasRecords: true,
        journal: null,
        remote: null,
        invalidReason: 'Production recovery journal persistence dropped an owned journal artifact path.',
      };
    }
    if (
      !Object.hasOwn(artifactRefs, 'journal')
      && hasAnyArtifactRefKeys
      && persistedJournalPath === null
    ) {
      sawRecordWithoutJournalArtifactRef = true;
    }

    if (
      persistedJournalPath === null
      && Object.hasOwn(artifactRefs, 'journal')
      && isCanonicalAbsolutePath(artifactRefs.journal)
    ) {
      if (sawRecordWithoutJournalArtifactRef) {
        return {
          hasRecords: true,
          journal: null,
          remote: null,
          invalidReason: 'Production recovery journal persistence dropped an owned journal artifact path.',
        };
      }
      persistedJournalPath = artifactRefs.journal;
    } else if (
      Object.hasOwn(artifactRefs, 'journal')
      && isCanonicalAbsolutePath(artifactRefs.journal)
      && persistedJournalPath !== artifactRefs.journal
    ) {
      return {
        hasRecords: true,
        journal: null,
        remote: null,
        invalidReason: 'Production recovery journal persistence rewrote the owned journal artifact path.',
      };
    }

    if (
      !Object.hasOwn(artifactRefs, 'remote')
      && hasAnyArtifactRefKeys
      && persistedRemoteArtifactPath !== null
    ) {
      return {
        hasRecords: true,
        journal: null,
        remote: null,
        invalidReason: 'Production recovery journal persistence dropped an owned remote artifact path.',
      };
    }
    if (
      !Object.hasOwn(artifactRefs, 'remote')
      && hasAnyArtifactRefKeys
      && persistedRemoteArtifactPath === null
    ) {
      sawRecordWithoutRemoteArtifactRef = true;
    }

    if (
      Object.hasOwn(artifactRefs, 'remote')
      && isCanonicalAbsolutePath(artifactRefs.remote)
      && artifactRefs.remote !== persistedJournalPath
      && artifactRefs.remote !== artifactRefs.journal
    ) {
      if (sawRecordWithoutRemoteArtifactRef) {
        return {
          hasRecords: true,
          journal: null,
          remote: null,
          invalidReason: 'Production recovery journal persistence dropped an owned remote artifact path.',
        };
      }
      if (
        persistedRemoteArtifactPath !== null
        && persistedRemoteArtifactPath !== artifactRefs.remote
      ) {
        return {
          hasRecords: true,
          journal: null,
          remote: null,
          invalidReason: 'Production recovery journal persistence rewrote the owned remote artifact path.',
        };
      }
      persistedRemoteArtifactPath = artifactRefs.remote;
    }
  }

  if (persistedJournalPath !== null && persistedJournalPath !== journalPath) {
    return {
      hasRecords: true,
      journal: null,
      remote: null,
      invalidReason: 'Production recovery journal persistence includes an invalid owned journal artifact path.',
    };
  }
  if (
    persistedRemoteArtifactPath !== null
    && (
      persistedRemoteArtifactPath === journalPath
      || (persistedJournalPath !== null && persistedRemoteArtifactPath === persistedJournalPath)
    )
  ) {
    return {
      hasRecords: true,
      journal: null,
      remote: null,
      invalidReason: 'Production recovery journal persistence includes an invalid owned remote artifact path.',
    };
  }

  return {
    hasRecords: persisted.records.length > 0,
    journal: persistedJournalPath,
    remote: persistedRemoteArtifactPath,
    invalidReason: null,
  };
}

function isStrictPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype;
}

function hasHiddenOwnStringKeys(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Object.getOwnPropertyNames(value).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === false;
  });
}

function freezeProductionWriterLease(writerLease) {
  if (!isValidProductionWriterLease(writerLease)) {
    return writerLease;
  }

  return Object.freeze({
    ...writerLease,
  });
}

function isCanonicalAbsolutePath(filePath) {
  return typeof filePath === 'string'
    && path.isAbsolute(filePath)
    && path.resolve(filePath) === filePath
    && !/[?#]/.test(filePath);
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

export function openPlanRecoveryJournal({
  filePath,
  plan,
  current,
  artifactRefs = {},
  now,
  truncate = true,
}) {
  const journal = openRecoveryJournal(filePath, { truncate, now });
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
  return journal.appendEvent('recovery-claim-opened', {
    planId: plan.id,
    state: 'active',
    claimHash: recoveryClaimHash(claimId),
    claimLease: claimLeasePayloadForJournal(journal, claimId),
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
    previousClaimHash: recoveryClaimHash(previousClaimId),
    claimHash: recoveryClaimHash(claimId),
    claimLease: claimLeasePayloadForJournal(journal, claimId),
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
    .filter((record) => CLAIM_EVENT_TYPES.has(record.type));
  if (claimRecords.length === 0) {
    return {
      status: 'none',
      activeClaimHash: null,
      activeClaimLease: null,
      previousClaimHash: null,
      sequence: null,
      type: null,
    };
  }

  let previousActiveClaimHash = null;
  for (const record of claimRecords) {
    if (!Object.hasOwn(record, 'claimHash')) {
      return blockedClaimState(record, 'Recovery claim record is missing an explicit claim hash.');
    }
    if (!CLAIM_HASH_PATTERN.test(record.claimHash || '')) {
      return blockedClaimState(record, 'Recovery claim record is missing a valid claim hash.');
    }
    if (
      record.type === 'stale-claim-advanced'
      && !Object.hasOwn(record, 'previousClaimHash')
    ) {
      return blockedClaimState(record, 'Advanced stale-claim record is missing an explicit previous claim hash.');
    }
    if (
      record.type === 'stale-claim-advanced'
      && !CLAIM_HASH_PATTERN.test(record.previousClaimHash || '')
    ) {
      return blockedClaimState(record, 'Advanced stale-claim record is missing a valid previous claim hash.');
    }
    if (
      record.type === 'stale-claim-advanced'
      && record.previousClaimHash === record.claimHash
    ) {
      return blockedClaimState(record, 'Advanced stale-claim record must advance to a different active claim hash.');
    }
    if (
      record.type === 'stale-claim-advanced'
      && previousActiveClaimHash === null
    ) {
      return blockedClaimState(record, 'Advanced stale-claim record requires an immediately previous active claim hash.');
    }
    if (
      record.type === 'stale-claim-advanced'
      && previousActiveClaimHash !== null
      && record.previousClaimHash !== previousActiveClaimHash
    ) {
      return blockedClaimState(record, 'Advanced stale-claim record must chain from the immediately previous active claim hash.');
    }
    if (
      !Object.hasOwn(record, 'claimLease')
      && typeof record.claimLease !== 'undefined'
    ) {
      return blockedClaimState(record, 'Recovery claim record has a prototype-inherited persisted lease identity.');
    }
    if (
      Object.hasOwn(record, 'claimLease')
      && !isValidProductionWriterLease(record.claimLease)
    ) {
      return blockedClaimState(record, 'Recovery claim record has an invalid persisted lease identity.');
    }
    if (
      Object.hasOwn(record, 'claimLease')
      && isValidProductionWriterLease(record.claimLease)
      && record.claimHash !== recoveryClaimHash(record.claimLease.id)
    ) {
      return blockedClaimState(record, 'Recovery claim record claim lease must match the persisted active claim hash.');
    }

    previousActiveClaimHash = record.claimHash;
  }

  const latest = claimRecords.at(-1);
  return {
    status: latest.type === 'stale-claim-advanced' ? 'advanced' : 'active',
    activeClaimHash: latest.claimHash,
    activeClaimLease: isValidProductionWriterLease(latest.claimLease)
      ? freezeProductionWriterLease(latest.claimLease)
      : null,
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
    this.claimHash = options.claimId ? recoveryClaimHash(options.claimId) : null;
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
    if (!this.claimHash || CLAIM_EVENT_TYPES.has(eventType)) {
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

  flush() {
    if (!this.closed) {
      fs.fsyncSync(this.fd);
    }
  }
}

function blockedClaimState(record, reason) {
  return {
    status: 'blocked',
    activeClaimHash: record.claimHash || null,
    activeClaimLease: isValidProductionWriterLease(record.claimLease)
      ? freezeProductionWriterLease(record.claimLease)
      : null,
    previousClaimHash: record.previousClaimHash || null,
    sequence: record.sequence || null,
    type: record.type || null,
    reason,
  };
}

function claimLeasePayloadForJournal(journal, claimId) {
  if (
    journal
    && isValidProductionWriterLease(journal.writerLease)
    && journal.writerLease.id === claimId
  ) {
    return freezeProductionWriterLease(journal.writerLease);
  }
  return { id: claimId };
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
