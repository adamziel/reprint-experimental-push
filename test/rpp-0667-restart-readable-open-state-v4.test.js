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
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const openEventTypes = new Set(['journal-opened', 'journal-retry-opened']);

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0667-open-state-v4-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function openStateFixture() {
  const base = { files: {}, plugins: {}, db: {} };
  for (let index = 1; index <= 5; index++) {
    base.files[`rpp-0667-v4-file-${index}.txt`] = `base-private-rpp-0667-v4-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= 4; index++) {
    local.files[`rpp-0667-v4-file-${index}.txt`] = `local-private-rpp-0667-v4-${index}`;
  }

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 4);

  return {
    plan,
    remote,
    rawSiteValues: rawSiteValuesFor(base, local, remote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set();
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function artifactRefsFor(plan) {
  return {
    releaseProof: `artifact://rpp-0667/${plan.id}/local-release-proof-not-production-durable`,
    recoverySupport: `artifact://rpp-0667/${plan.id}/restart-readable-open-state-v4`,
    durabilityScope: `artifact://rpp-0667/${plan.id}/sandbox-process-boundary`,
  };
}

function spawnProductionOpen({
  filePath,
  plan,
  current,
  artifactRefs,
  claimId,
  now,
  truncate,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const childScript = `
    import { openProductionRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};

    try {
      const journal = openProductionRecoveryJournal({
        filePath: process.env.RPP0667_JOURNAL_PATH,
        plan: JSON.parse(process.env.RPP0667_PLAN),
        current: JSON.parse(process.env.RPP0667_CURRENT),
        artifactRefs: JSON.parse(process.env.RPP0667_ARTIFACT_REFS),
        now: new Date(process.env.RPP0667_NOW),
        truncate: process.env.RPP0667_TRUNCATE === 'true',
        claimId: process.env.RPP0667_CLAIM_ID,
      });

      console.log(JSON.stringify(journal.inspect()));
    } catch (error) {
      console.error(error?.stack || String(error));
      process.exit(2);
    }
  `;

  return spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0667_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0667_CLAIM_ID: claimId,
      RPP0667_CURRENT: JSON.stringify(current),
      RPP0667_JOURNAL_PATH: filePath,
      RPP0667_NOW: now.toISOString(),
      RPP0667_PLAN: JSON.stringify(plan),
      RPP0667_TRUNCATE: truncate ? 'true' : 'false',
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

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0667 evidence') {
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
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0667 journal rows');
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
  assert.ok(latestOpenRecord);

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

function assertProductionInspection(inspection, {
  claimId,
  rawSiteValues,
}) {
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.claimId, claimId);
  assert.equal(inspection.journal.claimHash, recoveryClaimHash(claimId));
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0667 writer inspection');
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
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0667 restart inspection');
}

function openStateEvidenceSummary({
  firstRows,
  restarted,
  latestOpenRecord,
}) {
  return {
    issue: 'RPP-0667',
    source: 'sandbox-child-process-open-parent-restart-readback',
    localRecoverySupport: {
      proved: restarted.integrity.status === 'ok' && restarted.openState.restartReadable === true,
      storage: restarted.storage || 'filesystem',
      processBoundary: 'child-open-parent-read',
      firstRowsPreserved: digest(firstRows) === digest(restarted.records.slice(0, firstRows.length)),
      durableRowsBeforeRetry: firstRows.length,
      durableRowsAfterRetry: restarted.openState.durableRows,
      openRowsAfterRetry: restarted.openState.openRows,
      latestOpenType: restarted.openState.latestOpenType,
      latestOpenHash: digest(latestOpenRecord),
      rowsBeforeRetryHash: digest(firstRows),
      rowsAfterRetryHash: digest(restarted.records),
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
  assert.equal(evidence.localRecoverySupport.processBoundary, 'child-open-parent-read');
  assert.equal(evidence.localRecoverySupport.firstRowsPreserved, true);
  assert.match(evidence.localRecoverySupport.latestOpenHash, hashPattern);
  assert.match(evidence.localRecoverySupport.rowsBeforeRetryHash, hashPattern);
  assert.match(evidence.localRecoverySupport.rowsAfterRetryHash, hashPattern);
  assert.equal(evidence.productionBackedDurableJournalProof.proved, false);
  assert.equal(evidence.productionBackedDurableJournalProof.reasonCode, 'LOCAL_SANDBOX_ONLY');
  assert.equal(evidence.releasePosture, 'NO-GO');
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0667 scope evidence');
}

test('RPP-0667 file-backed open state journal rows stay durable after process restart variant 4', () => {
  const filePath = tempJournalPath();
  fs.chmodSync(path.dirname(filePath), 0o700);
  const { plan, remote, rawSiteValues } = openStateFixture();
  const artifactRefs = artifactRefsFor(plan);
  const claimId = 'rpp-0667-open-state-v4-claim';

  const firstOpen = spawnProductionOpen({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
    now: fixedNow,
    truncate: true,
  });
  const firstOpenInspection = parseChildInspection(firstOpen);

  assertProductionInspection(firstOpenInspection, { claimId, rawSiteValues });

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
  assert.equal(firstOpenInspection.journal.records, afterFirstRestart.records.length);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0667 first journal file');

  const firstRows = cloneJson(afterFirstRestart.records);
  const firstInspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current: remote,
  });
  assertOldRemoteInspection(firstInspection, { plan, rawSiteValues });

  const retryOpen = spawnProductionOpen({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId,
    now: new Date(fixedNow.getTime() + 1_000),
    truncate: false,
  });
  const retryInspection = parseChildInspection(retryOpen);

  assertProductionInspection(retryInspection, { claimId, rawSiteValues });

  const afterRetryRestart = readRecoveryJournal(filePath);
  const retryOpenRecord = openRecords(afterRetryRestart.records).at(-1);

  assertRestartedOpenState(afterRetryRestart, {
    plan,
    current: remote,
    artifactRefs,
    expectedOpenRows: 2,
    expectedLatestType: 'journal-retry-opened',
    expectedLatestState: 'retrying-active-claim',
    rawSiteValues,
  });
  assert.equal(afterRetryRestart.records.length, firstRows.length + 1);
  assert.deepEqual(afterRetryRestart.records.slice(0, firstRows.length), firstRows);
  assert.equal(retryOpenRecord.sequence, afterRetryRestart.records.length);
  assert.equal(retryOpenRecord.claimId, claimId);
  assert.equal(retryOpenRecord.claimHash, recoveryClaimHash(claimId));
  assert.deepEqual(retryInspection.journal.openState, afterRetryRestart.openState);
  assert.equal(retryInspection.journal.records, afterRetryRestart.records.length);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0667 retry journal file');

  const retryRestartInspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current: remote,
  });
  assertOldRemoteInspection(retryRestartInspection, { plan, rawSiteValues });
  assert.equal(retryRestartInspection.journal.openState.latestOpenType, 'journal-retry-opened');

  const evidence = openStateEvidenceSummary({
    firstRows,
    restarted: afterRetryRestart,
    latestOpenRecord: retryOpenRecord,
  });
  assertEvidenceScope(evidence, rawSiteValues);
});
