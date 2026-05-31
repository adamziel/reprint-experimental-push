import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const openEventTypes = new Set(['journal-opened', 'journal-retry-opened']);
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

const generatedOpenStateCases = Object.freeze([
  {
    id: 'rpp-0647-open-state-three-v3',
    mutationCount: 3,
  },
  {
    id: 'rpp-0647-open-state-six-v3',
    mutationCount: 6,
  },
]);

function tempJournalPath(prefix = 'reprint-rpp-0647-open-state-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0647-open-state-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const base = { files: {}, plugins: {}, db: {} };
  for (let index = 1; index <= generatedCase.mutationCount + 1; index++) {
    base.files[`${generatedCase.id}-file-${index}.txt`] =
      `base-raw-rpp-0647-${generatedCase.id}-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-file-${index}.txt`] =
      `local-raw-rpp-0647-${generatedCase.id}-${index}`;
  }

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);

  return {
    plan,
    remote,
    rawSiteValues: rawSiteValuesFor(base, local, remote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'base-raw-rpp-0647',
    'local-raw-rpp-0647',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function artifactRefsFor(generatedCase) {
  return {
    releaseProof: `artifact://rpp-0647/${generatedCase.id}/local-release-proof-not-production-durable`,
    recoverySupport: `artifact://rpp-0647/${generatedCase.id}/local-restart-readable-open-state-v3`,
    durabilityScope: `artifact://rpp-0647/${generatedCase.id}/sandbox-file-backed-only`,
  };
}

function claimIdFor(generatedCase) {
  return `${generatedCase.id}-claim`;
}

function spawnProductionOpen({
  filePath,
  plan,
  current,
  artifactRefs,
  claimId,
  now,
  truncate,
  printInspection = false,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const childScript = `
    import { openProductionRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};

    try {
      const journal = openProductionRecoveryJournal({
        filePath: process.env.RPP0647_JOURNAL_PATH,
        plan: JSON.parse(process.env.RPP0647_PLAN),
        current: JSON.parse(process.env.RPP0647_CURRENT),
        artifactRefs: JSON.parse(process.env.RPP0647_ARTIFACT_REFS),
        now: new Date(process.env.RPP0647_NOW),
        truncate: process.env.RPP0647_TRUNCATE === 'true',
        claimId: process.env.RPP0647_CLAIM_ID,
      });

      if (process.env.RPP0647_PRINT_INSPECTION === 'true') {
        console.log(JSON.stringify(journal.inspect()));
      }
    } catch (error) {
      console.error(error?.stack || String(error));
      process.exit(2);
    }
  `;

  return spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0647_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0647_CLAIM_ID: claimId,
      RPP0647_CURRENT: JSON.stringify(current),
      RPP0647_JOURNAL_PATH: filePath,
      RPP0647_NOW: now.toISOString(),
      RPP0647_PLAN: JSON.stringify(plan),
      RPP0647_PRINT_INSPECTION: printInspection ? 'true' : 'false',
      RPP0647_TRUNCATE: truncate ? 'true' : 'false',
    },
    encoding: 'utf8',
  });
}

function parseChildInspection(child) {
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.stdout.trim().length > 0, true);
  return JSON.parse(child.stdout);
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function openRecords(records) {
  return records.filter((record) => openEventTypes.has(record.type));
}

function expectedSequences(totalRecords) {
  return Array.from({ length: totalRecords }, (_, index) => index + 1);
}

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0647 evidence') {
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
    for (const field of ['observedHash', 'beforeHash', 'afterHash', 'claimHash', 'previousClaimHash', 'journalIdentityHash']) {
      if (record[field] !== undefined && record[field] !== null) {
        assert.match(record[field], hashPattern, `${field} must be SHA-256-shaped`);
      }
    }
  }
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0647 journal rows');
}

function assertRestartedOpenState(restarted, {
  plan,
  current,
  artifactRefs,
  expectedOpenRows,
  expectedLatestType,
  expectedLatestState,
  rawSiteValues,
}) {
  const latestOpenRecord = openRecords(restarted.records).at(-1);

  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.openState.status, 'opened');
  assert.equal(restarted.openState.phase, 'open');
  assert.equal(restarted.openState.restartReadable, true);
  assert.equal(restarted.openState.records, restarted.records.length);
  assert.equal(restarted.openState.durableRows, restarted.records.length);
  assert.equal(restarted.openState.openRows, expectedOpenRows);
  assert.equal(restarted.openState.firstOpenSequence, 1);
  assert.equal(restarted.openState.latestOpenSequence, latestOpenRecord.sequence);
  assert.equal(restarted.openState.latestOpenType, expectedLatestType);
  assert.equal(restarted.openState.planId, plan.id);
  assert.equal(restarted.openState.state, expectedLatestState);
  assert.equal(restarted.openState.observedHash, digest(current));
  assert.deepEqual(restarted.openState.artifactRefs, artifactRefs);
  assert.deepEqual(restarted.openState.fsync, {
    requested: true,
    strategy: 'after-append',
  });
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    expectedSequences(restarted.records.length),
  );
  assert.equal(recordsOfType(restarted.records, 'target-planned').length, plan.mutations.length);
  assert.equal(recordsOfType(restarted.records, 'journal-ownership-recorded').length, 1);
  assert.equal(recordsOfType(restarted.records, 'recovery-claim-opened').length, 1);
  assert.ok(restarted.records.every((record) => record.fsync.requested === true));
  assertHashOnlyJournalRows(restarted.records, rawSiteValues);
}

function assertOldRemoteInspection(inspection, {
  plan,
  rawSiteValues,
}) {
  assert.equal(inspection.status, 'old-remote');
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assert.ok(inspection.targets.every((target) => target.state === 'old'));
  assert.equal(inspection.journal.openState.restartReadable, true);
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0647 restart inspection');
}

function openStateEvidenceSummary({
  source,
  restarted,
  latestOpenRecord,
}) {
  return {
    issue: 'RPP-0647',
    source,
    localRecoverySupport: {
      proved: restarted.integrity.status === 'ok' && restarted.openState.restartReadable === true,
      storage: restarted.storage || 'filesystem',
      durableRows: restarted.openState.durableRows,
      openRows: restarted.openState.openRows,
      latestOpenType: restarted.openState.latestOpenType,
      latestOpenHash: digest(latestOpenRecord),
      journalRowsHash: digest(restarted.records),
    },
    productionBackedDurableJournalProof: {
      proved: false,
      reasonCode: 'LOCAL_SANDBOX_ONLY',
      requiredBoundary: 'live-production-backed-durable-journal',
    },
    releasePosture: 'NO-GO',
  };
}

function assertEvidenceScope(evidence, rawSiteValues) {
  assert.equal(evidence.localRecoverySupport.proved, true);
  assert.match(evidence.localRecoverySupport.latestOpenHash, hashPattern);
  assert.match(evidence.localRecoverySupport.journalRowsHash, hashPattern);
  assert.equal(evidence.productionBackedDurableJournalProof.proved, false);
  assert.equal(evidence.productionBackedDurableJournalProof.reasonCode, 'LOCAL_SANDBOX_ONLY');
  assert.equal(evidence.releasePosture, 'NO-GO');
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0647 scope evidence');
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

test('RPP-0647 generated file-backed open state rows remain restart-readable after process restart variant 3', () => {
  for (const generatedCase of generatedOpenStateCases) {
    const filePath = tempJournalPath();
    fs.chmodSync(path.dirname(filePath), 0o700);
    const { plan, remote, rawSiteValues } = generatedSites(generatedCase);
    const artifactRefs = artifactRefsFor(generatedCase);
    const claimId = claimIdFor(generatedCase);

    const firstOpen = spawnProductionOpen({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      claimId,
      now: fixedNow,
      truncate: true,
      printInspection: true,
    });
    const firstOpenInspection = parseChildInspection(firstOpen);

    assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(firstOpenInspection), true);
    assert.equal(firstOpenInspection.journal.productionAdapter, 'openProductionRecoveryJournal');
    assert.equal(firstOpenInspection.journal.restartReadable, true);
    assert.equal(firstOpenInspection.journal.openState.latestOpenType, 'journal-opened');
    assert.equal(firstOpenInspection.journal.claimId, claimId);
    assert.equal(firstOpenInspection.journal.claimHash, recoveryClaimHash(claimId));
    assertNoRawSiteValues(firstOpenInspection, rawSiteValues, 'RPP-0647 first writer inspection');

    const afterFirstRestart = readRecoveryJournal(filePath);
    assertRestartedOpenState(afterFirstRestart, {
      plan,
      current: remote,
      artifactRefs,
      expectedOpenRows: 1,
      expectedLatestType: 'journal-opened',
      expectedLatestState: 'opened',
      rawSiteValues,
    });
    assert.deepEqual(firstOpenInspection.journal.openState, afterFirstRestart.openState);
    assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0647 first journal file');

    const firstInspection = inspectRecoveryJournal({
      journal: afterFirstRestart,
      plan,
      current: remote,
    });
    assertOldRemoteInspection(firstInspection, { plan, rawSiteValues });

    const firstOpenEvidence = openStateEvidenceSummary({
      source: 'sandbox-file-backed-open-state-before-retry',
      restarted: afterFirstRestart,
      latestOpenRecord: openRecords(afterFirstRestart.records).at(-1),
    });
    assertEvidenceScope(firstOpenEvidence, rawSiteValues);

    const retryOpen = spawnProductionOpen({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      claimId,
      now: new Date(fixedNow.getTime() + 1_000),
      truncate: false,
      printInspection: true,
    });
    const retryInspection = parseChildInspection(retryOpen);
    const afterRetryRestart = readRecoveryJournal(filePath);
    const retryRecord = openRecords(afterRetryRestart.records).at(-1);

    assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(retryInspection), true);
    assert.equal(retryInspection.journal.productionAdapter, 'openProductionRecoveryJournal');
    assert.equal(retryInspection.journal.records, afterRetryRestart.records.length);
    assert.deepEqual(retryInspection.journal.openState, afterRetryRestart.openState);
    assertRestartedOpenState(afterRetryRestart, {
      plan,
      current: remote,
      artifactRefs,
      expectedOpenRows: 2,
      expectedLatestType: 'journal-retry-opened',
      expectedLatestState: 'retrying-active-claim',
      rawSiteValues,
    });
    assert.equal(retryRecord.claimId, claimId);
    assert.equal(retryRecord.claimHash, recoveryClaimHash(claimId));
    assertNoRawSiteValues(retryInspection, rawSiteValues, 'RPP-0647 retry writer inspection');
    assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0647 retry journal file');

    const retryRestartInspection = inspectRecoveryJournal({
      journal: afterRetryRestart,
      plan,
      current: remote,
    });
    assertOldRemoteInspection(retryRestartInspection, { plan, rawSiteValues });

    const retryEvidence = openStateEvidenceSummary({
      source: 'sandbox-file-backed-open-state-after-retry',
      restarted: afterRetryRestart,
      latestOpenRecord: retryRecord,
    });
    assertEvidenceScope(retryEvidence, rawSiteValues);
  }
});

test('RPP-0647 invalid and stale restart state refuses recovery advancement variant 3', () => {
  const generatedCase = generatedOpenStateCases[0];
  const filePath = tempJournalPath();
  const invalidPath = tempJournalPath('reprint-rpp-0647-invalid-open-state-');
  fs.chmodSync(path.dirname(filePath), 0o700);
  fs.chmodSync(path.dirname(invalidPath), 0o700);
  const { plan, remote, rawSiteValues } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);
  const claimId = claimIdFor(generatedCase);

  const firstOpen = spawnProductionOpen({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
    now: fixedNow,
    truncate: true,
  });
  assert.equal(firstOpen.error, undefined);
  assert.equal(firstOpen.status, 0, firstOpen.stderr || firstOpen.stdout);

  const beforeStaleAttempt = readRecoveryJournal(filePath);
  assertRestartedOpenState(beforeStaleAttempt, {
    plan,
    current: remote,
    artifactRefs,
    expectedOpenRows: 1,
    expectedLatestType: 'journal-opened',
    expectedLatestState: 'opened',
    rawSiteValues,
  });

  const stalePlan = {
    ...plan,
    id: `${plan.id}-stale-restart-state`,
  };
  const staleInspection = inspectRecoveryJournal({
    journal: beforeStaleAttempt,
    plan: stalePlan,
    current: remote,
  });
  assert.equal(staleInspection.status, 'blocked-recovery');
  assert.equal(staleInspection.reasonCode, 'BLOCKED_JOURNAL_INTEGRITY');
  assert.deepEqual(staleInspection.counts, {
    old: 0,
    new: 0,
    blockedUnknown: stalePlan.mutations.length,
  });
  assert.equal(staleInspection.journal.integrity.status, 'blocked');
  assertNoRawSiteValues(staleInspection, rawSiteValues, 'RPP-0647 stale restart inspection');

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan: stalePlan,
      current: remote,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 2_000),
      truncate: false,
      claimId,
    }),
    /requires plan\.id to match the persisted active claim evidence/,
  );
  const afterStaleAttempt = readRecoveryJournal(filePath);
  assert.equal(afterStaleAttempt.records.length, beforeStaleAttempt.records.length);
  assert.deepEqual(afterStaleAttempt.records, beforeStaleAttempt.records);
  assert.equal(recordsOfType(afterStaleAttempt.records, 'journal-retry-opened').length, 0);
  assert.equal(afterStaleAttempt.openState.latestOpenSequence, beforeStaleAttempt.openState.latestOpenSequence);
  assertHashOnlyJournalRows(afterStaleAttempt.records, rawSiteValues);

  const validText = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(invalidPath, validText.replace(/\n$/, ''));
  const invalidBeforeText = fs.readFileSync(invalidPath, 'utf8');
  const invalidRead = readRecoveryJournal(invalidPath);

  assert.equal(invalidRead.integrity.status, 'blocked');
  assert.equal(invalidRead.openState.status, 'opened');
  assert.equal(invalidRead.openState.restartReadable, false);
  assert.equal(invalidRead.openState.durableRows, 0);
  assert.equal(invalidRead.openState.openRows, 1);
  assert.equal(invalidRead.integrity.errors.some((error) => error.code === 'JOURNAL_TRUNCATED'), true);
  assertNoRawSiteValues(invalidRead, rawSiteValues, 'RPP-0647 invalid restart readback');

  const invalidInspection = inspectRecoveryJournal({
    journal: invalidRead,
    plan,
    current: remote,
  });
  assert.equal(invalidInspection.status, 'blocked-recovery');
  assert.equal(invalidInspection.reasonCode, 'BLOCKED_JOURNAL_INTEGRITY');
  assert.deepEqual(invalidInspection.counts, {
    old: 0,
    new: 0,
    blockedUnknown: plan.mutations.length,
  });
  assertNoRawSiteValues(invalidInspection, rawSiteValues, 'RPP-0647 invalid restart inspection');

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath: invalidPath,
      plan,
      current: remote,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 3_000),
      truncate: false,
      claimId,
    }),
    /Refusing to append to invalid recovery journal/,
  );
  assert.equal(fs.readFileSync(invalidPath, 'utf8'), invalidBeforeText);
  const invalidAfter = readRecoveryJournal(invalidPath);
  assert.equal(invalidAfter.integrity.status, 'blocked');
  assert.equal(recordsOfType(invalidAfter.records, 'journal-retry-opened').length, 0);
  assert.equal(invalidAfter.openState.restartReadable, false);
  assertNoRawSiteValues(invalidAfter, rawSiteValues, 'RPP-0647 invalid readback after refused reopen');
});

test('RPP-0647 SQLite open state readback mirrors durable rows and corrupt rows fail closed variant 3', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const generatedCase = generatedOpenStateCases[1];
  const filePath = tempJournalPath();
  const sqlitePath = tempSqlitePath();
  const corruptSqlitePath = tempSqlitePath();
  const { plan, remote, rawSiteValues } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);
  const claimId = claimIdFor(generatedCase);

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId,
  });
  const writerInspection = journal.inspect();
  journal.close();

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(writerInspection), true);
  assertNoRawSiteValues(writerInspection, rawSiteValues, 'RPP-0647 SQLite seed inspection');

  const seeded = readRecoveryJournal(filePath);
  assertRestartedOpenState(seeded, {
    plan,
    current: remote,
    artifactRefs,
    expectedOpenRows: 1,
    expectedLatestType: 'journal-opened',
    expectedLatestState: 'opened',
    rawSiteValues,
  });

  let database = new DatabaseSync(sqlitePath);
  writeSqliteJournalTable(database, seeded.records);
  database.close();

  database = new DatabaseSync(sqlitePath);
  try {
    const restarted = readSqliteRecoveryJournalTable(database);
    assert.equal(restarted.storage, 'sqlite');
    assert.equal(restarted.integrity.status, 'ok');
    assert.deepEqual(restarted.records, seeded.records);
    assert.deepEqual(restarted.openState, seeded.openState);
    assert.equal(restarted.openState.restartReadable, true);
    assertHashOnlyJournalRows(restarted.records, rawSiteValues);

    const sqliteInspection = inspectRecoveryJournal({
      journal: restarted,
      plan,
      current: remote,
    });
    assertOldRemoteInspection(sqliteInspection, { plan, rawSiteValues });

    const sqliteEvidence = openStateEvidenceSummary({
      source: 'sandbox-sqlite-open-state-readback',
      restarted,
      latestOpenRecord: openRecords(restarted.records).at(-1),
    });
    assertEvidenceScope(sqliteEvidence, rawSiteValues);
  } finally {
    database.close();
  }

  database = new DatabaseSync(corruptSqlitePath);
  try {
    const corruptRecords = seeded.records.map((record, index) => (
      index === 0
        ? { ...record, schemaVersion: 999 }
        : { ...record }
    ));
    writeSqliteJournalTable(database, corruptRecords);

    const corruptRead = readSqliteRecoveryJournalTable(database);
    assert.equal(corruptRead.storage, 'sqlite');
    assert.equal(corruptRead.integrity.status, 'blocked');
    assert.equal(corruptRead.openState.status, 'opened');
    assert.equal(corruptRead.openState.restartReadable, false);
    assert.equal(corruptRead.openState.durableRows, 0);
    assert.equal(
      corruptRead.integrity.errors.some((error) => (
        error.code === 'JOURNAL_TABLE_SCHEMA_UNSUPPORTED'
          || error.code === 'JOURNAL_SCHEMA_UNSUPPORTED'
      )),
      true,
    );
    assertNoRawSiteValues(corruptRead, rawSiteValues, 'RPP-0647 corrupt SQLite readback');

    const corruptInspection = inspectRecoveryJournal({
      journal: corruptRead,
      plan,
      current: remote,
    });
    assert.equal(corruptInspection.status, 'blocked-recovery');
    assert.equal(corruptInspection.reasonCode, 'BLOCKED_JOURNAL_INTEGRITY');
    assert.deepEqual(corruptInspection.counts, {
      old: 0,
      new: 0,
      blockedUnknown: plan.mutations.length,
    });
    assertNoRawSiteValues(corruptInspection, rawSiteValues, 'RPP-0647 corrupt SQLite inspection');
  } finally {
    database.close();
  }
});
