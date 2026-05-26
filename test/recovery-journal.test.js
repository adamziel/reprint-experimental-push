import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendJournalCompleted,
  appendMutationObserved,
  appendRecoveryClaimOpened,
  assertJournalRecordHasNoRawValues,
  createUnsupportedProductionRecoveryJournal,
  inspectProductionRecoveryJournal,
  isValidProductionWriterLease,
  openPlanRecoveryJournal,
  openProductionRecoveryJournal,
  openRecoveryJournal,
  recoveryClaimHash,
  readRecoveryJournal,
  RECOVERY_JOURNAL_SCHEMA_VERSION,
} from '../src/recovery-journal.js';
import { productionRecoverySupportReport } from '../src/apply.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, setResource } from '../src/resources.js';

const fixedNow = new Date('2026-05-24T00:00:00.000Z');

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-recovery-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 8; index++) {
    files[`file-${index}.txt`] = `base-private-content-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite() {
  const site = baseSite();
  for (let index = 1; index <= 8; index++) {
    site.files[`file-${index}.txt`] = `local-private-content-${index}`;
  }
  return site;
}

function planFor(base = baseSite(), local = localSite(), remote = baseSite()) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyFirstMutations(site, plan, count) {
  for (const mutation of plan.mutations.slice(0, count)) {
    setResource(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
}

test('file-backed journal opens or creates a missing JSONL file', () => {
  const filePath = tempJournalPath();
  const journal = openRecoveryJournal(filePath, { now: fixedNow });

  journal.appendEvent('journal-opened', {
    planId: 'plan-create-test',
    state: 'opened',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {},
  });
  journal.close();

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.deepEqual(restarted.records.map((record) => record.sequence), [1]);
});

test('file-backed journal appends monotonic sequences and reads after restart', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });
  const current = clone(remote);
  applyFirstMutations(current, plan, 1);

  appendMutationObserved(journal, {
    plan,
    mutation: plan.mutations[0],
    current,
    state: 'applied',
  });
  journal.close();

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    Array.from({ length: 10 }, (_, index) => index + 1),
  );
  assert.ok(restarted.records.every((record) => record.fsync.requested));
});

test('file-backed journal records hashes and metadata without raw values', () => {
  const filePath = tempJournalPath();
  const plan = planFor();
  const journal = openPlanRecoveryJournal({
    filePath,
    plan,
    current: baseSite(),
    now: fixedNow,
    artifactRefs: { dryRun: 'artifact://dry-run-1' },
  });
  journal.close();

  const text = fs.readFileSync(filePath, 'utf8');
  assert.equal(text.includes('base-private-content'), false);
  assert.equal(text.includes('local-private-content'), false);

  const restarted = readRecoveryJournal(filePath);
  for (const record of restarted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
    assert.equal(Object.hasOwn(record, 'beforeValue'), false);
    assert.equal(Object.hasOwn(record, 'afterValue'), false);
    assert.equal(Object.hasOwn(record, 'value'), false);
  }
});

test('unsupported production recovery journal stub fails closed on every operation', () => {
  const journal = createUnsupportedProductionRecoveryJournal('production recovery is unavailable here.');

  assert.equal(journal.kind, 'production-recovery-journal');
  assert.equal(journal.productionAdapter, true);
  assert.equal(journal.ownsJournal, false);
  assert.equal(journal.ownsRemoteArtifact, false);
  assert.equal(journal.restartReadable, false);
  assert.equal(journal.writerLease, null);
  assert.equal(journal.journalPath, null);
  assert.deepEqual(journal.artifactRefs, { journal: null, remote: null });
  assert.deepEqual(journal.missingDependency, [
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

  for (const method of ['appendEvent', 'inspect', 'assertCurrentClaim', 'flush', 'close']) {
    assert.throws(() => journal[method](), {
      name: 'UnsupportedProductionRecoveryJournalError',
      code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
    });
  }
});

test('production recovery journal lease validation is available to release-path consumers', () => {
  assert.equal(isValidProductionWriterLease({ id: 'lease-1' }), true);
  assert.equal(isValidProductionWriterLease({ id: '   ' }), false);
  assert.equal(isValidProductionWriterLease(null), false);
  assert.equal(isValidProductionWriterLease({}), false);
  assert.equal(isValidProductionWriterLease({ id: 1 }), false);
});

test('production recovery journal inspection is exported for release-path consumers', () => {
  assert.equal(inspectProductionRecoveryJournal(null), null);

  const filePath = tempJournalPath();
  const journal = openProductionRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId: 'claim-inspect-1',
    writerLease: { id: 'lease-inspect-1' },
  });

  const inspected = inspectProductionRecoveryJournal(journal);
  assert.equal(inspected.kind, 'production-recovery-journal');
  assert.equal(inspected.restartReadable, true);
  assert.equal(inspected.ownsJournal, true);
  assert.equal(inspected.writerLease.id, 'lease-inspect-1');
  assert.equal(inspected.journalPath, filePath);
  assert.equal(inspected.claim.status, 'none');
  assert.equal(inspected.claim.activeClaimHash, null);
});

test('production recovery support report exposes the release-path dependency surface', () => {
  const unsupported = createUnsupportedProductionRecoveryJournal('production recovery is unavailable here.');
  const unsupportedReport = productionRecoverySupportReport(unsupported);

  assert.equal(unsupportedReport.supported, false);
  assert.ok(unsupportedReport.missingDependency.includes('restart-readable recovery inspection'));
  assert.ok(unsupportedReport.missingDependency.includes('fencing or lease ownership for the journal writer'));

  const filePath = tempJournalPath();
  const journal = openProductionRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId: 'claim-report-1',
    writerLease: { id: 'lease-report-1' },
  });
  const supportedReport = productionRecoverySupportReport(journal);

  assert.equal(supportedReport.supported, false);
  assert.equal(supportedReport.inspectedJournalPath, filePath);
  assert.equal(supportedReport.writerJournalPath, filePath);
  assert.ok(supportedReport.missingDependency.includes('restart-readable recovery remote artifact references'));
  assert.ok(supportedReport.missingDependency.includes('journal-readable inspection records with sequence and type'));
  journal.close();
});

test('production recovery journal inspection normalizes restart-readable lease and artifact metadata', () => {
  const inspected = inspectProductionRecoveryJournal({
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: '/var/lib/reprint/recovery-remote.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    writerLease: { id: 'lease-normalized-1' },
    claimHash: 'a'.repeat(64),
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
        records: [{ sequence: 1, type: 'journal-opened' }],
      };
    },
  });

  assert.equal(inspected.productionAdapter, true);
  assert.equal(inspected.supportedSurface, 'production-recovery-journal-adapter');
  assert.equal(inspected.restartReadable, true);
  assert.equal(inspected.ownsJournal, true);
  assert.equal(inspected.ownsRemoteArtifact, true);
  assert.deepEqual(inspected.writerLease, { id: 'lease-normalized-1' });
  assert.equal(inspected.claimHash, 'a'.repeat(64));
  assert.deepEqual(inspected.artifactRefs, {
    journal: '/var/lib/reprint/recovery.jsonl',
    remote: '/var/lib/reprint/recovery-remote.jsonl',
  });
});

test('production recovery journal inspection fills in missing remote artifact refs from the writer', () => {
  const inspected = inspectProductionRecoveryJournal({
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: '/var/lib/reprint/recovery-remote.jsonl',
    },
    schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
    writerLease: { id: 'lease-partial-1' },
    inspect() {
      return {
        filePath: '/var/lib/reprint/recovery.jsonl',
        schemaVersion: RECOVERY_JOURNAL_SCHEMA_VERSION,
        artifactRefs: {
          journal: '/var/lib/reprint/recovery.jsonl',
        },
      };
    },
  });

  assert.deepEqual(inspected.artifactRefs, {
    journal: '/var/lib/reprint/recovery.jsonl',
    remote: '/var/lib/reprint/recovery-remote.jsonl',
  });
});

test('production recovery journal adapter is restart-readable and release-path compatible', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const journal = openProductionRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId: 'claim-1',
    writerLease: { id: 'lease-1' },
  });

  assert.equal(journal.kind, 'production-recovery-journal');
  assert.equal(journal.productionAdapter, true);
  assert.equal(journal.supportedSurface, 'production-recovery-journal-adapter');
  assert.equal(journal.restartReadable, true);
  assert.equal(journal.ownsJournal, true);
  assert.equal(journal.claimHash, recoveryClaimHash('claim-1'));
  assert.equal(journal.journalPath, filePath);
  assert.equal(journal.schemaVersion, 1);
  assert.deepEqual(journal.artifactRefs, { journal: filePath, remote: null });

  journal.flush();
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId: 'claim-1',
    artifactRefs: { journal: filePath },
  });
  journal.appendEvent('journal-opened', {
    planId: plan.id,
    state: 'opened',
    observedHash: 'snapshot-hash-only',
    artifactRefs: { journal: filePath },
  });
  journal.close();

  const inspected = journal.inspect();
  assert.equal(inspected.kind, 'production-recovery-journal');
  assert.equal(inspected.productionAdapter, true);
  assert.equal(inspected.supportedSurface, 'production-recovery-journal-adapter');
  assert.equal(inspected.restartReadable, true);
  assert.equal(inspected.ownsJournal, true);
  assert.equal(inspected.ownsRemoteArtifact, false);
  assert.equal(inspected.claimHash, journal.claimHash);
  assert.equal(inspected.writerLease.id, 'lease-1');
  assert.equal(inspected.journalPath, filePath);
  assert.equal(inspected.filePath, filePath);
  assert.equal(inspected.schemaVersion, 1);
  assert.equal(inspected.records.at(-1).type, 'journal-opened');
  assert.deepEqual(inspected.artifactRefs, { journal: filePath, remote: null });
});

test('production recovery journal adapter preserves explicit remote artifact ownership metadata', () => {
  const journalPath = tempJournalPath();
  const remoteArtifactPath = path.join(path.dirname(journalPath), 'remote-artifact.jsonl');
  const journal = openProductionRecoveryJournal(journalPath, {
    truncate: true,
    now: fixedNow,
    claimId: 'claim-remote-1',
    writerLease: { id: 'lease-remote-1' },
    ownsRemoteArtifact: true,
    remoteArtifactPath,
  });

  assert.equal(journal.ownsRemoteArtifact, true);
  assert.deepEqual(journal.artifactRefs, {
    journal: journalPath,
    remote: remoteArtifactPath,
  });

  const inspected = journal.inspect();
  assert.equal(inspected.ownsRemoteArtifact, true);
  assert.deepEqual(inspected.artifactRefs, {
    journal: journalPath,
    remote: remoteArtifactPath,
  });
});

test('production recovery journal adapter reopens with a new claim and rejects stale fenced writers', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const firstJournal = openProductionRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId: 'claim-1',
    writerLease: { id: 'lease-1' },
  });

  appendRecoveryClaimOpened(firstJournal, {
    plan,
    current: remote,
    claimId: 'claim-1',
    artifactRefs: { journal: filePath },
  });
  firstJournal.appendEvent('journal-opened', {
    planId: plan.id,
    state: 'opened',
    observedHash: 'snapshot-hash-only',
    artifactRefs: { journal: filePath },
  });
  firstJournal.close();

  const reopened = openProductionRecoveryJournal(filePath, {
    truncate: false,
    now: fixedNow,
    claimId: 'claim-2',
    writerLease: { id: 'lease-2' },
  });

  assert.notEqual(reopened.claimHash, firstJournal.claimHash);
  assert.throws(() => {
    reopened.appendEvent('mutation-observed', {
      planId: plan.id,
      mutationId: 'mutation-1',
      resourceKey: 'file:file-1.txt',
      beforeHash: 'before',
      afterHash: 'after',
      state: 'applied',
      observedHash: 'snapshot-hash-only',
      artifactRefs: { journal: filePath },
    });
  }, {
    name: 'RecoveryJournalClaimStaleError',
    code: 'RECOVERY_CLAIM_STALE',
  });
  reopened.close();
});

test('production recovery journal adapter fails closed when no explicit fenced writer lease is provided', () => {
  const filePath = tempJournalPath();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, { truncate: true, now: fixedNow });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal adapter validates inputs before touching the journal file', () => {
  const filePath = 'relative-journal.jsonl';
  const remoteArtifactPath = `${filePath}.remote`;

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      writerLease: { id: 'lease-1' },
      ownsRemoteArtifact: true,
      remoteArtifactPath,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
  assert.equal(fs.existsSync(path.resolve(filePath)), false);
});

test('production recovery journal adapter fails closed when remote artifact path is not canonical', () => {
  const filePath = tempJournalPath();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      writerLease: { id: 'lease-1' },
      remoteArtifactPath: 'relative/remote-artifact.jsonl',
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal adapter fails closed when remote artifact ownership is not explicit', () => {
  const filePath = tempJournalPath();
  const remoteArtifactPath = `${filePath}.remote`;

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      writerLease: { id: 'lease-1' },
      remoteArtifactPath,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal adapter fails closed when remote artifact ownership is inherited through the prototype', () => {
  const filePath = tempJournalPath();
  const remoteArtifactPath = `${filePath}.remote`;
  const options = {
    truncate: true,
    now: fixedNow,
    writerLease: { id: 'lease-1' },
    remoteArtifactPath,
  };
  Object.setPrototypeOf(options, {
    ownsRemoteArtifact: true,
  });

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, options);
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal adapter fails closed when remote ownership is claimed without a remote artifact path', () => {
  const filePath = tempJournalPath();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      writerLease: { id: 'lease-1' },
      ownsRemoteArtifact: true,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal adapter ignores prototype-inherited claim identity', () => {
  const filePath = tempJournalPath();
  const options = {
    truncate: true,
    now: fixedNow,
    writerLease: { id: 'lease-1' },
  };
  Object.setPrototypeOf(options, {
    claimId: 'claim-from-prototype',
  });

  const journal = openProductionRecoveryJournal(filePath, options);

  assert.equal(journal.claimHash, null);
  assert.equal(journal.inspect().claimHash, null);
  assert.equal(journal.inspect().claim.status, 'none');
  journal.close();
});

test('production recovery journal adapter accepts canonical remote artifact ownership metadata', () => {
  const filePath = tempJournalPath();
  const remoteArtifactPath = `${filePath}.remote`;
  const journal = openProductionRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    writerLease: { id: 'lease-1' },
    ownsRemoteArtifact: true,
    remoteArtifactPath,
  });

  assert.equal(journal.ownsRemoteArtifact, true);
  assert.deepEqual(journal.artifactRefs, { journal: filePath, remote: remoteArtifactPath });

  const inspected = journal.inspect();
  assert.equal(inspected.ownsRemoteArtifact, true);
  assert.deepEqual(inspected.artifactRefs, { journal: filePath, remote: remoteArtifactPath });

  journal.close();
});

test('restart inspection classifies fail-before mutation journal as old remote', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });
  journal.close();

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current: remote,
  });

  assert.equal(inspection.status, 'old-remote');
  assert.deepEqual(inspection.counts, { old: 8, new: 0, blockedUnknown: 0 });
  assert.ok(inspection.targets.every((target) => target.state === 'old'));
});

test('restart inspection classifies fail-after-2 as blocked recovery with two new and six old', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });

  applyFirstMutations(current, plan, 2);
  for (const mutation of plan.mutations.slice(0, 2)) {
    appendMutationObserved(journal, { plan, mutation, current, state: 'applied' });
  }
  journal.close();

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current,
  });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 6, new: 2, blockedUnknown: 0 });
});

test('restart inspection treats completed replay as fully updated no-op state', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });

  applyFirstMutations(current, plan, plan.mutations.length);
  appendJournalCompleted(journal, { plan, current });
  journal.close();

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current,
  });

  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, { old: 0, new: 8, blockedUnknown: 0 });
});

test('restart inspection blocks when current state drifts outside before and after hashes', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });
  journal.close();
  current.files['file-3.txt'] = 'unexpected-remote-edit';

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current,
  });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.counts.blockedUnknown, 1);
  assert.equal(
    inspection.targets.find((target) => target.resourceKey === 'file:file-3.txt').state,
    'blocked-unknown',
  );
});

test('restart inspection blocks missing target records instead of treating updated remote as success', () => {
  const filePath = tempJournalPath();
  const plan = planFor();
  const current = localSite();
  const journal = openRecoveryJournal(filePath, { truncate: true, now: fixedNow });
  journal.appendEvent('journal-opened', {
    planId: plan.id,
    state: 'opened',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {},
  });
  journal.close();

  const inspection = inspectRecoveryJournal({ journalPath: filePath, plan, current });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 0, new: 0, blockedUnknown: 8 });
});

test('restart inspection blocks corrupt or truncated journal records', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = localSite();
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });
  journal.close();
  fs.appendFileSync(filePath, '{"schemaVersion":1');

  const inspection = inspectRecoveryJournal({ journalPath: filePath, plan, current });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 0, new: 0, blockedUnknown: 8 });
  assert.equal(inspection.journal.integrity.status, 'blocked');
});
