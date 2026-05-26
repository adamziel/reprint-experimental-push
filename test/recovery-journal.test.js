import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendJournalCompleted,
  appendMutationObserved,
  assertJournalRecordHasNoRawValues,
  createUnsupportedProductionRecoveryJournal,
  openPlanRecoveryJournal,
  openProductionRecoveryJournal,
  openRecoveryJournal,
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
  const journal = openProductionRecoveryJournal(filePath, {
    truncate: true,
    now: fixedNow,
    writerLease: { id: 'lease-1' },
  });

  assert.equal(journal.kind, 'production-recovery-journal');
  assert.equal(journal.productionAdapter, true);
  assert.equal(journal.supportedSurface, 'production-recovery-journal-adapter');
  assert.equal(journal.restartReadable, true);
  assert.equal(journal.ownsJournal, true);
  assert.equal(journal.journalPath, filePath);
  assert.equal(journal.schemaVersion, 1);
  assert.deepEqual(journal.artifactRefs, { journal: filePath, remote: null });

  journal.flush();
  journal.assertCurrentClaim('production-recovery-journal');
  journal.appendEvent('journal-opened', {
    planId: plan.id,
    state: 'opened',
    observedHash: 'snapshot-hash-only',
    artifactRefs: { journal: filePath },
  });
  journal.close();

  const inspected = journal.inspect();
  assert.equal(inspected.filePath, filePath);
  assert.equal(inspected.schemaVersion, 1);
  assert.equal(inspected.records.at(-1).type, 'journal-opened');
  assert.deepEqual(inspected.artifactRefs, { journal: filePath });
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
