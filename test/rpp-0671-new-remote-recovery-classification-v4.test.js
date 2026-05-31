import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPushPlan } from '../src/planner.js';
import {
  RECOVERY_INSPECT_REASON_CODES,
  inspectRecoveryJournal,
} from '../src/recovery-inspect.js';
import {
  appendJournalCompleted,
  appendMutationObserved,
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
} from '../src/recovery-journal.js';
import {
  deserializeResourceValue,
  resourceHash,
  setResource,
} from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const generatedNewRemoteCases = Object.freeze([
  {
    id: 'rpp-0671-new-remote-four-v4',
    mutationCount: 4,
  },
  {
    id: 'rpp-0671-new-remote-six-v4',
    mutationCount: 6,
  },
]);

function tempJournalPath(prefix = 'reprint-rpp-0671-new-remote-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0671-new-remote-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const preservedBeforePlanKey = `${generatedCase.id}-remote-preserved-before-plan.txt`;
  const preservedAfterCrashKey = `${generatedCase.id}-remote-preserved-after-crash.txt`;
  const base = {
    files: {
      [preservedBeforePlanKey]: `base-raw-rpp-0671-${generatedCase.id}-preserved-before-plan`,
      [preservedAfterCrashKey]: `base-raw-rpp-0671-${generatedCase.id}-preserved-after-crash`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-raw-rpp-0671-${generatedCase.id}-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-raw-rpp-0671-${generatedCase.id}-target-${index}`;
  }
  remote.files[preservedBeforePlanKey] =
    `remote-raw-rpp-0671-${generatedCase.id}-preserved-before-plan`;

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);

  const current = cloneJson(remote);
  applyMutations(current, plan);
  current.files[preservedAfterCrashKey] =
    `remote-raw-rpp-0671-${generatedCase.id}-preserved-after-crash`;

  return {
    plan,
    remote,
    current,
    preservedBeforePlanKey,
    preservedAfterCrashKey,
    preservedBeforePlanValue: remote.files[preservedBeforePlanKey],
    preservedAfterCrashValue: current.files[preservedAfterCrashKey],
    rawSiteValues: rawSiteValuesFor(base, local, remote, current),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'base-raw-rpp-0671',
    'local-raw-rpp-0671',
    'remote-raw-rpp-0671',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function applyMutations(site, plan) {
  for (const mutation of plan.mutations) {
    setResource(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
}

function artifactRefsFor(generatedCase) {
  return {
    recoverySupport: `artifact://rpp-0671/${generatedCase.id}/local-new-remote-classification-v4`,
    durabilityScope: `artifact://rpp-0671/${generatedCase.id}/sandbox-sqlite-only`,
  };
}

function claimIdFor(generatedCase) {
  return `${generatedCase.id}-claim`;
}

function writeCompletedJournal({
  filePath,
  plan,
  remote,
  current,
  artifactRefs,
  claimId,
}) {
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    truncate: true,
    claimId,
  });

  try {
    for (const mutation of plan.mutations) {
      appendMutationObserved(journal, {
        plan,
        mutation,
        current,
        state: 'applied',
        artifactRefs,
      });
    }
    appendJournalCompleted(journal, { plan, current, artifactRefs });
    return journal.inspect();
  } finally {
    journal.close();
  }
}

function writeSqliteJournalTable(database, records) {
  database.exec(`CREATE TABLE recovery_journal (
    sequence INTEGER PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    record_json TEXT NOT NULL
  )`);
  const insert = database.prepare(
    'INSERT INTO recovery_journal (sequence, schema_version, record_json) VALUES (?, ?, ?)',
  );
  for (const record of records) {
    insert.run(record.sequence, record.schemaVersion, JSON.stringify(record));
  }
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function expectedSequences(totalRecords) {
  return Array.from({ length: totalRecords }, (_, index) => index + 1);
}

function assertPlanPreservesRemoteOnlyResources({
  plan,
  preservedBeforePlanKey,
  preservedAfterCrashKey,
}) {
  for (const key of [preservedBeforePlanKey, preservedAfterCrashKey]) {
    assert.equal(
      plan.mutations.some((mutation) => mutation.resourceKey === `file:${key}`),
      false,
      `${key} must stay out of recovery mutations`,
    );
    assert.equal(
      plan.preconditions.some((precondition) => precondition.resourceKey === `file:${key}`),
      false,
      `${key} must stay out of recovery preconditions`,
    );
  }

  const preservedDecision = plan.decisions.find(
    (decision) => decision.resourceKey === `file:${preservedBeforePlanKey}`,
  );
  assert.ok(preservedDecision);
  assert.equal(preservedDecision.decision, 'keep-remote');
  assert.match(preservedDecision.remoteHash, hashPattern);
}

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0671 evidence') {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `${label} leaked raw site value: ${rawValue}`,
    );
  }
}

function assertHashOnlyJournalRows(records, rawSiteValues) {
  for (const record of records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
    assert.equal(Object.hasOwn(record, 'beforeValue'), false);
    assert.equal(Object.hasOwn(record, 'afterValue'), false);
    for (const field of [
      'observedHash',
      'beforeHash',
      'afterHash',
      'claimHash',
      'previousClaimHash',
      'journalIdentityHash',
    ]) {
      if (record[field] !== undefined && record[field] !== null) {
        assert.match(record[field], hashPattern, `${field} must be SHA-256-shaped`);
      }
    }
  }
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0671 journal rows');
}

function assertSqliteCompletedJournal(restarted, { plan, seeded, rawSiteValues }) {
  assert.equal(restarted.storage, 'sqlite');
  assert.equal(restarted.integrity.status, 'ok');
  assert.deepEqual(restarted.records, seeded.records);
  assert.equal(restarted.schemaVersionColumnPresent, true);
  assert.deepEqual(restarted.tableSchemaVersions, [1]);
  assert.deepEqual(restarted.recordSchemaVersions, [1]);
  assert.equal(restarted.committedState.status, 'completed');
  assert.equal(restarted.committedState.restartReadable, true);
  assert.equal(restarted.committedState.mutationRows, plan.mutations.length);
  assert.equal(restarted.committedState.completedRows, 1);
  assert.equal(restarted.committedState.targetRows, plan.mutations.length);
  assert.equal(restarted.committedState.committedTargetRows, plan.mutations.length);
  assert.deepEqual(restarted.committedState.targetEnvelope, {
    plannedTargets: plan.mutations.length,
    committedTargets: plan.mutations.length,
    allCommittedTargetsHaveHashes: true,
    allTargetsCommitted: true,
  });
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    expectedSequences(restarted.records.length),
  );
  assert.equal(recordsOfType(restarted.records, 'target-planned').length, plan.mutations.length);
  assert.equal(recordsOfType(restarted.records, 'mutation-observed').length, plan.mutations.length);
  assert.equal(recordsOfType(restarted.records, 'journal-completed').length, 1);
  assert.ok(restarted.records.every((record) => record.fsync.requested === true));
  assertHashOnlyJournalRows(restarted.records, rawSiteValues);
}

function assertNewRemoteRecoveryState(inspection, {
  plan,
  current,
  rawSiteValues,
}) {
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.fullyUpdatedRemote);
  assert.equal(inspection.reason, 'Every planned target currently matches its journaled after hash.');
  assert.deepEqual(inspection.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
  });
  assert.deepEqual(inspection.classification, {
    state: 'fully-updated-remote',
    reasonCode: RECOVERY_INSPECT_REASON_CODES.fullyUpdatedRemote,
    journalIntegrity: 'ok',
    durableRows: inspection.journal.records.length,
    retry: 'no-op',
    targetEnvelope: {
      total: plan.mutations.length,
      old: 0,
      new: plan.mutations.length,
      blockedUnknown: 0,
    },
  });
  assert.deepEqual(inspection.remoteClassification, {
    state: 'new-remote',
    status: 'fully-updated-remote',
    evidence: 'hash-only-before-after-target-envelope',
    allTargetsAccountedFor: true,
  });
  assert.deepEqual(inspection.remoteRecoveryClassification, {
    kind: 'new-remote',
    state: 'fully-updated-remote',
    proved: true,
    replaySafe: true,
    counts: {
      old: 0,
      new: plan.mutations.length,
      blockedUnknown: 0,
      total: plan.mutations.length,
    },
    journalState: 'ok',
    storage: 'sqlite',
  });
  assert.equal(inspection.journal.storage, 'sqlite');
  assert.equal(inspection.journal.committedState.status, 'completed');
  assert.equal(inspection.journal.committedState.restartReadable, true);
  assert.equal(inspection.targets.length, plan.mutations.length);
  for (const target of inspection.targets) {
    const mutation = plan.mutations.find((candidate) => candidate.id === target.mutationId);
    assert.ok(mutation);
    assert.equal(target.state, 'new');
    assert.equal(target.observedHash, resourceHash(current, mutation.resource));
    assert.equal(target.observedHash, target.afterHash);
    assert.notEqual(target.beforeHash, target.afterHash);
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    assert.match(target.observedHash, hashPattern);
  }
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0671 new-remote inspection');
}

function classificationEvidenceFor({ generatedCase, inspection, plan }) {
  const targetEnvelope = {
    total: plan.mutations.length,
    old: inspection.counts.old,
    new: inspection.counts.new,
    blockedUnknown: inspection.counts.blockedUnknown,
    allTargetsAccountedFor: inspection.remoteClassification.allTargetsAccountedFor,
    targets: inspection.targets.map((target) => ({
      mutationId: target.mutationId,
      resourceKey: target.resourceKey,
      state: target.state,
      beforeHash: target.beforeHash,
      afterHash: target.afterHash,
      observedHash: target.observedHash,
    })),
  };
  const payload = {
    schemaVersion: 1,
    issue: 'RPP-0671',
    kind: 'new-remote-recovery-classification',
    variant: 4,
    generatedCase: generatedCase.id,
    planId: plan.id,
    observedAt: fixedNow.toISOString(),
    status: inspection.status,
    reasonCode: inspection.reasonCode,
    remoteClassification: inspection.remoteClassification,
    remoteRecoveryClassification: inspection.remoteRecoveryClassification,
    targetEnvelope,
    recoveryState: {
      committedState: inspection.journal.committedState.status,
      restartReadable: inspection.journal.committedState.restartReadable,
      storage: inspection.journal.storage,
      integrityStatus: inspection.journal.integrity.status,
      targetRows: inspection.journal.committedState.targetRows,
      committedTargetRows: inspection.journal.committedState.committedTargetRows,
      completedRows: inspection.journal.committedState.completedRows,
    },
    journal: {
      storage: inspection.journal.storage,
      integrityStatus: inspection.journal.integrity.status,
      durableRows: inspection.journal.records.length,
      rowsHash: digest(inspection.journal.records),
    },
    hashOnly: true,
    rawValuesIncluded: false,
    supportOnly: true,
  };

  return {
    ...payload,
    evidenceHash: digest(payload),
  };
}

function assertClassificationEvidence(evidence, { generatedCase, plan, rawSiteValues }) {
  const { evidenceHash, ...payload } = evidence;
  assert.equal(evidenceHash, digest(payload));
  assert.equal(evidence.issue, 'RPP-0671');
  assert.equal(evidence.variant, 4);
  assert.equal(evidence.generatedCase, generatedCase.id);
  assert.equal(evidence.planId, plan.id);
  assert.equal(evidence.hashOnly, true);
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.supportOnly, true);
  assert.equal(evidence.status, 'fully-updated-remote');
  assert.equal(evidence.reasonCode, RECOVERY_INSPECT_REASON_CODES.fullyUpdatedRemote);
  assert.equal(evidence.remoteClassification.state, 'new-remote');
  assert.equal(evidence.remoteRecoveryClassification.kind, 'new-remote');
  assert.equal(evidence.remoteRecoveryClassification.proved, true);
  assert.equal(evidence.remoteRecoveryClassification.replaySafe, true);
  assert.equal(evidence.remoteRecoveryClassification.storage, 'sqlite');
  assert.equal(evidence.recoveryState.committedState, 'completed');
  assert.equal(evidence.recoveryState.restartReadable, true);
  assert.equal(evidence.recoveryState.storage, 'sqlite');
  assert.equal(evidence.recoveryState.integrityStatus, 'ok');
  assert.equal(evidence.recoveryState.targetRows, plan.mutations.length);
  assert.equal(evidence.recoveryState.committedTargetRows, plan.mutations.length);
  assert.equal(evidence.recoveryState.completedRows, 1);
  assert.equal(evidence.targetEnvelope.total, plan.mutations.length);
  assert.equal(evidence.targetEnvelope.old, 0);
  assert.equal(evidence.targetEnvelope.new, plan.mutations.length);
  assert.equal(evidence.targetEnvelope.blockedUnknown, 0);
  assert.equal(evidence.targetEnvelope.allTargetsAccountedFor, true);
  assert.ok(evidence.targetEnvelope.targets.every((target) => target.state === 'new'));
  assert.ok(evidence.targetEnvelope.targets.every((target) => target.observedHash === target.afterHash));
  assert.match(evidence.evidenceHash, hashPattern);
  assert.match(evidence.journal.rowsHash, hashPattern);
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0671 classification evidence');
}

test('RPP-0671 SQLite-backed completed journal proves new-remote recovery state variant 4', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  for (const generatedCase of generatedNewRemoteCases) {
    const filePath = tempJournalPath();
    const sqlitePath = tempSqlitePath();
    fs.chmodSync(path.dirname(filePath), 0o700);
    const {
      plan,
      remote,
      current,
      preservedBeforePlanKey,
      preservedAfterCrashKey,
      preservedBeforePlanValue,
      preservedAfterCrashValue,
      rawSiteValues,
    } = generatedSites(generatedCase);
    const artifactRefs = artifactRefsFor(generatedCase);

    assertPlanPreservesRemoteOnlyResources({
      plan,
      preservedBeforePlanKey,
      preservedAfterCrashKey,
    });

    const writerInspection = writeCompletedJournal({
      filePath,
      plan,
      remote,
      current,
      artifactRefs,
      claimId: claimIdFor(generatedCase),
    });
    assert.equal(writerInspection.journal.restartReadable, true);
    assert.equal(writerInspection.journal.committedState.restartReadable, true);
    assertNoRawSiteValues(writerInspection, rawSiteValues, 'RPP-0671 writer inspection');

    const seeded = readRecoveryJournal(filePath);
    assert.equal(seeded.integrity.status, 'ok');
    assert.equal(seeded.committedState.status, 'completed');
    assert.equal(seeded.committedState.restartReadable, true);
    assertHashOnlyJournalRows(seeded.records, rawSiteValues);

    let database = new DatabaseSync(sqlitePath);
    writeSqliteJournalTable(database, seeded.records);
    database.close();

    database = new DatabaseSync(sqlitePath);
    try {
      const restarted = readSqliteRecoveryJournalTable(database);
      assertSqliteCompletedJournal(restarted, { plan, seeded, rawSiteValues });

      const inspection = inspectRecoveryJournal({
        journal: restarted,
        plan,
        current,
      });
      assertNewRemoteRecoveryState(inspection, { plan, current, rawSiteValues });
      assert.equal(current.files[preservedBeforePlanKey], preservedBeforePlanValue);
      assert.equal(current.files[preservedAfterCrashKey], preservedAfterCrashValue);

      const evidence = classificationEvidenceFor({ generatedCase, inspection, plan });
      assertClassificationEvidence(evidence, { generatedCase, plan, rawSiteValues });

      const unchangedRemoteInspection = inspectRecoveryJournal({
        journal: restarted,
        plan,
        current: remote,
      });
      assert.equal(unchangedRemoteInspection.status, 'old-remote');
      assert.equal(unchangedRemoteInspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.oldRemote);
      assert.deepEqual(unchangedRemoteInspection.counts, {
        old: plan.mutations.length,
        new: 0,
        blockedUnknown: 0,
      });
      assert.ok(unchangedRemoteInspection.targets.every((target) => target.state === 'old'));
      assertNoRawSiteValues(unchangedRemoteInspection, rawSiteValues, 'RPP-0671 old-remote inspection');

      const driftedCurrent = cloneJson(current);
      driftedCurrent.files[`${generatedCase.id}-target-1.txt`] =
        `remote-raw-rpp-0671-${generatedCase.id}-outside-envelope-drift`;
      const driftedInspection = inspectRecoveryJournal({
        journal: restarted,
        plan,
        current: driftedCurrent,
      });
      assert.equal(driftedInspection.status, 'blocked-recovery');
      assert.equal(driftedInspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedTargetUnknown);
      assert.equal(driftedInspection.counts.old, 0);
      assert.equal(driftedInspection.counts.new, plan.mutations.length - 1);
      assert.equal(driftedInspection.counts.blockedUnknown, 1);
      assert.equal(driftedInspection.remoteRecoveryClassification.kind, 'blocked-recovery');
      assert.equal(driftedInspection.remoteRecoveryClassification.proved, false);
      assertNoRawSiteValues(driftedInspection, rawSiteValues, 'RPP-0671 drifted inspection');
    } finally {
      database.close();
    }
  }
});
