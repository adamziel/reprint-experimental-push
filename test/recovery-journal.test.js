import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendJournalCompleted,
  appendRecoveryClaimOpened,
  appendMutationObserved,
  assertJournalRecordHasNoRawValues,
  checkedDurableJournalBoundarySatisfied,
  productionRecoveryJournalInspectionSurfaceIsPresent,
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
  assert.equal(inspection.journal.ownsJournal, true);
  assert.equal(inspection.journal.claimId, 'production-claim-01');
  assert.equal(inspection.journal.claimHash, recoveryClaimHash('production-claim-01'));
  assert.equal(inspection.journal.consumed, false);
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.schemaVersion, 1);
  assert.equal(inspection.leaseFence.staleClaimRejected, false);

  journal.close();

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.records[0].type, 'journal-opened');
  assert.equal(restarted.records[0].artifactRefs.releaseProof, 'artifact://release-proof-1');
  assert.equal(restarted.records.filter((record) => record.type === 'recovery-claim-opened').length, 1);
  assert.equal(restarted.records.at(-1).type, 'recovery-claim-opened');
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
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.deepEqual(inspection.journal.ownership, {
    ownsJournal: true,
    restartReadable: true,
    productionAdapter: 'filesystem-compare-rename',
    supportedSurface: 'claim-fenced-restart-readable',
  });
  assert.deepEqual(inspection.journal.storageGuard, {
    boundary: 'filesystem-compare-rename',
    operation: 'update',
    outcome: 'applied',
  });
  assert.equal(inspection.journal.claim?.status, 'advanced');
  assert.equal(inspection.journal.claim?.activeClaimId, activeClaimId);
  assert.equal(inspection.journal.claim?.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.journal.claim?.type, 'recovery-claim-opened');
  assert.equal(inspection.journal.writerLease?.strategy, 'claim-fenced-single-writer');
  assert.equal(inspection.journal.writerLease?.claimId, activeClaimId);
  assert.equal(inspection.journal.writerLease?.claimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.journal.writerLease?.claimKeyUnique, true);
  assert.equal(inspection.journal.writerLease?.fsyncEvidence, true);
  assert.equal(inspection.journal.writerLease?.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.journal.writerLease?.monotonicSequence, true);
  assert.equal(inspection.journal.writerLease?.restartReadable, true);
  assert.equal(inspection.journal.writerLease?.staleClaimRejected, true);
  assert.equal(inspection.journal.leaseFence?.boundary, 'filesystem-compare-rename');
  assert.equal(inspection.journal.leaseFence?.claimKeyUnique, true);
  assert.equal(inspection.journal.leaseFence?.fsyncEvidence, true);
  assert.equal(inspection.journal.leaseFence?.monotonicSequence, true);
  assert.equal(inspection.journal.leaseFence?.restartReadable, true);
  assert.equal(inspection.journal.leaseFence?.staleClaimRejected, true);
  assert.equal(inspection.journal.leaseFence?.writerLease?.claimId, activeClaimId);
  assert.equal(
    inspection.journal.leaseFence?.writerLease?.claimHash,
    recoveryClaimHash(activeClaimId),
  );
  assert.deepEqual(inspection.claim, inspection.journal.claim);
  assert.deepEqual(inspection.leaseFence, inspection.journal.leaseFence);
  assert.equal(inspection.leaseFence.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.leaseFence.staleClaimRejected, true);
});

test('production recovery journal wrapper rejects reopened plan ids that drift from the active claim evidence', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const originalPlan = planFor(baseSite(), localSite(), remote);
  const driftedPlan = {
    ...clone(originalPlan),
    id: `${originalPlan.id}-drifted`,
  };
  const claimId = 'production-claim-plan-id-01';

  const journal = openProductionRecoveryJournal({
    filePath,
    plan: originalPlan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-plan-id',
    },
    now: fixedNow,
    claimId,
  });
  journal.close();

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan: driftedPlan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-plan-id',
      },
      now: fixedNow,
      truncate: false,
      claimId,
    }),
    /openProductionRecoveryJournal\(\) requires plan\.id to match the persisted active claim evidence when reopening a claim-fenced production recovery journal\./,
  );
});

test('production recovery journal wrapper rejects restart when the persisted active-claim plan id is missing', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'production-claim-plan-id-02';

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-plan-id-missing',
    },
    now: fixedNow,
    claimId,
  });
  journal.close();

  const persisted = readRecoveryJournal(filePath);
  const claimRecord = persisted.records.find(
    (record) => record.type === 'recovery-claim-opened' && record.claimId === claimId,
  );
  assert.ok(claimRecord);
  delete claimRecord.planId;
  fs.writeFileSync(
    filePath,
    `${persisted.records.map((record) => JSON.stringify(record)).join('\n')}\n`,
  );

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-plan-id-missing',
      },
      now: fixedNow,
      truncate: false,
      claimId,
    }),
    /openProductionRecoveryJournal\(\) requires plan\.id to match the persisted active claim evidence when reopening a claim-fenced production recovery journal\./,
  );
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

test('checked durable journal boundary stays closed until stale-claim rejection is proven on the lease fence', () => {
  const activeClaimId = 'retry-claim-id-02';
  const previousClaimId = 'retry-claim-id-01';
  const activeClaimKeyHash = 'a'.repeat(64);
  const previousClaimKeyHash = 'b'.repeat(64);
  const baseContract = {
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    latestRows: [
      {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimId: activeClaimId,
      },
      {
        sequence: 18,
        event: 'stale-claim-abandoned',
        claimId: previousClaimId,
      },
    ],
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId,
      activeClaimKeyHash,
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      previousClaimId,
      previousClaimHash: recoveryClaimHash(previousClaimId),
      previousClaimKeyHash,
      previousClaimSequence: 11,
      previousClaimEvent: 'idempotency-opened',
      previousStartedSequence: null,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimId: activeClaimId,
      claimKeyHash: activeClaimKeyHash,
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      fsyncEvidence: true,
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimId: activeClaimId,
        claimKeyHash: activeClaimKeyHash,
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
  };

  assert.equal(checkedDurableJournalBoundarySatisfied(baseContract), false);
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    true,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        staleClaimRejected: false,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
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
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        activeClaimEvent: 'idempotency-opened',
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        activeClaimId: '',
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        previousClaimHash: undefined,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        previousClaimHash: recoveryClaimHash('drifted-previous-claim-id'),
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  const inheritedClaimMarkers = {
    ...baseContract,
    claim: Object.assign(
      Object.create({
        activeClaimId: baseContract.claim.activeClaimId,
        activeClaimKeyHash: baseContract.claim.activeClaimKeyHash,
        activeClaimSequence: baseContract.claim.activeClaimSequence,
        activeClaimEvent: baseContract.claim.activeClaimEvent,
      }),
      baseContract.claim,
    ),
    leaseFence: {
      ...baseContract.leaseFence,
      staleClaimRejected: true,
    },
  };
  delete inheritedClaimMarkers.claim.activeClaimId;
  delete inheritedClaimMarkers.claim.activeClaimKeyHash;
  delete inheritedClaimMarkers.claim.activeClaimSequence;
  delete inheritedClaimMarkers.claim.activeClaimEvent;
  assert.equal(
    checkedDurableJournalBoundarySatisfied(inheritedClaimMarkers),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      writerLease: {
        ...baseContract.writerLease,
        claimId: 'unexpected-claim-id',
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      writerLease: {
        ...baseContract.writerLease,
        claimKeyHash: 'unexpected-claim-key-hash',
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          claimId: 'unexpected-claim-id',
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          claimKeyHash: 'unexpected-claim-key-hash',
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
        fsyncEvidence: false,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          storageGuard: 'filesystem-compare-rename',
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      scope: 'checked live production-shaped recovery journal surface; not local Playground fixture only',
      storageGuard: undefined,
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    true,
  );
});
