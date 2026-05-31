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

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0668-staged-state-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stagedStateScenario() {
  const beforePlanPreservedKey = 'rpp-0668-preserved-before-plan.txt';
  const afterCrashPreservedKey = 'rpp-0668-preserved-after-crash.txt';
  const base = {
    files: {
      [beforePlanPreservedKey]: 'rpp-0668-base-raw-preserved-before-plan',
      [afterCrashPreservedKey]: 'rpp-0668-base-raw-preserved-after-crash',
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= 4; index++) {
    base.files[`rpp-0668-target-${index}.txt`] = `rpp-0668-base-raw-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= 4; index++) {
    local.files[`rpp-0668-target-${index}.txt`] = `rpp-0668-local-raw-target-${index}`;
  }
  remote.files[beforePlanPreservedKey] = 'rpp-0668-remote-raw-preserved-before-plan';

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 4);

  const expectedStaged = cloneJson(remote);
  applyMutations(expectedStaged, plan);

  const retryRemote = cloneJson(remote);
  retryRemote.files[afterCrashPreservedKey] = 'rpp-0668-remote-raw-preserved-after-crash';

  return {
    plan,
    remote,
    expectedStaged,
    retryRemote,
    beforePlanPreservedKey,
    afterCrashPreservedKey,
    preservedBeforePlanValue: retryRemote.files[beforePlanPreservedKey],
    preservedAfterCrashValue: retryRemote.files[afterCrashPreservedKey],
    rawSiteValues: rawSiteValuesFor(base, local, remote, retryRemote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'rpp-0668-base-raw',
    'rpp-0668-local-raw',
    'rpp-0668-remote-raw',
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
      resource: cloneJson(mutation.resource),
      resourceKey: mutation.resourceKey,
      action: mutation.action,
      status: 'pending',
      beforeHash: mutation.remoteBeforeHash || resourceHash(remote, mutation.resource),
      afterHash: digest(deserializeResourceValue(mutation.value)),
    })),
  };
}

function artifactRefs() {
  return {
    releaseProof: 'artifact://rpp-0668/local-release-proof-not-production-durable',
    recoverySupport: 'artifact://rpp-0668/local-restart-readable-staged-state-v4',
    durabilityScope: 'artifact://rpp-0668/sandbox-file-backed-only',
  };
}

function spawnStagedWriter({
  filePath,
  plan,
  remote,
  claimId,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const childScript = `
    import { openProductionRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};

    const durableJournal = openProductionRecoveryJournal({
      filePath: process.env.RPP0668_JOURNAL_PATH,
      plan: JSON.parse(process.env.RPP0668_PLAN),
      current: JSON.parse(process.env.RPP0668_REMOTE_SITE),
      artifactRefs: JSON.parse(process.env.RPP0668_ARTIFACT_REFS),
      now: new Date(process.env.RPP0668_NOW),
      truncate: true,
      claimId: process.env.RPP0668_CLAIM_ID,
    });

    try {
      applyPlan(JSON.parse(process.env.RPP0668_REMOTE_SITE), JSON.parse(process.env.RPP0668_PLAN), {
        durableJournal,
        journal: JSON.parse(process.env.RPP0668_PREVIOUS_JOURNAL),
        failAfterStaging: true,
        mutateRemote: true,
        artifactRefs: JSON.parse(process.env.RPP0668_ARTIFACT_REFS),
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
      RPP0668_ARTIFACT_REFS: JSON.stringify(artifactRefs()),
      RPP0668_CLAIM_ID: claimId,
      RPP0668_JOURNAL_PATH: filePath,
      RPP0668_NOW: fixedNow.toISOString(),
      RPP0668_PLAN: JSON.stringify(plan),
      RPP0668_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0668_REMOTE_SITE: JSON.stringify(remote),
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

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0668 evidence') {
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
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0668 journal rows');
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

function assertRetryReplayPreservesRemoteChanges({
  replay,
  retryRemote,
  expectedAfterReplay,
  plan,
  writtenResourceKeys,
  beforePlanPreservedKey,
  afterCrashPreservedKey,
  preservedBeforePlanValue,
  preservedAfterCrashValue,
  rawSiteValues,
}) {
  assert.equal(replay.status, 'replayed');
  assert.equal(replay.appliedMutations, plan.mutations.length);
  assert.deepEqual(writtenResourceKeys, plan.mutations.map((mutation) => mutation.resourceKey));
  assert.equal(writtenResourceKeys.some((key) => key.includes(beforePlanPreservedKey)), false);
  assert.equal(writtenResourceKeys.some((key) => key.includes(afterCrashPreservedKey)), false);
  assert.deepEqual(retryRemote, expectedAfterReplay);
  assert.equal(retryRemote.files[beforePlanPreservedKey], preservedBeforePlanValue);
  assert.equal(retryRemote.files[afterCrashPreservedKey], preservedAfterCrashValue);
  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(retryRemote, mutation.resource),
      digest(deserializeResourceValue(mutation.value)),
    );
  }
  assertNoRawSiteValues(replay.before.journal.records, rawSiteValues, 'RPP-0668 repair-before journal rows');
  assertNoRawSiteValues(replay.after.journal.records, rawSiteValues, 'RPP-0668 repair-after journal rows');
}

function retryPreservationEvidence({
  afterProductionRetry,
  replay,
  writtenResourceKeys,
  beforePlanPreservedValue,
  afterCrashPreservedValue,
}) {
  return {
    issue: 'RPP-0668',
    localRecoverySupport: {
      proved: afterProductionRetry.integrity.status === 'ok'
        && afterProductionRetry.stagedState.restartReadable === true,
      storage: afterProductionRetry.storage || 'filesystem',
      stagedRows: afterProductionRetry.stagedState.stagedRows,
      retryOpenRows: afterProductionRetry.openState.openRows,
      latestOpenType: afterProductionRetry.openState.latestOpenType,
      latestStagedType: afterProductionRetry.stagedState.latestStagedType,
      journalRowsHash: digest(afterProductionRetry.records),
    },
    retryNoOverwrite: {
      proved: replay.status === 'replayed',
      appliedMutations: replay.appliedMutations,
      writtenTargetsHash: digest(writtenResourceKeys),
      preservedBeforePlanHash: digest(beforePlanPreservedValue),
      preservedAfterCrashHash: digest(afterCrashPreservedValue),
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
  assert.equal(evidence.retryNoOverwrite.proved, true);
  assert.match(evidence.localRecoverySupport.journalRowsHash, hashPattern);
  assert.match(evidence.retryNoOverwrite.writtenTargetsHash, hashPattern);
  assert.match(evidence.retryNoOverwrite.preservedBeforePlanHash, hashPattern);
  assert.match(evidence.retryNoOverwrite.preservedAfterCrashHash, hashPattern);
  assert.equal(evidence.productionBackedDurableJournalProof.proved, false);
  assert.equal(evidence.productionBackedDurableJournalProof.reasonCode, 'LOCAL_SANDBOX_ONLY');
  assert.equal(evidence.releasePosture, 'NO-GO');
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0668 scope evidence');
}

test('RPP-0668 restart-readable staged retry does not overwrite preserved remote changes variant 4', () => {
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
  } = stagedStateScenario();
  const claimId = 'rpp-0668-staged-state-retry-claim';

  const stagedWriter = spawnStagedWriter({
    filePath,
    plan,
    remote,
    claimId,
  });
  const beforeRestartInspection = parseChildInspection(stagedWriter);

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(beforeRestartInspection), true);
  assert.equal(beforeRestartInspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(beforeRestartInspection.journal.restartReadable, true);
  assert.equal(beforeRestartInspection.journal.stagedState.restartReadable, true);
  assert.equal(beforeRestartInspection.journal.stagedState.latestStagedType, 'apply-staged');
  assert.equal(beforeRestartInspection.journal.claimId, claimId);
  assert.equal(beforeRestartInspection.journal.claimHash, recoveryClaimHash(claimId));
  assertNoRawSiteValues(beforeRestartInspection, rawSiteValues, 'RPP-0668 first writer inspection');

  const afterFirstRestart = readRecoveryJournal(filePath);
  assertRestartedStagedState(afterFirstRestart, {
    plan,
    current: remote,
    expectedStaged,
    rawSiteValues,
  });
  assert.deepEqual(beforeRestartInspection.journal.stagedState, afterFirstRestart.stagedState);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0668 first journal file');

  const restartInspection = inspectRecoveryJournal({
    journal: afterFirstRestart,
    plan,
    current: retryRemote,
  });
  assert.equal(restartInspection.status, 'old-remote');
  assert.deepEqual(restartInspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assert.equal(restartInspection.journal.stagedState.restartReadable, true);
  assertNoRawSiteValues(restartInspection, rawSiteValues, 'RPP-0668 restart inspection');

  const repairInspection = inspectRecoveryRepair({
    journal: afterFirstRestart,
    plan,
    current: retryRemote,
  });
  assert.equal(repairInspection.status, 'old-remote-replayable');
  assert.equal(repairInspection.canRollForward, true);
  assert.equal(repairInspection.journal.stagedState.restartReadable, true);
  assertNoRawSiteValues(repairInspection.journal.records, rawSiteValues, 'RPP-0668 repair inspection rows');

  const retryRemoteBeforeJournalOpen = cloneJson(retryRemote);
  const retryJournal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: retryRemote,
    artifactRefs: artifactRefs(),
    now: new Date(fixedNow.getTime() + 1_000),
    truncate: false,
    claimId,
  });
  const retryInspection = retryJournal.inspect();
  retryJournal.close();
  assert.deepEqual(retryRemote, retryRemoteBeforeJournalOpen);

  const afterProductionRetry = readRecoveryJournal(filePath);
  const stagedRecord = recordsOfType(afterProductionRetry.records, 'apply-staged').at(-1);
  const latestOpenRecord = openRecords(afterProductionRetry.records).at(-1);
  assert.ok(stagedRecord);
  assert.ok(latestOpenRecord);
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
  assert.equal(afterProductionRetry.stagedState.stagedRows, 1);
  assert.equal(afterProductionRetry.stagedState.latestStagedSequence, afterFirstRestart.stagedState.latestStagedSequence);
  assert.equal(afterProductionRetry.stagedState.latestStagedSequence, stagedRecord.sequence);
  assert.equal(afterProductionRetry.stagedState.stagedHash, digest(expectedStaged));
  assertHashOnlyJournalRows(afterProductionRetry.records, rawSiteValues);
  assertNoRawSiteValues(retryInspection, rawSiteValues, 'RPP-0668 retry writer inspection');

  const repairAfterProductionRetry = inspectRecoveryRepair({
    journal: afterProductionRetry,
    plan,
    current: retryRemote,
  });
  assert.equal(repairAfterProductionRetry.status, 'old-remote-replayable');
  assert.equal(repairAfterProductionRetry.journal.stagedState.restartReadable, true);

  const retryRemoteBeforeReplay = cloneJson(retryRemote);
  const expectedAfterReplay = cloneJson(retryRemoteBeforeReplay);
  applyMutations(expectedAfterReplay, plan);
  const writtenResourceKeys = [];
  const replay = replayRecoveryRepair({
    journal: afterProductionRetry,
    plan,
    current: retryRemote,
    mutateCurrent: true,
    writeResource(site, resource, value, context) {
      writtenResourceKeys.push(context.mutation.resourceKey);
      setResource(site, resource, value);
    },
  });

  assertRetryReplayPreservesRemoteChanges({
    replay,
    retryRemote,
    expectedAfterReplay,
    plan,
    writtenResourceKeys,
    beforePlanPreservedKey,
    afterCrashPreservedKey,
    preservedBeforePlanValue,
    preservedAfterCrashValue,
    rawSiteValues,
  });

  const evidence = retryPreservationEvidence({
    afterProductionRetry,
    replay,
    writtenResourceKeys,
    beforePlanPreservedValue: preservedBeforePlanValue,
    afterCrashPreservedValue: preservedAfterCrashValue,
  });
  assertEvidenceScope(evidence, rawSiteValues);

  const journalText = fs.readFileSync(filePath, 'utf8');
  assertNoRawSiteValues(journalText, rawSiteValues, 'RPP-0668 retry journal file');
});
