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

function productionRecoveryJournalDetails({
  journalPath = null,
  remoteArtifactPath = null,
  ownsJournal = false,
  ownsRemoteArtifact = false,
  restartReadable = false,
  writerLease = null,
} = {}) {
  return {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable,
    ownsJournal,
    ownsRemoteArtifact,
    writerLease,
    journalPath,
    artifactRefs: Object.freeze({
      journal: journalPath,
      remote: remoteArtifactPath,
    }),
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
  };
}

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
  const details = productionRecoveryJournalDetails();
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
    'stale-worker rejection fencing',
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

export function openProductionRecoveryJournal(filePath, options = {}) {
  const claimId = readOwnRecoveryClaimId(options);
  const claimHash = claimId ? recoveryClaimHash(claimId) : null;
  const ownsRemoteArtifact = Object.hasOwn(options, 'ownsRemoteArtifact')
    ? options.ownsRemoteArtifact === true
    : false;
  const remoteArtifactPath = Object.hasOwn(options, 'remoteArtifactPath')
    ? options.remoteArtifactPath
    : null;
  if (!isCanonicalAbsolutePath(filePath)) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires a canonical absolute journal path.',
      {
        ...productionRecoveryJournalDetails({
          journalPath: filePath,
          remoteArtifactPath,
          ownsJournal: true,
          ownsRemoteArtifact,
          restartReadable: true,
          writerLease: Object.hasOwn(options, 'writerLease') ? options.writerLease : null,
        }),
      },
    );
  }
  const writerLease = Object.hasOwn(options, 'writerLease') ? options.writerLease : null;
  if (ownsRemoteArtifact && remoteArtifactPath === null) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires an explicit remote artifact path when remote ownership is claimed.',
      {
        ...productionRecoveryJournalDetails({
          journalPath: filePath,
          remoteArtifactPath,
          ownsJournal: true,
          ownsRemoteArtifact,
          restartReadable: true,
          writerLease,
        }),
      },
    );
  }
  if (remoteArtifactPath !== null && !ownsRemoteArtifact) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires owned remote artifact references.',
      {
        ...productionRecoveryJournalDetails({
          journalPath: filePath,
          remoteArtifactPath,
          ownsJournal: true,
          ownsRemoteArtifact,
          restartReadable: true,
          writerLease,
        }),
      },
    );
  }
  if (remoteArtifactPath !== null && !isCanonicalAbsolutePath(remoteArtifactPath)) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires a canonical remote artifact path.',
      {
        ...productionRecoveryJournalDetails({
          journalPath: filePath,
          remoteArtifactPath,
          ownsJournal: true,
          ownsRemoteArtifact,
          restartReadable: true,
          writerLease,
        }),
      },
    );
  }
  if (!isValidProductionWriterLease(writerLease)) {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires an explicit fenced writer lease.',
      {
        ...productionRecoveryJournalDetails({
          journalPath: filePath,
          remoteArtifactPath,
          ownsJournal: true,
          ownsRemoteArtifact,
          restartReadable: true,
          writerLease,
        }),
      },
    );
  }

  const journal = openRecoveryJournal(filePath, {
    truncate: options.truncate,
    now: options.now,
    claimId,
  });

  return Object.freeze({
    claimHash,
    ...productionRecoveryJournalDetails({
      journalPath: journal.filePath,
      remoteArtifactPath,
      ownsJournal: true,
      ownsRemoteArtifact,
      restartReadable: true,
      writerLease,
    }),
    appendEvent(type, payload) {
      return journal.appendEvent(type, payload);
    },
    inspect() {
      const inspectedJournal = readRecoveryJournal(journal.filePath);
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
        writerLease,
        claimHash,
        journalPath: journal.filePath,
        ...inspectedJournal,
        claim: classifyRecoveryJournalClaims(inspectedJournal.records),
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs,
      };
    },
    assertCurrentClaim(eventType) {
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

export function inspectProductionRecoveryJournal(writer) {
  if (!writer || typeof writer.inspect !== 'function') {
    return null;
  }

  try {
    const inspected = writer.inspect();
    if (!inspected || typeof inspected !== 'object') {
      return inspected;
    }

    const inspectedArtifactRefs = inspected.artifactRefs && typeof inspected.artifactRefs === 'object'
      ? inspected.artifactRefs
      : null;
    const writerArtifactRefs = isStrictPlainObject(writer.artifactRefs)
      ? writer.artifactRefs
      : null;

    const fallbackArtifactRefs = {
      journal: writerArtifactRefs && Object.hasOwn(writerArtifactRefs, 'journal')
        ? writerArtifactRefs.journal
        : writer.journalPath ?? null,
      remote: writerArtifactRefs && Object.hasOwn(writerArtifactRefs, 'remote')
        ? writerArtifactRefs.remote
        : null,
    };

    const normalizedArtifactRefs = inspectedArtifactRefs
      ? Object.assign(
          Object.create(Object.getPrototypeOf(inspectedArtifactRefs) || null),
          inspectedArtifactRefs,
        )
      : { ...fallbackArtifactRefs };
    if (normalizedArtifactRefs && !Object.hasOwn(normalizedArtifactRefs, 'journal')) {
      normalizedArtifactRefs.journal = fallbackArtifactRefs.journal;
    }
    if (
      normalizedArtifactRefs
      && !('remote' in normalizedArtifactRefs)
      && fallbackArtifactRefs.remote !== null
    ) {
      normalizedArtifactRefs.remote = fallbackArtifactRefs.remote;
    }

    return {
      ...inspected,
      productionAdapter: Object.hasOwn(inspected, 'productionAdapter')
        ? inspected.productionAdapter
        : Boolean(writer.productionAdapter),
      supportedSurface: Object.hasOwn(inspected, 'supportedSurface')
        ? inspected.supportedSurface
        : writer.supportedSurface || 'production-recovery-journal-adapter',
      restartReadable: Object.hasOwn(inspected, 'restartReadable')
        ? inspected.restartReadable
        : Boolean(writer.restartReadable),
      ownsJournal: Object.hasOwn(inspected, 'ownsJournal')
        ? inspected.ownsJournal
        : Boolean(writer.ownsJournal),
      ownsRemoteArtifact: Object.hasOwn(inspected, 'ownsRemoteArtifact')
        ? inspected.ownsRemoteArtifact
        : Boolean(writer.ownsRemoteArtifact),
      writerLease: Object.hasOwn(inspected, 'writerLease')
        ? inspected.writerLease
        : writer.writerLease ?? null,
      claimHash: Object.hasOwn(inspected, 'claimHash')
        ? inspected.claimHash
        : writer.claimHash ?? null,
      journalPath: Object.hasOwn(inspected, 'journalPath')
        ? inspected.journalPath
        : writer.journalPath ?? null,
      schemaVersion: Object.hasOwn(inspected, 'schemaVersion')
        ? inspected.schemaVersion
        : writer.schemaVersion ?? RECOVERY_JOURNAL_SCHEMA_VERSION,
      artifactRefs: normalizedArtifactRefs,
    };
  } catch (error) {
    return { error };
  }
}

export function assertProductionRecoveryJournalClaim(writer, eventType = 'journal-append') {
  if (!writer || typeof writer.assertCurrentClaim !== 'function') {
    throw new UnsupportedProductionRecoveryJournalError(
      'Production recovery journal support requires a stale-worker rejection surface.',
      {
        ...productionRecoveryJournalDetails(),
        eventType,
      },
    );
  }

  return writer.assertCurrentClaim(eventType);
}

export function isValidProductionWriterLease(writerLease) {
  return (
    isStrictPlainObject(writerLease)
    && Object.hasOwn(writerLease, 'id')
    && typeof writerLease.id === 'string'
    && writerLease.id.trim().length > 0
  );
}

function isStrictPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
    claimId: readOwnRecoveryClaimId(options),
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

function readOwnRecoveryClaimId(options) {
  if (Object.hasOwn(options, 'claimId')) {
    return options.claimId || null;
  }

  if (
    Object.hasOwn(options, 'claim')
    && isStrictPlainObject(options.claim)
    && Object.hasOwn(options.claim, 'id')
  ) {
    return options.claim.id || null;
  }

  return null;
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
    activeClaimHash: latest.claimHash,
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
