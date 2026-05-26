import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendJournalCompleted,
  appendMutationObserved,
  appendRecoveryClaimOpened,
  appendStaleClaimAdvanced,
  assertJournalRecordHasNoRawValues,
  consumeProductionRecoveryJournal,
  createUnsupportedProductionRecoveryJournal,
  describeProductionRecoveryJournal,
  openPlanRecoveryJournal,
  openProductionRecoveryJournal,
  openRecoveryJournal,
  recoveryClaimHash,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
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

test('production recovery journal adapter is restart-readable and release-path compatible', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const writerLease = { id: 'claim-1', epoch: 7 };
  const journal = openProductionRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId: 'claim-1',
    writerLease,
  });

  assert.equal(journal.kind, 'production-recovery-journal');
  assert.equal(journal.productionAdapter, true);
  assert.equal(journal.supportedSurface, 'production-recovery-journal-adapter');
  assert.equal(journal.restartReadable, true);
  assert.equal(journal.ownsJournal, true);
  assert.equal(journal.leaseFence.id, 'claim-1');
  assert.equal(journal.leaseFence.epoch, 7);
  assert.equal(Object.isFrozen(journal.leaseFence), true);
  assert.equal(journal.claimHash, recoveryClaimHash('claim-1'));
  assert.equal(journal.journalPath, filePath);
  assert.equal(journal.schemaVersion, 1);
  assert.notEqual(journal.writerLease, writerLease);
  assert.deepEqual(journal.writerLease, { id: 'claim-1', epoch: 7 });
  assert.equal(Object.isFrozen(journal.writerLease), true);
  assert.deepEqual(journal.artifactRefs, { journal: filePath, remote: null });

  writerLease.id = 'claim-mutated';
  writerLease.epoch = 9;
  assert.deepEqual(journal.writerLease, { id: 'claim-1', epoch: 7 });

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
  assert.deepEqual(inspected.leaseFence, { id: 'claim-1', epoch: 7 });
  assert.equal(inspected.claimHash, journal.claimHash);
  assert.equal(inspected.writerLease.id, 'claim-1');
  assert.equal(inspected.writerLease.epoch, 7);
  assert.equal(Object.isFrozen(inspected.writerLease), true);
  assert.equal(inspected.journalPath, filePath);
  assert.equal(inspected.filePath, filePath);
  assert.equal(inspected.schemaVersion, 1);
  assert.equal(inspected.records.at(-1).type, 'journal-opened');
  assert.deepEqual(inspected.artifactRefs, { journal: filePath, remote: null });
});

test('production recovery journal descriptor normalizes lease and artifact evidence for release consumption', () => {
  const filePath = tempJournalPath();
  const journal = openProductionRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId: 'claim-describe',
    writerLease: { id: 'claim-describe', epoch: 11 },
    ownsRemoteArtifact: true,
    remoteArtifactPath: `${filePath}.remote`,
  });

  const descriptor = describeProductionRecoveryJournal(journal);

  assert.deepEqual(descriptor, {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    leaseFence: { id: 'claim-describe', epoch: 11 },
    writerLease: { id: 'claim-describe', epoch: 11 },
    journalPath: filePath,
    artifactRefs: { journal: filePath, remote: `${filePath}.remote` },
    schemaVersion: 1,
  });
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.leaseFence), true);
  assert.equal(Object.isFrozen(descriptor.writerLease), true);

  journal.close();
});

test('production recovery journal descriptor fails closed on prototype-inherited marker and artifact fields', () => {
  const writer = {
    kind: 'production-recovery-journal',
    schemaVersion: 1,
  };
  Object.setPrototypeOf(writer, {
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    leaseFence: { id: 'lease-prototype' },
    writerLease: { id: 'lease-prototype' },
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: '/var/lib/reprint/recovery.remote.jsonl',
    },
  });

  const descriptor = describeProductionRecoveryJournal(writer);

  assert.deepEqual(descriptor, {
    kind: 'production-recovery-journal',
    productionAdapter: false,
    supportedSurface: null,
    restartReadable: false,
    ownsJournal: false,
    ownsRemoteArtifact: false,
    leaseFence: null,
    writerLease: null,
    journalPath: null,
    artifactRefs: { journal: null, remote: null },
    schemaVersion: 1,
  });
});

test('production recovery journal descriptor fails closed on non-canonical ownership paths and divergent lease ids', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    leaseFence: { id: 'lease-fence' },
    writerLease: { id: 'lease-writer' },
    journalPath: 'relative/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: '/var/lib/reprint/recovery.jsonl',
    },
    schemaVersion: 1,
  };

  const descriptor = describeProductionRecoveryJournal(writer);

  assert.deepEqual(descriptor, {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact: false,
    leaseFence: null,
    writerLease: { id: 'lease-writer' },
    journalPath: null,
    artifactRefs: {
      journal: null,
      remote: null,
    },
    schemaVersion: 1,
  });
});

test('production recovery journal descriptor fails closed when remote ownership collapses to the journal path', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    leaseFence: { id: 'lease-shared' },
    writerLease: { id: 'lease-shared' },
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: '/var/lib/reprint/recovery.jsonl',
    },
    schemaVersion: 1,
  };

  const descriptor = describeProductionRecoveryJournal(writer);

  assert.deepEqual(descriptor, {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact: false,
    leaseFence: { id: 'lease-shared' },
    writerLease: { id: 'lease-shared' },
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: null,
    },
    schemaVersion: 1,
  });
});

test('production recovery journal descriptor fails closed on divergent lease epochs', () => {
  const writer = {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    leaseFence: { id: 'lease-shared', epoch: 4 },
    writerLease: { id: 'lease-shared', epoch: 3 },
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: '/var/lib/reprint/recovery-remote.jsonl',
    },
    schemaVersion: 1,
  };

  const descriptor = describeProductionRecoveryJournal(writer);

  assert.deepEqual(descriptor, {
    kind: 'production-recovery-journal',
    productionAdapter: true,
    supportedSurface: 'production-recovery-journal-adapter',
    restartReadable: true,
    ownsJournal: true,
    ownsRemoteArtifact: true,
    leaseFence: null,
    writerLease: { id: 'lease-shared', epoch: 3 },
    journalPath: '/var/lib/reprint/recovery.jsonl',
    artifactRefs: {
      journal: '/var/lib/reprint/recovery.jsonl',
      remote: '/var/lib/reprint/recovery-remote.jsonl',
    },
    schemaVersion: 1,
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
    writerLease: { id: 'claim-1' },
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
    writerLease: { id: 'claim-2' },
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

test('production recovery journal adapter fails closed when claimId is omitted even with a writer lease', () => {
  const filePath = tempJournalPath();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      writerLease: { id: 'lease-without-claim' },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
    message: 'Production recovery journal support requires an explicit claimId.',
  });
});

test('production recovery journal adapter fails closed when writerLease epoch is not an integer', () => {
  const filePath = tempJournalPath();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      writerLease: { id: 'lease-1', epoch: 'bad-epoch' },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal adapter fails closed when claimId and writerLease identity diverge', () => {
  const filePath = tempJournalPath();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      claimId: 'claim-1',
      writerLease: { id: 'lease-1' },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
    message: 'Production recovery journal support requires claimId to match writerLease.id.',
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

test('production recovery journal adapter fails closed when remote artifact ownership reuses the journal path', () => {
  const filePath = tempJournalPath();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      claimId: 'lease-same-path',
      writerLease: { id: 'lease-same-path' },
      ownsRemoteArtifact: true,
      remoteArtifactPath: filePath,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
    message: 'Production recovery journal support requires a distinct owned remote artifact path.',
  });
});

test('production recovery journal adapter fails closed when persisted journal ownership points at a different file', () => {
  const filePath = tempJournalPath();
  const mismatchedJournalPath = `${filePath}.moved`;
  const journal = openProductionRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId: 'claim-mismatched-persisted-journal',
    writerLease: { id: 'claim-mismatched-persisted-journal' },
  });

  appendRecoveryClaimOpened(journal, {
    plan: { id: 'plan-mismatched-persisted-journal' },
    current: baseSite(),
    claimId: 'claim-mismatched-persisted-journal',
    artifactRefs: {
      journal: filePath,
    },
  });
  journal.appendEvent('journal-opened', {
    planId: 'plan-mismatched-persisted-journal',
    state: 'opened',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {
      journal: mismatchedJournalPath,
    },
  });
  journal.close();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      now: fixedNow,
      claimId: 'claim-mismatched-persisted-journal',
      writerLease: { id: 'claim-mismatched-persisted-journal' },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
    message: 'Production recovery journal persistence includes an invalid owned journal artifact path.',
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

test('production recovery journal adapter accepts canonical remote artifact ownership metadata', () => {
  const filePath = tempJournalPath();
  const remoteArtifactPath = `${filePath}.remote`;
  const journal = openProductionRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    claimId: 'lease-1',
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

test('production recovery journal compatibility overload supports reliable release consumer shape', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-compat';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });

  assert.equal(journal.ownsRemoteArtifact, true);
  assert.equal(journal.writerLease.id, claimId);
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.close();

  const inspection = consumeProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });

  assert.equal(inspection.consumed, true);
  assert.equal(inspection.journal.kind, 'production-recovery-journal');
  assert.equal(inspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(inspection.journal.supportedSurface, 'production-recovery-journal-adapter');
  assert.equal(inspection.journal.ownsJournal, true);
  assert.equal(inspection.journal.ownsRemoteArtifact, true);
  assert.equal(inspection.journal.consumed, true);
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.journalPath, filePath);
  assert.deepEqual(inspection.journal.artifactRefs, artifactRefs);
  assert.deepEqual(inspection.journal.checked, [filePath]);
  assert.deepEqual(inspection.journal.writerLease, { id: claimId });
  assert.deepEqual(inspection.journal.leaseFence, { id: claimId });
  assert.equal(inspection.leaseFence.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.leaseFence.fsyncEvidence, true);
  assert.equal(inspection.leaseFence.monotonicSequence, true);
  assert.equal(inspection.leaseFence.staleClaimRejected, false);

  const staleJournal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    truncate: false,
    claimId: 'claim-stale',
  });
  assert.throws(() => {
    staleJournal.appendEvent('journal-opened', {
      planId: plan.id,
      state: 'opened',
      observedHash: 'snapshot-hash-only',
      artifactRefs,
    });
  }, {
    name: 'RecoveryJournalClaimStaleError',
    code: 'RECOVERY_CLAIM_STALE',
  });
  staleJournal.close();
});

test('production recovery journal compatibility overload fails closed without an explicit claimId or writerLease', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;

  assert.throws(() => {
    openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        journal: filePath,
        remote: remoteArtifactPath,
      },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal consumption fails closed without an explicit claimId or writerLease', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-explicit-for-open';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal consumption fails closed when claimId and writerLease identity diverge', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-opened';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      claimId,
      writerLease: { id: 'lease-mismatch' },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
    message: 'Production recovery journal support requires claimId to match writerLease.id.',
  });
});

test('production recovery journal consumption fails closed when the persisted lease epoch diverges from the fenced writer', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'claim-epoch-mismatch';
  const artifactRefs = {
    journal: filePath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
    writerLease: { id: claimId, epoch: 2 },
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      claimId,
      writerLease: { id: claimId, epoch: 3 },
    });
  }, {
    name: 'RecoveryJournalClaimStaleError',
    code: 'RECOVERY_CLAIM_STALE',
    message: 'Recovery journal lease fence was superseded before this fenced writer could append.',
  });
});

test('production recovery journal compatibility overload fails closed when artifact refs are inherited through the prototype', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const options = {
    filePath,
    plan,
    current: remote,
    claimId: 'claim-prototype-artifact-refs',
  };
  Object.setPrototypeOf(options, {
    artifactRefs: {
      journal: filePath,
      remote: remoteArtifactPath,
    },
  });

  assert.throws(() => {
    openProductionRecoveryJournal(options);
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal compatibility overload fails closed when artifact refs use a null prototype', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;

  assert.throws(() => {
    openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      claimId: 'claim-null-prototype-artifact-refs',
      artifactRefs: Object.assign(Object.create(null), {
        journal: filePath,
        remote: remoteArtifactPath,
      }),
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal consumption fails closed when compatibility overload artifact refs are inherited through the prototype', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-prototype-consume-artifact-refs';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.close();

  const consumeOptions = {
    filePath,
    plan,
    current: remote,
    claimId,
  };
  Object.setPrototypeOf(consumeOptions, {
    artifactRefs,
  });

  assert.throws(() => {
    consumeProductionRecoveryJournal(consumeOptions);
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal consumption fails closed when compatibility overload artifact refs use a null prototype', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-consume-null-prototype-artifact-refs';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      claimId,
      artifactRefs: Object.assign(Object.create(null), artifactRefs),
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal consumption fails closed when explicit owned remote artifact path reuses the journal path', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'claim-consume-same-path';
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      journal: filePath,
    },
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs: {
      journal: filePath,
    },
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      claimId,
      writerLease: { id: claimId },
      ownsRemoteArtifact: true,
      remoteArtifactPath: filePath,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
    message: 'Production recovery journal consumption requires a distinct owned remote artifact path.',
  });
});

test('production recovery journal consumption fails closed when persisted remote ownership aliases the owned journal path', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'claim-consume-persisted-remote-alias';
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      journal: filePath,
    },
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs: {
      journal: filePath,
    },
  });
  journal.appendEvent('recovery-state', {
    planId: plan.id,
    state: 'blocked-recovery',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {
      remote: filePath,
    },
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      claimId,
      writerLease: { id: claimId },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
    message: 'Production recovery journal persistence includes an invalid owned remote artifact path.',
  });
});

test('production recovery journal adapter fails closed when writer leases use a null prototype', () => {
  const filePath = tempJournalPath();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      writerLease: Object.assign(Object.create(null), { id: 'lease-null-prototype' }),
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal consumption surfaces stale claim advancement after a fenced takeover', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };

  const firstJournal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId: 'claim-1',
  });
  appendRecoveryClaimOpened(firstJournal, {
    plan,
    current: remote,
    claimId: 'claim-1',
    artifactRefs,
  });
  firstJournal.close();

  const secondJournal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    truncate: false,
    claimId: 'claim-2',
  });
  appendStaleClaimAdvanced(secondJournal, {
    plan,
    current: remote,
    previousClaimId: 'claim-1',
    claimId: 'claim-2',
    staleThresholdMs: 30_000,
    previousClaimAgeMs: 30_001,
    artifactRefs,
  });
  secondJournal.close();

  const inspection = consumeProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId: 'claim-2',
  });

  assert.equal(inspection.consumed, true);
  assert.equal(inspection.journal.consumed, true);
  assert.equal(inspection.journal.staleClaimRejected, true);
  assert.equal(inspection.journal.claimHash, recoveryClaimHash('claim-2'));
  assert.deepEqual(inspection.journal.writerLease, { id: 'claim-2' });
  assert.deepEqual(inspection.journal.leaseFence, { id: 'claim-2' });
  assert.equal(inspection.leaseFence.staleClaimRejected, true);
  assert.equal(inspection.leaseFence.fsyncEvidence, true);
  assert.equal(inspection.leaseFence.monotonicSequence, true);
});

test('production recovery journal consumption fails closed when stale claim advancement reuses the same claim hash', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId: 'claim-self-advanced',
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId: 'claim-self-advanced',
    artifactRefs,
  });
  appendStaleClaimAdvanced(journal, {
    plan,
    current: remote,
    previousClaimId: 'claim-self-advanced',
    claimId: 'claim-self-advanced',
    staleThresholdMs: 30_000,
    previousClaimAgeMs: 30_001,
    artifactRefs,
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      claimId: 'claim-self-advanced',
    });
  }, {
    name: 'RecoveryJournalClaimStaleError',
    code: 'RECOVERY_CLAIM_STALE',
    message: 'Recovery journal claim was superseded before this fenced writer could append.',
  });
});

test('production recovery journal compatibility overload fails closed when the consumed journal artifact ref diverges from the owned path', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-bad-journal-ref';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        journal: '/tmp/not-the-owned-recovery-journal.jsonl',
        remote: remoteArtifactPath,
      },
      claimId,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal compatibility overload fails closed when the opened journal artifact ref diverges from the owned path', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;

  assert.throws(() => {
    openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      claimId: 'claim-open-bad-journal-ref',
      artifactRefs: {
        journal: '/tmp/not-the-owned-recovery-journal.jsonl',
        remote: remoteArtifactPath,
      },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal compatibility overload fails closed when the consumed remote artifact ref diverges from the owned path', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-bad-remote-ref';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        journal: filePath,
        remote: '/tmp/not-the-owned-remote-artifact.jsonl',
      },
      claimId,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal reopen fails closed when persisted remote artifact ownership is omitted', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-missing-remote-ref';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.close();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: false,
      now: fixedNow,
      claimId,
      writerLease: { id: claimId },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal consumption fails closed when persisted remote artifact ownership is omitted', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-consume-missing-remote-ref';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      claimId,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal reopen fails closed when a later persisted record drops owned remote artifact refs', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-late-dropped-remote-ref';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.appendEvent('recovery-state', {
    planId: plan.id,
    state: 'blocked-recovery',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {
      journal: filePath,
    },
  });
  journal.close();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: false,
      now: fixedNow,
      claimId,
      writerLease: { id: claimId },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal consumption fails closed when a later persisted record drops owned remote artifact refs', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-consume-late-dropped-remote-ref';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.appendEvent('recovery-state', {
    planId: plan.id,
    state: 'blocked-recovery',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {
      journal: filePath,
    },
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      claimId,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal reopen fails closed when a later persisted record explicitly clears the owned remote artifact ref', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-late-cleared-remote-ref';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.appendEvent('recovery-state', {
    planId: plan.id,
    state: 'blocked-recovery',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {
      journal: filePath,
      remote: null,
    },
  });
  journal.close();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: false,
      now: fixedNow,
      claimId,
      writerLease: { id: claimId },
      ownsRemoteArtifact: true,
      remoteArtifactPath,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal consumption fails closed when a later persisted record explicitly clears the owned remote artifact ref', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const remoteArtifactPath = `${filePath}.remote`;
  const claimId = 'claim-consume-late-cleared-remote-ref';
  const artifactRefs = {
    journal: filePath,
    remote: remoteArtifactPath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.appendEvent('recovery-state', {
    planId: plan.id,
    state: 'blocked-recovery',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {
      journal: filePath,
      remote: null,
    },
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      claimId,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal reopen fails closed when a later persisted record explicitly clears the owned journal artifact ref', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'claim-late-cleared-journal-ref';
  const artifactRefs = {
    journal: filePath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.appendEvent('recovery-state', {
    planId: plan.id,
    state: 'blocked-recovery',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {
      journal: null,
    },
  });
  journal.close();

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: false,
      now: fixedNow,
      claimId,
      writerLease: { id: claimId },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal consumption fails closed when a later persisted record explicitly clears the owned journal artifact ref', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'claim-consume-late-cleared-journal-ref';
  const artifactRefs = {
    journal: filePath,
  };
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
  });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId,
    artifactRefs,
  });
  journal.appendEvent('recovery-state', {
    planId: plan.id,
    state: 'blocked-recovery',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {
      journal: null,
    },
  });
  journal.close();

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      claimId,
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
  });
});

test('production recovery journal reopen fails closed when persisted journal integrity is blocked', () => {
  const filePath = tempJournalPath();
  fs.writeFileSync(filePath, '{"sequence":1,"schemaVersion":1,"type":"journal-opened"}');

  assert.throws(() => {
    openProductionRecoveryJournal(filePath, {
      truncate: false,
      now: fixedNow,
      claimId: 'claim-corrupt-reopen',
      writerLease: { id: 'claim-corrupt-reopen' },
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
    message: 'Production recovery journal persistence is corrupt or truncated.',
  });
});

test('production recovery journal consumption fails closed when persisted journal integrity is blocked', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  fs.writeFileSync(filePath, '{"sequence":1,"schemaVersion":1,"type":"journal-opened"}');

  assert.throws(() => {
    consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      claimId: 'claim-corrupt-consume',
    });
  }, {
    name: 'UnsupportedProductionRecoveryJournalError',
    code: 'UNSUPPORTED_PRODUCTION_RECOVERY_JOURNAL',
    message: 'Production recovery journal persistence is corrupt or truncated.',
  });
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
