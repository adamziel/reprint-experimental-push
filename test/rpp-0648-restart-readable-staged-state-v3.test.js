import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  inspectRecoveryRepair,
  replayRecoveryRepair,
} from '../src/recovery-repair.js';
import {
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  readSqliteRecoveryJournalTable,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import {
  deserializeResourceValue,
  resourceHash,
  setResource,
} from '../src/resources.js';
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

const generatedStagedStateCases = Object.freeze([
  {
    id: 'rpp-0648-staged-state-three-v3',
    mutationCount: 3,
  },
  {
    id: 'rpp-0648-staged-state-five-v3',
    mutationCount: 5,
  },
]);

function tempJournalPath(prefix = 'reprint-rpp-0648-staged-state-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0648-staged-state-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const beforePlanPreservedKey = `${generatedCase.id}-preserved-before-plan.txt`;
  const afterCrashPreservedKey = `${generatedCase.id}-preserved-after-crash.txt`;
  const base = {
    files: {
      [beforePlanPreservedKey]: `base-raw-rpp-0648-${generatedCase.id}-preserved-before-plan`,
      [afterCrashPreservedKey]: `base-raw-rpp-0648-${generatedCase.id}-preserved-after-crash`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-raw-rpp-0648-${generatedCase.id}-target-${index}`;
  }

  const local = clone(base);
  const remote = clone(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-raw-rpp-0648-${generatedCase.id}-target-${index}`;
  }
  remote.files[beforePlanPreservedKey] =
    `remote-raw-rpp-0648-${generatedCase.id}-preserved-before-plan`;

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);

  const expectedStaged = clone(remote);
  applyMutations(expectedStaged, plan);

  const retryRemote = clone(remote);
  retryRemote.files[afterCrashPreservedKey] =
    `remote-raw-rpp-0648-${generatedCase.id}-preserved-after-crash`;

  return {
    plan,
    remote,
    expectedStaged,
    retryRemote,
    beforePlanPreservedKey,
    afterCrashPreservedKey,
    preservedBeforePlanValue: remote.files[beforePlanPreservedKey],
    preservedAfterCrashValue: retryRemote.files[afterCrashPreservedKey],
    rawSiteValues: rawSiteValuesFor(base, local, remote, retryRemote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'base-raw-rpp-0648',
    'local-raw-rpp-0648',
    'remote-raw-rpp-0648',
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

function oldRemoteJournalForPlan(remote, plan) {
  return {
    schemaVersion: 1,
    id: `journal-${plan.id}`,
    planId: plan.id,
    status: 'opened',
    createdAt: plan.generatedAt,
    remoteBeforeHash: digest(remote),
    entries: plan.mutations.map((mutation) => ({
      mutationId: mutation.id,
      resource: clone(mutation.resource),
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      status: 'pending',
      beforeHash: mutation.remoteBeforeHash || resourceHash(remote, mutation.resource),
      afterHash: digest(deserializeResourceValue(mutation.value)),
    })),
  };
}

function artifactRefsFor(generatedCase) {
  return {
    releaseProof: `artifact://rpp-0648/${generatedCase.id}/local-release-proof-not-production-durable`,
    recoverySupport: `artifact://rpp-0648/${generatedCase.id}/local-restart-readable-staged-state-v3`,
    durabilityScope: `artifact://rpp-0648/${generatedCase.id}/sandbox-file-backed-only`,
  };
}

function claimIdFor(generatedCase) {
  return `${generatedCase.id}-claim`;
}

function spawnStagedWriter({
  filePath,
  plan,
  remote,
  artifactRefs,
  claimId,
  now,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const childScript = `
    import { openProductionRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};

    const durableJournal = openProductionRecoveryJournal({
      filePath: process.env.RPP0648_JOURNAL_PATH,
      plan: JSON.parse(process.env.RPP0648_PLAN),
      current: JSON.parse(process.env.RPP0648_REMOTE_SITE),
      artifactRefs: JSON.parse(process.env.RPP0648_ARTIFACT_REFS),
      now: new Date(process.env.RPP0648_NOW),
      truncate: true,
      claimId: process.env.RPP0648_CLAIM_ID,
    });

    try {
      applyPlan(JSON.parse(process.env.RPP0648_REMOTE_SITE), JSON.parse(process.env.RPP0648_PLAN), {
        durableJournal,
        journal: JSON.parse(process.env.RPP0648_PREVIOUS_JOURNAL),
        failAfterStaging: true,
        mutateRemote: true,
        artifactRefs: JSON.parse(process.env.RPP0648_ARTIFACT_REFS),
      });
      console.error('expected injected staging failure');
      process.exit(3);
    } catch (error) {
      if (error?.code !== 'INJECTED_FAILURE_AFTER_STAGING') {
        console.error(error?.stack || String(error));
        process.exit(2);
      }
      console.log(JSON.stringify(durableJournal.inspect()));
      process.exit(0);
    }
  `;

  return spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0648_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0648_CLAIM_ID: claimId,
      RPP0648_JOURNAL_PATH: filePath,
      RPP0648_NOW: now.toISOString(),
      RPP0648_PLAN: JSON.stringify(plan),
      RPP0648_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0648_REMOTE_SITE: JSON.stringify(remote),
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

function writeStagedJournalInProcess({
  filePath,
  plan,
  remote,
  artifactRefs,
  claimId,
  now,
}) {
  const durableJournal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now,
    truncate: true,
    claimId,
  });
  try {
    assert.throws(
      () => applyPlan(clone(remote), plan, {
        durableJournal,
        journal: oldRemoteJournalForPlan(remote, plan),
        failAfterStaging: true,
        mutateRemote: true,
        artifactRefs,
      }),
      (error) => error?.code === 'INJECTED_FAILURE_AFTER_STAGING',
    );
    return durableJournal.inspect();
  } finally {
    durableJournal.close();
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

function openRecords(records) {
  return records.filter((record) => openEventTypes.has(record.type));
}

function expectedSequences(totalRecords) {
  return Array.from({ length: totalRecords }, (_, index) => index + 1);
}

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0648 evidence') {
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
      'stagedHash',
      'claimHash',
      'previousClaimHash',
      'journalIdentityHash',
    ]) {
      if (record[field] !== undefined && record[field] !== null) {
        assert.match(record[field], hashPattern, `${field} must be SHA-256-shaped`);
      }
    }
  }
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0648 journal rows');
}

function assertRestartedStagedState(restarted, {
  plan,
  current,
  expectedStaged,
  rawSiteValues,
}) {
  const stagedRecord = recordsOfType(restarted.records, 'apply-staged').at(-1);
  const latestOpenRecord = openRecords(restarted.records).at(-1);

  assert.ok(stagedRecord);
  assert.ok(latestOpenRecord);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.stagedState.status, 'staged');
  assert.equal(restarted.stagedState.phase, 'staged');
  assert.equal(restarted.stagedState.restartReadable, true);
  assert.equal(restarted.stagedState.records, restarted.records.length);
  assert.equal(restarted.stagedState.durableRows, restarted.records.length);
  assert.equal(restarted.stagedState.stagedRows, 1);
  assert.equal(restarted.stagedState.targetRows, plan.mutations.length);
  assert.equal(restarted.stagedState.targetEnvelope.plannedTargets, plan.mutations.length);
  assert.equal(restarted.stagedState.targetEnvelope.allTargetsHaveHashes, true);
  assert.equal(restarted.stagedState.firstStagedSequence, stagedRecord.sequence);
  assert.equal(restarted.stagedState.latestStagedSequence, stagedRecord.sequence);
  assert.equal(restarted.stagedState.latestStagedType, 'apply-staged');
  assert.equal(restarted.stagedState.planId, plan.id);
  assert.equal(restarted.stagedState.state, 'staged');
  assert.equal(restarted.stagedState.observedHash, digest(current));
  assert.equal(restarted.stagedState.stagedHash, digest(expectedStaged));
  assert.deepEqual(restarted.stagedState.fsync, {
    requested: true,
    strategy: 'after-append',
  });
  assert.equal(restarted.openState.restartReadable, true);
  assert.equal(restarted.openState.openRows, 2);
  assert.equal(restarted.openState.latestOpenSequence, latestOpenRecord.sequence);
  assert.equal(restarted.openState.latestOpenType, 'journal-retry-opened');
  assert.equal(restarted.openState.state, 'retrying-old-remote');
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    expectedSequences(restarted.records.length),
  );
  assert.deepEqual(
    restarted.records.map((record) => record.type),
    [
      'journal-opened',
      'journal-ownership-recorded',
      ...plan.mutations.map(() => 'target-planned'),
      'recovery-claim-opened',
      'journal-retry-opened',
      'apply-staged',
      'recovery-state',
    ],
  );
  assert.equal(recordsOfType(restarted.records, 'target-planned').length, plan.mutations.length);
  assert.equal(recordsOfType(restarted.records, 'journal-ownership-recorded').length, 1);
  assert.equal(recordsOfType(restarted.records, 'recovery-claim-opened').length, 1);
  assert.equal(recordsOfType(restarted.records, 'recovery-state').length, 1);
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
  assert.equal(inspection.journal.stagedState.restartReadable, true);
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0648 restart inspection');
}

function assertRepairReplayPreservedRemoteChanges({
  replay,
  retryRemote,
  plan,
  beforePlanPreservedKey,
  afterCrashPreservedKey,
  preservedBeforePlanValue,
  preservedAfterCrashValue,
  rawSiteValues,
}) {
  assert.equal(replay.status, 'replayed');
  assert.equal(replay.appliedMutations, plan.mutations.length);
  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(retryRemote, mutation.resource),
      digest(deserializeResourceValue(mutation.value)),
    );
  }
  assert.equal(
    retryRemote.files[beforePlanPreservedKey],
    preservedBeforePlanValue,
  );
  assert.equal(retryRemote.files[afterCrashPreservedKey], preservedAfterCrashValue);
  assertNoRawSiteValues(replay.before.journal.records, rawSiteValues, 'RPP-0648 repair-before journal rows');
  assertNoRawSiteValues(replay.after.journal.records, rawSiteValues, 'RPP-0648 repair-after journal rows');
}

function stagedStateEvidenceSummary({
  source,
  restarted,
  stagedRecord,
}) {
  return {
    issue: 'RPP-0648',
    source,
    localRecoverySupport: {
      proved: restarted.integrity.status === 'ok' && restarted.stagedState.restartReadable === true,
      storage: restarted.storage || 'filesystem',
      durableRows: restarted.stagedState.durableRows,
      stagedRows: restarted.stagedState.stagedRows,
      targetRows: restarted.stagedState.targetRows,
      latestStagedType: restarted.stagedState.latestStagedType,
      latestStagedHash: digest(stagedRecord),
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
  assert.match(evidence.localRecoverySupport.latestStagedHash, hashPattern);
  assert.match(evidence.localRecoverySupport.journalRowsHash, hashPattern);
  assert.equal(evidence.productionBackedDurableJournalProof.proved, false);
  assert.equal(evidence.productionBackedDurableJournalProof.reasonCode, 'LOCAL_SANDBOX_ONLY');
  assert.equal(evidence.releasePosture, 'NO-GO');
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0648 scope evidence');
}

test('RPP-0648 generated file-backed staged rows survive restart and retry preserves remote changes variant 3', () => {
  for (const generatedCase of generatedStagedStateCases) {
    const filePath = tempJournalPath();
    fs.chmodSync(path.dirname(filePath), 0o700);
    const {
      plan,
      remote,
      expectedStaged,
      retryRemote,
      beforePlanPreservedKey,
      afterCrashPreservedKey,
      preservedBeforePlanValue,
      preservedAfterCrashValue,
      rawSiteValues,
    } = generatedSites(generatedCase);
    const artifactRefs = artifactRefsFor(generatedCase);
    const claimId = claimIdFor(generatedCase);

    const stagedWriter = spawnStagedWriter({
      filePath,
      plan,
      remote,
      artifactRefs,
      claimId,
      now: fixedNow,
    });
    const beforeRestartInspection = parseChildInspection(stagedWriter);

    assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(beforeRestartInspection), true);
    assert.equal(beforeRestartInspection.journal.productionAdapter, 'openProductionRecoveryJournal');
    assert.equal(beforeRestartInspection.journal.restartReadable, true);
    assert.equal(beforeRestartInspection.journal.stagedState.restartReadable, true);
    assert.equal(beforeRestartInspection.journal.stagedState.latestStagedType, 'apply-staged');
    assert.equal(beforeRestartInspection.journal.claimId, claimId);
    assert.equal(beforeRestartInspection.journal.claimHash, recoveryClaimHash(claimId));
    assertNoRawSiteValues(beforeRestartInspection, rawSiteValues, 'RPP-0648 first writer inspection');

    const afterFirstRestart = readRecoveryJournal(filePath);
    assertRestartedStagedState(afterFirstRestart, {
      plan,
      current: remote,
      expectedStaged,
      rawSiteValues,
    });
    assert.deepEqual(beforeRestartInspection.journal.stagedState, afterFirstRestart.stagedState);
    assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0648 first journal file');

    const firstInspection = inspectRecoveryJournal({
      journal: afterFirstRestart,
      plan,
      current: retryRemote,
    });
    assertOldRemoteInspection(firstInspection, { plan, rawSiteValues });

    const repairInspection = inspectRecoveryRepair({
      journal: afterFirstRestart,
      plan,
      current: retryRemote,
    });
    assert.equal(repairInspection.status, 'old-remote-replayable');
    assert.equal(repairInspection.canRollForward, true);
    assert.equal(repairInspection.journal.stagedState.restartReadable, true);
    assertNoRawSiteValues(repairInspection.journal.records, rawSiteValues, 'RPP-0648 repair inspection rows');

    const firstEvidence = stagedStateEvidenceSummary({
      source: 'sandbox-file-backed-staged-state-before-retry',
      restarted: afterFirstRestart,
      stagedRecord: recordsOfType(afterFirstRestart.records, 'apply-staged').at(-1),
    });
    assertEvidenceScope(firstEvidence, rawSiteValues);

    const retryJournal = openProductionRecoveryJournal({
      filePath,
      plan,
      current: retryRemote,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 1_000),
      truncate: false,
      claimId,
    });
    const retryInspection = retryJournal.inspect();
    retryJournal.close();

    const afterProductionRetry = readRecoveryJournal(filePath);
    const stagedRecord = recordsOfType(afterProductionRetry.records, 'apply-staged').at(-1);
    const latestOpenRecord = openRecords(afterProductionRetry.records).at(-1);

    assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(retryInspection), true);
    assert.equal(retryInspection.journal.records, afterProductionRetry.records.length);
    assert.deepEqual(retryInspection.journal.openState, afterProductionRetry.openState);
    assert.deepEqual(retryInspection.journal.stagedState, afterProductionRetry.stagedState);
    assert.equal(afterProductionRetry.integrity.status, 'ok');
    assert.equal(afterProductionRetry.records.length, afterFirstRestart.records.length + 1);
    assert.equal(afterProductionRetry.openState.openRows, 3);
    assert.equal(afterProductionRetry.openState.latestOpenSequence, latestOpenRecord.sequence);
    assert.equal(afterProductionRetry.openState.latestOpenType, 'journal-retry-opened');
    assert.equal(afterProductionRetry.openState.state, 'retrying-active-claim');
    assert.equal(afterProductionRetry.stagedState.restartReadable, true);
    assert.equal(afterProductionRetry.stagedState.records, afterProductionRetry.records.length);
    assert.equal(afterProductionRetry.stagedState.latestStagedSequence, stagedRecord.sequence);
    assert.equal(afterProductionRetry.stagedState.stagedHash, digest(expectedStaged));
    assertHashOnlyJournalRows(afterProductionRetry.records, rawSiteValues);
    assertNoRawSiteValues(retryInspection, rawSiteValues, 'RPP-0648 retry writer inspection');

    const repairAfterProductionRetry = inspectRecoveryRepair({
      journal: afterProductionRetry,
      plan,
      current: retryRemote,
    });
    assert.equal(repairAfterProductionRetry.status, 'old-remote-replayable');
    assert.equal(repairAfterProductionRetry.journal.stagedState.restartReadable, true);

    const replay = replayRecoveryRepair({
      journal: afterProductionRetry,
      plan,
      current: retryRemote,
      mutateCurrent: true,
    });
    assertRepairReplayPreservedRemoteChanges({
      replay,
      retryRemote,
      plan,
      beforePlanPreservedKey,
      afterCrashPreservedKey,
      preservedBeforePlanValue,
      preservedAfterCrashValue,
      rawSiteValues,
    });

    const retryEvidence = stagedStateEvidenceSummary({
      source: 'sandbox-file-backed-staged-state-after-retry',
      restarted: afterProductionRetry,
      stagedRecord,
    });
    assertEvidenceScope(retryEvidence, rawSiteValues);

    const journalText = fs.readFileSync(filePath, 'utf8');
    assertNoRawSiteValues(journalText, rawSiteValues, 'RPP-0648 retry journal file');
  }
});

test('RPP-0648 stale and invalid staged restart state fails closed with hash-only evidence variant 3', () => {
  const generatedCase = generatedStagedStateCases[0];
  const filePath = tempJournalPath();
  const invalidPath = tempJournalPath('reprint-rpp-0648-invalid-staged-state-');
  fs.chmodSync(path.dirname(filePath), 0o700);
  fs.chmodSync(path.dirname(invalidPath), 0o700);
  const {
    plan,
    remote,
    expectedStaged,
    retryRemote,
    rawSiteValues,
  } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);
  const claimId = claimIdFor(generatedCase);

  const stagedWriter = spawnStagedWriter({
    filePath,
    plan,
    remote,
    artifactRefs,
    claimId,
    now: fixedNow,
  });
  parseChildInspection(stagedWriter);

  const beforeStaleAttempt = readRecoveryJournal(filePath);
  assertRestartedStagedState(beforeStaleAttempt, {
    plan,
    current: remote,
    expectedStaged,
    rawSiteValues,
  });

  const stalePlan = {
    ...plan,
    id: `${plan.id}-stale-restart-state`,
  };
  const staleInspection = inspectRecoveryJournal({
    journal: beforeStaleAttempt,
    plan: stalePlan,
    current: retryRemote,
  });
  assert.equal(staleInspection.status, 'blocked-recovery');
  assert.equal(staleInspection.reasonCode, 'BLOCKED_JOURNAL_INTEGRITY');
  assert.deepEqual(staleInspection.counts, {
    old: 0,
    new: 0,
    blockedUnknown: stalePlan.mutations.length,
  });
  assert.equal(staleInspection.classification.retry, 'blocked');
  assert.equal(staleInspection.journal.integrity.status, 'blocked');
  assertNoRawSiteValues(staleInspection, rawSiteValues, 'RPP-0648 stale restart inspection');

  const staleRepair = inspectRecoveryRepair({
    journal: beforeStaleAttempt,
    plan: stalePlan,
    current: retryRemote,
  });
  assert.equal(staleRepair.status, 'blocked-incomplete-journal');
  assert.equal(staleRepair.canRollForward, false);
  assert.throws(
    () => replayRecoveryRepair({
      journal: beforeStaleAttempt,
      plan: stalePlan,
      current: clone(retryRemote),
      mutateCurrent: true,
    }),
    (error) => error?.code === 'RECOVERY_REPAIR_INCOMPLETE_JOURNAL',
  );

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan: stalePlan,
      current: retryRemote,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 2_000),
      truncate: false,
      claimId,
    }),
    /requires plan\.id to match the persisted active claim evidence/,
  );
  const afterStaleAttempt = readRecoveryJournal(filePath);
  assert.deepEqual(afterStaleAttempt.records, beforeStaleAttempt.records);
  assert.equal(afterStaleAttempt.records.length, beforeStaleAttempt.records.length);
  assert.equal(afterStaleAttempt.stagedState.latestStagedSequence, beforeStaleAttempt.stagedState.latestStagedSequence);
  assert.equal(openRecords(afterStaleAttempt.records).length, openRecords(beforeStaleAttempt.records).length);
  assertHashOnlyJournalRows(afterStaleAttempt.records, rawSiteValues);

  const validText = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(invalidPath, validText.replace(/\n$/, ''));
  const invalidBeforeText = fs.readFileSync(invalidPath, 'utf8');
  const invalidRead = readRecoveryJournal(invalidPath);

  assert.equal(invalidRead.integrity.status, 'blocked');
  assert.equal(invalidRead.stagedState.status, 'staged');
  assert.equal(invalidRead.stagedState.restartReadable, false);
  assert.equal(invalidRead.stagedState.durableRows, 0);
  assert.equal(invalidRead.stagedState.stagedRows, 1);
  assert.equal(invalidRead.integrity.errors.some((error) => error.code === 'JOURNAL_TRUNCATED'), true);
  assertNoRawSiteValues(invalidRead, rawSiteValues, 'RPP-0648 invalid restart readback');

  const invalidInspection = inspectRecoveryJournal({
    journal: invalidRead,
    plan,
    current: retryRemote,
  });
  assert.equal(invalidInspection.status, 'blocked-recovery');
  assert.equal(invalidInspection.reasonCode, 'BLOCKED_JOURNAL_INTEGRITY');
  assert.deepEqual(invalidInspection.counts, {
    old: 0,
    new: 0,
    blockedUnknown: plan.mutations.length,
  });
  assertNoRawSiteValues(invalidInspection, rawSiteValues, 'RPP-0648 invalid restart inspection');

  const invalidRepair = inspectRecoveryRepair({
    journal: invalidRead,
    plan,
    current: retryRemote,
  });
  assert.equal(invalidRepair.status, 'blocked-incomplete-journal');
  assert.equal(invalidRepair.canRollForward, false);
  assert.throws(
    () => replayRecoveryRepair({
      journal: invalidRead,
      plan,
      current: clone(retryRemote),
      mutateCurrent: true,
    }),
    (error) => error?.code === 'RECOVERY_REPAIR_INCOMPLETE_JOURNAL',
  );

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath: invalidPath,
      plan,
      current: retryRemote,
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
  assert.equal(openRecords(invalidAfter.records).length, openRecords(invalidRead.records).length);
  assert.equal(invalidAfter.stagedState.restartReadable, false);
  assertHashOnlyJournalRows(invalidAfter.records, rawSiteValues);
});

test('RPP-0648 SQLite staged state readback mirrors restart-readable rows and corrupt rows fail closed variant 3', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const generatedCase = generatedStagedStateCases[1];
  const filePath = tempJournalPath();
  const sqlitePath = tempSqlitePath();
  const corruptSqlitePath = tempSqlitePath();
  const {
    plan,
    remote,
    expectedStaged,
    retryRemote,
    rawSiteValues,
  } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);
  const claimId = claimIdFor(generatedCase);

  const writerInspection = writeStagedJournalInProcess({
    filePath,
    plan,
    remote,
    artifactRefs,
    claimId,
    now: fixedNow,
  });
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(writerInspection), true);
  assertNoRawSiteValues(writerInspection, rawSiteValues, 'RPP-0648 SQLite seed inspection');

  const seeded = readRecoveryJournal(filePath);
  assertRestartedStagedState(seeded, {
    plan,
    current: remote,
    expectedStaged,
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
    assert.deepEqual(restarted.stagedState, seeded.stagedState);
    assertRestartedStagedState(restarted, {
      plan,
      current: remote,
      expectedStaged,
      rawSiteValues,
    });

    const sqliteInspection = inspectRecoveryJournal({
      journal: restarted,
      plan,
      current: retryRemote,
    });
    assertOldRemoteInspection(sqliteInspection, { plan, rawSiteValues });

    const sqliteRepairInspection = inspectRecoveryRepair({
      journal: restarted,
      plan,
      current: retryRemote,
    });
    assert.equal(sqliteRepairInspection.status, 'old-remote-replayable');
    assert.equal(sqliteRepairInspection.journal.stagedState.restartReadable, true);

    const sqliteEvidence = stagedStateEvidenceSummary({
      source: 'sandbox-sqlite-staged-state-readback',
      restarted,
      stagedRecord: recordsOfType(restarted.records, 'apply-staged').at(-1),
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
    assert.equal(corruptRead.stagedState.status, 'staged');
    assert.equal(corruptRead.stagedState.restartReadable, false);
    assert.equal(corruptRead.stagedState.durableRows, 0);
    assert.equal(
      corruptRead.integrity.errors.some((error) => (
        error.code === 'JOURNAL_TABLE_SCHEMA_UNSUPPORTED'
          || error.code === 'JOURNAL_SCHEMA_UNSUPPORTED'
      )),
      true,
    );
    assertHashOnlyJournalRows(corruptRead.records, rawSiteValues);

    const corruptInspection = inspectRecoveryJournal({
      journal: corruptRead,
      plan,
      current: retryRemote,
    });
    assert.equal(corruptInspection.status, 'blocked-recovery');
    assert.equal(corruptInspection.reasonCode, 'BLOCKED_JOURNAL_INTEGRITY');
    assert.deepEqual(corruptInspection.counts, {
      old: 0,
      new: 0,
      blockedUnknown: plan.mutations.length,
    });
    assertNoRawSiteValues(corruptInspection, rawSiteValues, 'RPP-0648 corrupt SQLite inspection');
  } finally {
    database.close();
  }
});
