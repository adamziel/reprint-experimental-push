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
const proofMovementNow = new Date('2026-05-31T00:01:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const generatedNewRemoteCases = Object.freeze([
  {
    id: 'rpp-0651-new-remote-three-v3',
    mutationCount: 3,
  },
  {
    id: 'rpp-0651-new-remote-five-v3',
    mutationCount: 5,
  },
]);

function tempJournalPath(prefix = 'reprint-rpp-0651-new-remote-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0651-new-remote-sqlite-'));
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
      [preservedBeforePlanKey]: `base-raw-rpp-0651-${generatedCase.id}-preserved-before-plan`,
      [preservedAfterCrashKey]: `base-raw-rpp-0651-${generatedCase.id}-preserved-after-crash`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-raw-rpp-0651-${generatedCase.id}-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-raw-rpp-0651-${generatedCase.id}-target-${index}`;
  }
  remote.files[preservedBeforePlanKey] =
    `remote-raw-rpp-0651-${generatedCase.id}-preserved-before-plan`;

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
    `remote-raw-rpp-0651-${generatedCase.id}-preserved-after-crash`;

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
    'base-raw-rpp-0651',
    'local-raw-rpp-0651',
    'remote-raw-rpp-0651',
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
    recoverySupport: `artifact://rpp-0651/${generatedCase.id}/local-new-remote-classification-v3`,
    durabilityScope: `artifact://rpp-0651/${generatedCase.id}/sandbox-sqlite-only`,
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

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0651 evidence') {
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
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0651 journal rows');
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

function assertNewRemoteInspection(inspection, {
  plan,
  current,
  rawSiteValues,
}) {
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.fullyUpdatedRemote);
  assert.deepEqual(inspection.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
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
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0651 new-remote inspection');
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
    issue: 'RPP-0651',
    kind: 'new-remote-recovery-classification',
    variant: 3,
    generatedCase: generatedCase.id,
    planId: plan.id,
    observedAt: fixedNow.toISOString(),
    expiresAt: new Date(fixedNow.getTime() + 5 * 60 * 1000).toISOString(),
    status: inspection.status,
    remoteClassification: inspection.remoteClassification,
    remoteRecoveryClassification: inspection.remoteRecoveryClassification,
    targetEnvelope,
    journal: {
      storage: inspection.journal.storage,
      integrityStatus: inspection.journal.integrity.status,
      durableRows: inspection.journal.records.length,
      completedRows: inspection.journal.committedState.completedRows,
      committedTargetRows: inspection.journal.committedState.committedTargetRows,
      rowsHash: digest(inspection.journal.records),
    },
    hashOnly: true,
    rawValuesIncluded: false,
    supportOnly: true,
  };

  return {
    ...payload,
    classificationHash: digest(payload),
  };
}

function withRecomputedClassificationHash(evidence) {
  const { classificationHash, ...payload } = evidence;
  return {
    ...payload,
    classificationHash: digest(payload),
  };
}

function recoveryProofMovementForNewRemoteClassification({
  evidence,
  plan,
  expectedJournalRowsHash,
  now,
}) {
  const blocked = (reasonCode) => ({
    ok: false,
    moved: false,
    reasonCode,
    releasePosture: 'NO-GO',
    localRecoverySupport: {
      proved: false,
    },
    productionBackedDurableJournalProof: {
      proved: false,
      reasonCode: 'LOCAL_SANDBOX_ONLY',
    },
  });

  if (!evidence) {
    return blocked('NEW_REMOTE_CLASSIFICATION_EVIDENCE_MISSING');
  }
  if (!classificationEvidenceShapeMatches(evidence)) {
    return blocked('NEW_REMOTE_CLASSIFICATION_EVIDENCE_MALFORMED');
  }
  if (evidence.planId !== plan.id || Date.parse(evidence.expiresAt) <= now.getTime()) {
    return blocked('NEW_REMOTE_CLASSIFICATION_EVIDENCE_STALE');
  }
  if (evidence.journal.rowsHash !== expectedJournalRowsHash) {
    return blocked('NEW_REMOTE_CLASSIFICATION_EVIDENCE_DRIFTED');
  }

  const { classificationHash, ...payload } = evidence;
  if (classificationHash !== digest(payload)) {
    return blocked('NEW_REMOTE_CLASSIFICATION_EVIDENCE_DRIFTED');
  }
  if (!classificationEvidenceProvesNewRemote(evidence, plan)) {
    return blocked('NEW_REMOTE_CLASSIFICATION_EVIDENCE_DRIFTED');
  }

  return {
    ok: true,
    moved: true,
    reasonCode: 'NEW_REMOTE_CLASSIFICATION_ACCEPTED',
    releasePosture: 'NO-GO',
    proofHash: digest({
      planId: plan.id,
      classificationHash,
      journalRowsHash: expectedJournalRowsHash,
    }),
    localRecoverySupport: {
      proved: true,
      storage: evidence.journal.storage,
      durableRows: evidence.journal.durableRows,
      state: evidence.status,
      classification: evidence.remoteClassification.state,
    },
    productionBackedDurableJournalProof: {
      proved: false,
      reasonCode: 'LOCAL_SANDBOX_ONLY',
      requiredBoundary: 'live-production-backed-durable-journal',
    },
  };
}

function classificationEvidenceShapeMatches(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return false;
  }
  if (
    evidence.schemaVersion !== 1
    || evidence.kind !== 'new-remote-recovery-classification'
    || evidence.issue !== 'RPP-0651'
    || evidence.variant !== 3
    || evidence.hashOnly !== true
    || evidence.rawValuesIncluded !== false
    || typeof evidence.planId !== 'string'
    || Number.isNaN(Date.parse(evidence.expiresAt))
    || !hashPattern.test(evidence.classificationHash || '')
    || !hashPattern.test(evidence.journal?.rowsHash || '')
  ) {
    return false;
  }

  const targets = evidence.targetEnvelope?.targets;
  if (!Array.isArray(targets) || targets.length !== evidence.targetEnvelope?.total) {
    return false;
  }

  return targets.every((target) => (
    typeof target.mutationId === 'string'
      && typeof target.resourceKey === 'string'
      && target.state === 'new'
      && hashPattern.test(target.beforeHash || '')
      && hashPattern.test(target.afterHash || '')
      && hashPattern.test(target.observedHash || '')
  ));
}

function classificationEvidenceProvesNewRemote(evidence, plan) {
  const counts = evidence.remoteRecoveryClassification?.counts;
  return evidence.status === 'fully-updated-remote'
    && evidence.remoteClassification?.state === 'new-remote'
    && evidence.remoteClassification?.status === 'fully-updated-remote'
    && evidence.remoteClassification?.evidence === 'hash-only-before-after-target-envelope'
    && evidence.remoteClassification?.allTargetsAccountedFor === true
    && evidence.remoteRecoveryClassification?.kind === 'new-remote'
    && evidence.remoteRecoveryClassification?.proved === true
    && evidence.remoteRecoveryClassification?.replaySafe === true
    && evidence.remoteRecoveryClassification?.storage === 'sqlite'
    && evidence.journal?.storage === 'sqlite'
    && evidence.journal?.integrityStatus === 'ok'
    && evidence.journal?.completedRows === 1
    && evidence.journal?.committedTargetRows === plan.mutations.length
    && evidence.targetEnvelope?.total === plan.mutations.length
    && evidence.targetEnvelope?.old === 0
    && evidence.targetEnvelope?.new === plan.mutations.length
    && evidence.targetEnvelope?.blockedUnknown === 0
    && evidence.targetEnvelope?.allTargetsAccountedFor === true
    && counts?.old === 0
    && counts?.new === plan.mutations.length
    && counts?.blockedUnknown === 0
    && counts?.total === plan.mutations.length
    && evidence.targetEnvelope.targets.every((target) => target.observedHash === target.afterHash);
}

test('RPP-0651 generated SQLite-backed completed journal proves new-remote classification variant 3', {
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
    assertNoRawSiteValues(writerInspection, rawSiteValues, 'RPP-0651 writer inspection');

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
      assertNewRemoteInspection(inspection, { plan, current, rawSiteValues });
      assert.equal(current.files[preservedBeforePlanKey], preservedBeforePlanValue);
      assert.equal(current.files[preservedAfterCrashKey], preservedAfterCrashValue);

      const unchangedRemoteInspection = inspectRecoveryJournal({
        journal: restarted,
        plan,
        current: remote,
      });
      assert.equal(unchangedRemoteInspection.status, 'old-remote');
      assert.deepEqual(unchangedRemoteInspection.counts, {
        old: plan.mutations.length,
        new: 0,
        blockedUnknown: 0,
      });
      assert.ok(unchangedRemoteInspection.targets.every((target) => target.state === 'old'));

      const driftedCurrent = cloneJson(current);
      driftedCurrent.files[`${generatedCase.id}-target-1.txt`] =
        `remote-raw-rpp-0651-${generatedCase.id}-outside-envelope-drift`;
      const driftedInspection = inspectRecoveryJournal({
        journal: restarted,
        plan,
        current: driftedCurrent,
      });
      assert.equal(driftedInspection.status, 'blocked-recovery');
      assert.equal(driftedInspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedTargetUnknown);
      assert.equal(driftedInspection.counts.blockedUnknown, 1);
      assertNoRawSiteValues(driftedInspection, rawSiteValues, 'RPP-0651 drifted inspection');

      const evidence = classificationEvidenceFor({ generatedCase, inspection, plan });
      const proofMovement = recoveryProofMovementForNewRemoteClassification({
        evidence,
        plan,
        expectedJournalRowsHash: digest(restarted.records),
        now: proofMovementNow,
      });
      assert.equal(proofMovement.ok, true);
      assert.equal(proofMovement.moved, true);
      assert.equal(proofMovement.localRecoverySupport.proved, true);
      assert.equal(proofMovement.localRecoverySupport.storage, 'sqlite');
      assert.equal(proofMovement.productionBackedDurableJournalProof.proved, false);
      assert.equal(proofMovement.releasePosture, 'NO-GO');
      assert.match(proofMovement.proofHash, hashPattern);
      assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0651 classification evidence');
      assertNoRawSiteValues(proofMovement, rawSiteValues, 'RPP-0651 proof movement');
    } finally {
      database.close();
    }
  }
});

test('RPP-0651 missing malformed stale and drifted classification evidence refuses proof movement variant 3', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const generatedCase = generatedNewRemoteCases[0];
  const filePath = tempJournalPath();
  const sqlitePath = tempSqlitePath();
  const {
    plan,
    remote,
    current,
    rawSiteValues,
  } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);

  writeCompletedJournal({
    filePath,
    plan,
    remote,
    current,
    artifactRefs,
    claimId: claimIdFor(generatedCase),
  });
  const seeded = readRecoveryJournal(filePath);

  let database = new DatabaseSync(sqlitePath);
  writeSqliteJournalTable(database, seeded.records);
  database.close();

  database = new DatabaseSync(sqlitePath);
  try {
    const restarted = readSqliteRecoveryJournalTable(database);
    const inspection = inspectRecoveryJournal({ journal: restarted, plan, current });
    assertNewRemoteInspection(inspection, { plan, current, rawSiteValues });

    const evidence = classificationEvidenceFor({ generatedCase, inspection, plan });
    const expectedJournalRowsHash = digest(restarted.records);
    const accepted = recoveryProofMovementForNewRemoteClassification({
      evidence,
      plan,
      expectedJournalRowsHash,
      now: proofMovementNow,
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.moved, true);

    const malformedEvidence = {
      ...evidence,
      targetEnvelope: {
        ...evidence.targetEnvelope,
        targets: evidence.targetEnvelope.targets.map((target, index) => (
          index === 0
            ? { ...target, observedHash: 'not-a-sha256-hash' }
            : target
        )),
      },
    };
    const staleEvidence = withRecomputedClassificationHash({
      ...evidence,
      expiresAt: new Date(proofMovementNow.getTime() - 1_000).toISOString(),
    });
    const stalePlanEvidence = withRecomputedClassificationHash({
      ...evidence,
      planId: `${plan.id}-superseded`,
    });
    const driftedEvidence = withRecomputedClassificationHash({
      ...evidence,
      journal: {
        ...evidence.journal,
        rowsHash: 'f'.repeat(64),
      },
    });

    const rejectionCases = [
      {
        label: 'missing',
        evidence: null,
        reasonCode: 'NEW_REMOTE_CLASSIFICATION_EVIDENCE_MISSING',
      },
      {
        label: 'malformed',
        evidence: malformedEvidence,
        reasonCode: 'NEW_REMOTE_CLASSIFICATION_EVIDENCE_MALFORMED',
      },
      {
        label: 'expired stale',
        evidence: staleEvidence,
        reasonCode: 'NEW_REMOTE_CLASSIFICATION_EVIDENCE_STALE',
      },
      {
        label: 'superseded plan',
        evidence: stalePlanEvidence,
        reasonCode: 'NEW_REMOTE_CLASSIFICATION_EVIDENCE_STALE',
      },
      {
        label: 'drifted journal rows',
        evidence: driftedEvidence,
        reasonCode: 'NEW_REMOTE_CLASSIFICATION_EVIDENCE_DRIFTED',
      },
    ];

    for (const rejectionCase of rejectionCases) {
      const movement = recoveryProofMovementForNewRemoteClassification({
        evidence: rejectionCase.evidence,
        plan,
        expectedJournalRowsHash,
        now: proofMovementNow,
      });
      assert.equal(movement.ok, false, rejectionCase.label);
      assert.equal(movement.moved, false, rejectionCase.label);
      assert.equal(movement.reasonCode, rejectionCase.reasonCode, rejectionCase.label);
      assert.equal(movement.localRecoverySupport.proved, false, rejectionCase.label);
      assert.equal(movement.productionBackedDurableJournalProof.proved, false, rejectionCase.label);
      assert.equal(movement.releasePosture, 'NO-GO', rejectionCase.label);
      assertNoRawSiteValues(movement, rawSiteValues, `RPP-0651 ${rejectionCase.label} movement`);
    }

    assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0651 accepted evidence');
    assertNoRawSiteValues(malformedEvidence, rawSiteValues, 'RPP-0651 malformed evidence');
    assertNoRawSiteValues(staleEvidence, rawSiteValues, 'RPP-0651 stale evidence');
    assertNoRawSiteValues(driftedEvidence, rawSiteValues, 'RPP-0651 drifted evidence');
  } finally {
    database.close();
  }
});
