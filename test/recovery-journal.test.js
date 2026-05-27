import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendJournalCompleted,
  appendRecoveryClaimOpened,
  appendStaleClaimAdvanced,
  appendMutationObserved,
  assertJournalRecordHasNoRawValues,
  checkedDurableJournalBoundarySatisfied,
  recoveryClaimHash,
  RecoveryJournalClaimStaleError,
  consumeProductionRecoveryJournal,
  openProductionRecoveryJournal,
  openPlanRecoveryJournal,
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

test('file-backed journal fences out stale claims on restart', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const activeClaimId = 'active-journal-claim';
  const staleClaimId = 'stale-journal-claim';

  const journal = openRecoveryJournal(filePath, { now: fixedNow, claimId: activeClaimId });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId: activeClaimId,
  });
  journal.close();

  const reopened = openRecoveryJournal(filePath, {
    claimId: staleClaimId,
    now: fixedNow,
  });

  assert.throws(
    () =>
      reopened.appendEvent('journal-opened', {
        planId: plan.id,
        state: 'opened',
        observedHash: 'snapshot-hash-only',
        artifactRefs: {},
      }),
    RecoveryJournalClaimStaleError,
  );

  reopened.close();
});

test('production recovery journal wrapper writes a restart-readable claim-fenced journal', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-1',
    },
    now: fixedNow,
    claimId: 'production-claim-01',
  });

  const inspection = journal.inspect();
  assert.equal(journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(journal.ownsJournal, true);
  assert.equal(journal.restartReadable, true);
  assert.equal(journal.claimId, 'production-claim-01');
  assert.deepEqual(journal.artifactRefs, {
    releaseProof: 'artifact://release-proof-1',
  });
  assert.equal(inspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.deepEqual(inspection.journal.claim, {
    status: 'active',
    activeClaimId: 'production-claim-01',
    activeClaimHash: recoveryClaimHash('production-claim-01'),
    previousClaimId: null,
    previousClaimHash: null,
    sequence: plan.mutations.length + 2,
    type: 'recovery-claim-opened',
    staleThresholdMs: null,
    previousClaimAgeMs: null,
    reason: 'Production recovery journal claim opened.',
  });
  assert.equal(inspection.journal.ownsJournal, true);
  assert.equal(inspection.journal.claimId, 'production-claim-01');
  assert.equal(inspection.journal.claimHash, recoveryClaimHash('production-claim-01'));
  assert.equal(inspection.journal.consumed, false);
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.schemaVersion, 1);
  assert.deepEqual(inspection.journal.writerLease, {
    strategy: 'claim-fenced-single-writer',
    claimId: 'production-claim-01',
    claimHash: recoveryClaimHash('production-claim-01'),
    claimKeyUnique: true,
    storageGuard: 'filesystem-compare-rename',
    fsyncEvidence: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: false,
  });
  assert.deepEqual(inspection.leaseFence.writerLease, inspection.journal.writerLease);
  assert.equal(inspection.leaseFence.claimKeyUnique, true);
  assert.equal(inspection.leaseFence.staleClaimRejected, false);
  assert.deepEqual(inspection.claim, inspection.journal.claim);

  journal.close();

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.records[0].type, 'journal-opened');
  assert.equal(restarted.records[0].artifactRefs.releaseProof, 'artifact://release-proof-1');
  assert.equal(restarted.records.filter((record) => record.type === 'recovery-claim-opened').length, 1);
  assert.equal(restarted.records.at(-1).type, 'recovery-claim-opened');
  assert.equal(restarted.records.at(-1).claimId, 'production-claim-01');
  assert.equal(restarted.records.at(-1).claimHash.length, 64);

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-2',
      },
      now: fixedNow,
      truncate: false,
      claimId: 'production-claim-02',
    }),
    RecoveryJournalClaimStaleError,
  );

  const recordsAfterStaleRetry = readRecoveryJournal(filePath).records.map((record) => record.type);
  assert.deepEqual(recordsAfterStaleRetry, [
    'journal-opened',
    ...Array.from({ length: plan.mutations.length }, () => 'target-planned'),
    'recovery-claim-opened',
    'stale-claim-rejected',
  ]);
});

test('checked release path consumes the production recovery journal inspection surface', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const activeClaimId = 'production-claim-consumer-01';

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-1',
    },
    claimId: activeClaimId,
  });
  journal.close();

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-stale',
      },
      truncate: false,
      claimId: 'production-claim-consumer-stale',
    }),
    RecoveryJournalClaimStaleError,
  );

  const recordsBeforeConsume = readRecoveryJournal(filePath).records.map((record) => record.type);
  assert.deepEqual(recordsBeforeConsume, [
    'journal-opened',
    ...Array.from({ length: plan.mutations.length }, () => 'target-planned'),
    'recovery-claim-opened',
    'stale-claim-rejected',
  ]);

  const inspection = consumeProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-1',
    },
    claimId: activeClaimId,
  });

  assert.equal(inspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(inspection.journal.ownsJournal, true);
  assert.equal(inspection.journal.claimId, activeClaimId);
  assert.equal(inspection.journal.claimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.journal.consumed, true);
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.staleClaimRejected, true);
  assert.equal(inspection.journal.claim.activeClaimId, activeClaimId);
  assert.equal(inspection.journal.claim.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.journal.claim.previousClaimId, null);
  assert.equal(inspection.claim.activeClaimId, activeClaimId);
  assert.deepEqual(inspection.journal.writerLease, {
    strategy: 'claim-fenced-single-writer',
    claimId: activeClaimId,
    claimHash: recoveryClaimHash(activeClaimId),
    claimKeyUnique: true,
    storageGuard: 'filesystem-compare-rename',
    fsyncEvidence: true,
    monotonicSequence: true,
    restartReadable: true,
    staleClaimRejected: true,
  });
  assert.deepEqual(inspection.leaseFence.writerLease, inspection.journal.writerLease);
  assert.equal(inspection.leaseFence.claimKeyUnique, true);
  assert.equal(inspection.leaseFence.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.leaseFence.restartReadable, true);
  assert.equal(inspection.leaseFence.staleClaimRejected, true);

  const recordsAfterConsume = readRecoveryJournal(filePath).records.map((record) => record.type);
  assert.deepEqual(recordsAfterConsume, [
    ...recordsBeforeConsume,
    'recovery-journal-consumed',
  ]);
});

test('production recovery journal inspection preserves advanced previous-claim identity on restart', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const previousClaimId = 'production-claim-previous-01';
  const activeClaimId = 'production-claim-active-02';

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-advanced-claim',
    },
    now: fixedNow,
    claimId: previousClaimId,
  });
  appendStaleClaimAdvanced(journal, {
    plan,
    current: remote,
    previousClaimId,
    claimId: activeClaimId,
    staleThresholdMs: 30_000,
    previousClaimAgeMs: 45_000,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-advanced-claim',
    },
  });
  journal.close();

  const reopened = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-advanced-claim',
    },
    now: fixedNow,
    truncate: false,
    claimId: activeClaimId,
  });
  const inspection = reopened.inspect();
  reopened.close();

  assert.deepEqual(inspection.claim, {
    status: 'advanced',
    activeClaimId,
    activeClaimHash: recoveryClaimHash(activeClaimId),
    previousClaimId,
    previousClaimHash: recoveryClaimHash(previousClaimId),
    sequence: plan.mutations.length + 3,
    type: 'stale-claim-advanced',
    staleThresholdMs: 30_000,
    previousClaimAgeMs: 45_000,
    reason: 'Previous recovery claim exceeded the stale threshold.',
  });
  assert.deepEqual(inspection.journal.claim, inspection.claim);
  assert.equal(inspection.journal.claimId, activeClaimId);
  assert.equal(inspection.journal.claimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.journal.writerLease.claimId, activeClaimId);
});

test('production recovery journal wrapper rejects hidden open options', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-1',
      },
      claimId: 'production-claim-01',
      claim: {
        id: 'shadow-claim',
      },
    }),
    /openProductionRecoveryJournal\(\) received unsupported option keys: claim/,
  );

  assert.equal(fs.existsSync(filePath), false);
});

test('production recovery journal wrapper requires a non-empty claimId', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-1',
      },
    }),
    /openProductionRecoveryJournal\(\) requires a non-empty claimId for claim-fenced production recovery journals\./,
  );

  assert.equal(fs.existsSync(filePath), false);
});

test('production recovery journal consumer rejects hidden open options', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'production-claim-consumer-01';

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-1',
    },
    claimId,
  });
  journal.close();

  assert.throws(
    () => consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-1',
      },
      claimId,
      truncate: false,
    }),
    /consumeProductionRecoveryJournal\(\) received unsupported option keys: truncate/,
  );
});

test('production recovery journal consumer requires a non-empty claimId', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);

  assert.throws(
    () => consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-1',
      },
    }),
    /consumeProductionRecoveryJournal\(\) requires a non-empty claimId for claim-fenced production recovery journals\./,
  );

  assert.equal(fs.existsSync(filePath), false);
});

test('checked durable journal boundary stays closed until stale-claim rejection is proven on the lease fence', () => {
  const baseContract = {
    schemaVersion: 1,
    acceptedOnCheckedBoundary: true,
    table: 'wp_reprint_push_lab_push_journal',
    rowCount: 1,
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    latestRows: [
      {
        event: 'stale-claim-rejected',
        id: 20,
      },
    ],
    eventSummaries: [
      {
        event: 'stale-claim-rejected',
        count: 1,
        latestId: 20,
      },
    ],
    idempotencyEvidence: [
      {
        idempotencyKeyHash: 'idempotency-hash-01',
        events: 3,
        requestHashes: 1,
        latestId: 20,
      },
    ],
    claim: {
      status: 'stale-claim-rejected',
      activeClaimKeyHash: 'retry-claim-hash-02',
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-retry-started',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
      previousStartedSequence: 12,
      previousClaimSequence: 11,
      previousClaimKeyHash: 'retry-claim-hash-01',
      previousClaimEvent: 'idempotency-opened',
    },
    claimEvidence: {
      activeRow: {
        sequence: 20,
        event: 'stale-claim-retry-started',
        claimKeyHash: 'retry-claim-hash-02',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
      abandonedRow: {
        sequence: 18,
        event: 'stale-claim-abandoned',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
        startedCursor: 'db-journal:12',
        claimCursor: 'db-journal:11',
      },
      previousRow: {
        sequence: 11,
        event: 'idempotency-opened',
        claimKeyHash: 'retry-claim-hash-01',
        idempotencyKeyHash: 'idempotency-hash-01',
        requestHash: 'request-hash-01',
      },
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      claimKeyUnique: true,
      fsyncEvidence: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: false,
      },
    },
  };

  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claimEvidence: undefined,
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [
        {
          event: 'stale-claim-rejected',
          sequence: 20,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    true,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [
        {
          event: 'stale-claim-rejected',
          id: 10,
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 10,
        },
      ],
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        activeClaimSequence: 47,
        activeClaimEvent: 'stale-claim-rejected',
        activeClaimKeyHash: 'retry-claim-hash-03',
        previousClaimKeyHash: 'retry-claim-hash-02',
        previousClaimSequence: 20,
        previousClaimEvent: 'stale-claim-retry-started',
      },
      claimEvidence: {
        ...baseContract.claimEvidence,
        activeRow: {
          ...baseContract.claimEvidence.activeRow,
          sequence: 47,
          event: 'stale-claim-rejected',
          claimKeyHash: 'retry-claim-hash-03',
        },
        previousRow: {
          ...baseContract.claimEvidence.activeRow,
        },
      },
      latestRows: [
        {
          event: 'apply-committed',
          sequence: 48,
        },
        {
          event: 'stale-claim-rejected',
          sequence: 47,
          claimKeyHash: 'retry-claim-hash-02',
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 47,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [
        {
          event: 'apply-committed',
          sequence: 21,
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 20,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [
        {
          event: 'apply-committed',
          sequence: 21,
        },
        {
          event: 'stale-claim-rejected',
          id: 20,
          sequence: 19,
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 10,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [
        {
          event: 'apply-committed',
          sequence: 21,
        },
        {
          event: 'stale-claim-rejected',
          sequence: 20,
          claimKeyHash: 'retry-claim-hash-unrelated',
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
          latestId: 20,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [
        {
          event: 'apply-committed',
          sequence: 21,
        },
        {
          event: 'stale-claim-abandoned',
          sequence: 18,
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
          resourceHashEvidence: {
            startedCursor: 'db-journal:77',
            claimCursor: 'db-journal:66',
          },
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-abandoned',
          count: 1,
          latestId: 18,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 0,
          latestId: 20,
        },
      ],
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claimEvidence: {
        ...baseContract.claimEvidence,
        activeRow: {
          ...baseContract.claimEvidence.activeRow,
          sequence: 21,
        },
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      rowCount: 0,
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [
        {
          id: 20,
          event: 'stale-claim-retry-started',
        },
      ],
      eventSummaries: [
        {
          event: 'stale-claim-retry-started',
          count: 1,
          latestId: 20,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [
        {
          id: 20,
          event: 'apply-committed',
        },
        {
          event: 'stale-claim-rejected',
        },
      ],
      eventSummaries: [
        {
          event: 'apply-committed',
          count: 1,
          latestId: 20,
        },
        {
          event: 'stale-claim-rejected',
          count: 1,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [
        {
          event: 'stale-claim-rejected',
          sequence: 20,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    true,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      eventSummaries: [],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      eventSummaries: [
        {
          event: 'stale-claim-rejected',
          count: 1,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      schemaVersion: undefined,
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(checkedDurableJournalBoundarySatisfied(baseContract), false);
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      idempotencyEvidence: [],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idempotency-hash-other',
          events: 3,
          requestHashes: 1,
          latestId: 20,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idempotency-hash-01',
          events: 3,
          requestHashes: 1,
          latestId: 19,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      idempotencyEvidence: [
        {
          idempotencyKeyHash: 'idempotency-hash-01',
          events: 0,
          requestHashes: 1,
          latestId: 20,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    true,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      latestRows: [
        {
          event: 'apply-committed',
          sequence: 20,
        },
      ],
      eventSummaries: [
        {
          event: 'apply-committed',
          count: 1,
          latestId: 20,
        },
      ],
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'insert',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'rejected',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      storageGuard: {
        boundary: 'filesystem-compare-rename',
        operation: 'update',
        outcome: 'applied',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      claim: {
        ...baseContract.claim,
        status: 'active',
        activeClaimEvent: 'idempotency-opened',
        staleClaimRejected: false,
        abandonedSequence: undefined,
        abandonedEvent: undefined,
        previousStartedSequence: undefined,
        previousClaimSequence: undefined,
        previousClaimKeyHash: undefined,
        previousClaimEvent: undefined,
      },
      claimEvidence: {
        activeRow: {
          sequence: 20,
          event: 'idempotency-opened',
          claimKeyHash: 'retry-claim-hash-02',
          idempotencyKeyHash: 'idempotency-hash-01',
          requestHash: 'request-hash-01',
        },
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    true,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        activeClaimEvent: '',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        activeClaimEvent: 'unsupported-claim-event',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      claim: {
        ...baseContract.claim,
        activeClaimSequence: 0,
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      storageGuard: {
        boundary: 'wpdb-single-statement-cas',
        operation: 'update',
        outcome: 'applied',
      },
      claim: {
        ...baseContract.claim,
        previousClaimSequence: 0,
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        previousStartedSequence: undefined,
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        activeClaimEvent: 'stale-claim-rejected',
        previousStartedSequence: undefined,
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        status: 'active',
        activeClaimEvent: 'stale-claim-rejected',
        staleClaimRejected: false,
        abandonedSequence: undefined,
        abandonedEvent: undefined,
        previousStartedSequence: undefined,
        previousClaimSequence: undefined,
        previousClaimKeyHash: undefined,
        previousClaimEvent: undefined,
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        status: 'stale-claim-rejected',
        activeClaimEvent: 'idempotency-opened',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      acceptedOnCheckedBoundary: false,
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        fsyncEvidence: false,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
          storageGuard: 'filesystem-compare-rename',
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      ownership: {
        ...baseContract.ownership,
        productionAdapter: 'filesystem-compare-rename',
      },
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      writerLease: {
        ...baseContract.writerLease,
        staleClaimRejected: true,
        storageGuard: 'filesystem-compare-rename',
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          staleClaimRejected: true,
          storageGuard: 'filesystem-compare-rename',
        },
      },
    }),
    false,
  );
});
