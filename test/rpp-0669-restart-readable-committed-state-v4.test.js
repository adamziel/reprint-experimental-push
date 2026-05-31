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

const generatedCommittedStateCases = Object.freeze([
  {
    id: 'rpp-0669-committed-state-three-v4',
    mutationCount: 3,
  },
  {
    id: 'rpp-0669-committed-state-six-v4',
    mutationCount: 6,
  },
]);

function tempJournalPath(prefix = 'reprint-rpp-0669-committed-state-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0669-committed-state-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const base = {
    files: {
      [`${generatedCase.id}-preserved.txt`]:
        `base-raw-rpp-0669-${generatedCase.id}-preserved`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-raw-rpp-0669-${generatedCase.id}-target-${index}`;
  }

  const local = clone(base);
  const remote = clone(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-raw-rpp-0669-${generatedCase.id}-target-${index}`;
  }

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);

  const expectedCommitted = clone(remote);
  applyMutations(expectedCommitted, plan);

  return {
    plan,
    remote,
    expectedCommitted,
    rawSiteValues: rawSiteValuesFor(base, local, remote, expectedCommitted),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'base-raw-rpp-0669',
    'local-raw-rpp-0669',
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
    releaseProof: `artifact://rpp-0669/${generatedCase.id}/local-release-proof-not-production-durable`,
    recoverySupport: `artifact://rpp-0669/${generatedCase.id}/local-restart-readable-committed-state-v4`,
    durabilityScope: `artifact://rpp-0669/${generatedCase.id}/sandbox-file-backed-only`,
  };
}

function claimIdFor(generatedCase) {
  return `${generatedCase.id}-claim`;
}

function spawnCommittedWriter({
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

    const plan = JSON.parse(process.env.RPP0669_PLAN);
    const remote = JSON.parse(process.env.RPP0669_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0669_ARTIFACT_REFS);
    const durableJournal = openProductionRecoveryJournal({
      filePath: process.env.RPP0669_JOURNAL_PATH,
      plan,
      current: remote,
      artifactRefs,
      now: new Date(process.env.RPP0669_NOW),
      truncate: true,
      claimId: process.env.RPP0669_CLAIM_ID,
    });

    try {
      const result = applyPlan(remote, plan, {
        durableJournal,
        journal: JSON.parse(process.env.RPP0669_PREVIOUS_JOURNAL),
        mutateRemote: true,
        artifactRefs,
      });
      if (result.appliedMutations !== plan.mutations.length) {
        console.error(\`expected \${plan.mutations.length} applied mutations, saw \${result.appliedMutations}\`);
        process.exit(3);
      }
      console.log(JSON.stringify(durableJournal.inspect()));
      process.exit(0);
    } catch (error) {
      console.error(error?.stack || String(error));
      process.exit(2);
    }
  `;

  return spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0669_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0669_CLAIM_ID: claimId,
      RPP0669_JOURNAL_PATH: filePath,
      RPP0669_NOW: now.toISOString(),
      RPP0669_PLAN: JSON.stringify(plan),
      RPP0669_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0669_REMOTE_SITE: JSON.stringify(remote),
    },
    encoding: 'utf8',
  });
}

function writeCommittedJournalInProcess({
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
    const result = applyPlan(clone(remote), plan, {
      durableJournal,
      journal: oldRemoteJournalForPlan(remote, plan),
      mutateRemote: true,
      artifactRefs,
    });
    assert.equal(result.appliedMutations, plan.mutations.length);
    return durableJournal.inspect();
  } finally {
    durableJournal.close();
  }
}

function parseChildInspection(child) {
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.stdout.trim().length > 0, true);
  return JSON.parse(child.stdout);
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

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0669 evidence') {
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
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0669 journal rows');
}

function assertProductionLeaseOwnerAudit(inspection, {
  claimId,
  rawSiteValues,
}) {
  const claimHash = recoveryClaimHash(claimId);
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, 'active');
  assert.equal(inspection.claim.activeClaimId, claimId);
  assert.equal(inspection.claim.activeClaimHash, claimHash);
  assert.equal(inspection.journal.claimId, claimId);
  assert.equal(inspection.journal.claimHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimId, claimId);
  assert.equal(inspection.journal.writerLease.claimHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimKeyHash, claimHash);
  assert.equal(inspection.journal.writerLease.restartReadable, true);
  assert.equal(inspection.journal.writerLease.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.journal.leaseFence.writerLease.claimId, claimId);
  assert.equal(inspection.journal.leaseFence.writerLease.claimHash, claimHash);
  assert.equal(inspection.journal.leaseFence.writerLease.claimKeyHash, claimHash);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.monotonicSequence, true);
  assert.equal(inspection.journal.leaseFence.fsyncEvidence, true);
  assert.deepEqual(inspection.leaseFence, inspection.journal.leaseFence);
  assert.deepEqual(inspection.leaseFence.writerLease, inspection.journal.writerLease);
  assert.equal(inspection.journal.committedState.leaseOwner.visible, true);
  assert.equal(inspection.journal.committedState.leaseOwner.claimId, claimId);
  assert.equal(inspection.journal.committedState.leaseOwner.claimHash, claimHash);
  assert.equal(inspection.journal.committedState.leaseOwner.claimKeyHash, claimHash);
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0669 production lease audit');
}

function assertRestartedCommittedState(restarted, {
  plan,
  expectedCommitted,
  artifactRefs,
  claimId,
  expectedOpenRows,
  expectedLatestOpenState,
  rawSiteValues,
}) {
  const mutationRecords = recordsOfType(restarted.records, 'mutation-observed');
  const completedRecord = recordsOfType(restarted.records, 'journal-completed').at(-1);
  const latestMutation = plan.mutations.at(-1);
  const latestOpenRecord = openRecords(restarted.records).at(-1);
  const claimHash = recoveryClaimHash(claimId);

  assert.ok(completedRecord);
  assert.ok(latestOpenRecord);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.openState.restartReadable, true);
  assert.equal(restarted.openState.openRows, expectedOpenRows);
  assert.equal(restarted.openState.latestOpenSequence, latestOpenRecord.sequence);
  assert.equal(restarted.openState.latestOpenType, 'journal-retry-opened');
  assert.equal(restarted.openState.state, expectedLatestOpenState);
  assert.deepEqual(restarted.openState.artifactRefs, artifactRefs);
  assert.equal(restarted.stagedState.restartReadable, true);
  assert.equal(restarted.stagedState.stagedRows, 2);
  assert.equal(restarted.stagedState.latestStagedType, 'dependencies-validated');
  assert.equal(restarted.stagedState.stagedHash, digest(expectedCommitted));
  assert.equal(restarted.committedState.status, 'completed');
  assert.equal(restarted.committedState.phase, 'completed');
  assert.equal(restarted.committedState.restartReadable, true);
  assert.equal(restarted.committedState.records, restarted.records.length);
  assert.equal(restarted.committedState.durableRows, restarted.records.length);
  assert.equal(restarted.committedState.committedRows, plan.mutations.length + 1);
  assert.equal(restarted.committedState.mutationRows, plan.mutations.length);
  assert.equal(restarted.committedState.completedRows, 1);
  assert.equal(restarted.committedState.targetRows, plan.mutations.length);
  assert.equal(restarted.committedState.committedTargetRows, plan.mutations.length);
  assert.equal(restarted.committedState.firstCommittedSequence, mutationRecords[0].sequence);
  assert.equal(restarted.committedState.latestCommittedSequence, completedRecord.sequence);
  assert.equal(restarted.committedState.latestCommittedType, 'journal-completed');
  assert.equal(restarted.committedState.latestMutationSequence, mutationRecords.at(-1).sequence);
  assert.equal(restarted.committedState.latestCompletedSequence, completedRecord.sequence);
  assert.equal(restarted.committedState.planId, plan.id);
  assert.equal(restarted.committedState.state, 'completed');
  assert.equal(restarted.committedState.observedHash, digest(expectedCommitted));
  assert.equal(restarted.committedState.latestMutation.mutationId, latestMutation.id);
  assert.equal(restarted.committedState.latestMutation.resourceKey, latestMutation.resourceKey);
  assert.equal(restarted.committedState.latestMutation.afterHash, resourceHash(expectedCommitted, latestMutation.resource));
  assert.equal(
    restarted.committedState.latestMutation.observedHash,
    restarted.committedState.latestMutation.afterHash,
  );
  assert.deepEqual(restarted.committedState.targetEnvelope, {
    plannedTargets: plan.mutations.length,
    committedTargets: plan.mutations.length,
    allCommittedTargetsHaveHashes: true,
    allTargetsCommitted: true,
  });
  assert.deepEqual(restarted.committedState.leaseOwner, {
    visible: true,
    claimId,
    claimHash,
    claimKeyHash: claimHash,
    sequence: completedRecord.sequence,
    eventType: 'journal-completed',
  });
  assert.deepEqual(restarted.committedState.fsync, {
    requested: true,
    strategy: 'after-append',
  });
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    expectedSequences(restarted.records.length),
  );
  assert.equal(mutationRecords.length, plan.mutations.length);
  assert.ok(mutationRecords.every((record) => record.claimId === claimId));
  assert.ok(mutationRecords.every((record) => record.claimHash === claimHash));
  assert.equal(completedRecord.claimId, claimId);
  assert.equal(completedRecord.claimHash, claimHash);
  assert.equal(recordsOfType(restarted.records, 'target-planned').length, plan.mutations.length);
  assert.equal(recordsOfType(restarted.records, 'journal-ownership-recorded').length, 1);
  assert.equal(recordsOfType(restarted.records, 'recovery-claim-opened').length, 1);
  assert.equal(recordsOfType(restarted.records, 'apply-staged').length, 1);
  assert.equal(recordsOfType(restarted.records, 'dependencies-validated').length, 1);
  assert.equal(recordsOfType(restarted.records, 'apply-committing').length, 1);
  assert.ok(restarted.records.every((record) => record.fsync.requested === true));
  assertHashOnlyJournalRows(restarted.records, rawSiteValues);
}

function assertFullyUpdatedInspection(inspection, {
  plan,
  claimId,
  rawSiteValues,
}) {
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
  });
  assert.ok(inspection.targets.every((target) => target.state === 'new'));
  assert.equal(inspection.journal.committedState.restartReadable, true);
  assert.equal(inspection.journal.committedState.leaseOwner.visible, true);
  assert.equal(inspection.journal.committedState.leaseOwner.claimId, claimId);
  assert.equal(inspection.journal.committedState.leaseOwner.claimHash, recoveryClaimHash(claimId));
  assert.equal(inspection.journal.committedState.leaseOwner.claimKeyHash, recoveryClaimHash(claimId));
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0669 restart inspection');
}

function committedStateEvidenceSummary({
  source,
  restarted,
  completedRecord,
  writerInspection,
}) {
  const leaseOwner = restarted.committedState.leaseOwner;
  const writerLease = writerInspection?.journal?.writerLease || {};
  const fenceWriterLease = writerInspection?.journal?.leaseFence?.writerLease || {};
  return {
    issue: 'RPP-0669',
    source,
    localRecoverySupport: {
      proved: restarted.integrity.status === 'ok'
        && restarted.committedState.restartReadable === true
        && leaseOwner.visible === true,
      storage: restarted.storage || 'filesystem',
      durableRows: restarted.committedState.durableRows,
      committedRows: restarted.committedState.committedRows,
      mutationRows: restarted.committedState.mutationRows,
      completedRows: restarted.committedState.completedRows,
      targetRows: restarted.committedState.targetRows,
      latestCommittedType: restarted.committedState.latestCommittedType,
      observedHash: restarted.committedState.observedHash,
      latestCommittedHash: digest(completedRecord),
      journalRowsHash: digest(restarted.records),
    },
    leaseOwnerAudit: {
      visible: leaseOwner.visible,
      sourceEventType: leaseOwner.eventType,
      sourceSequence: leaseOwner.sequence,
      sourceRecordClaimId: completedRecord.claimId,
      sourceRecordClaimHash: completedRecord.claimHash,
      claimId: leaseOwner.claimId,
      claimHash: leaseOwner.claimHash,
      claimKeyHash: leaseOwner.claimKeyHash,
      writerLeaseClaimId: writerLease.claimId || null,
      writerLeaseClaimKeyHash: writerLease.claimKeyHash || null,
      leaseFenceWriterClaimId: fenceWriterLease.claimId || null,
      leaseFenceWriterClaimKeyHash: fenceWriterLease.claimKeyHash || null,
      identityVisible: leaseOwner.visible === true
        && leaseOwner.claimId === completedRecord.claimId
        && leaseOwner.claimId === writerLease.claimId
        && leaseOwner.claimId === fenceWriterLease.claimId,
      leaseOwnerHash: digest(leaseOwner),
    },
    productionBackedDurableJournalProof: {
      proved: false,
      reasonCode: 'LOCAL_SANDBOX_ONLY',
      requiredBoundary: 'live-production-backed-durable-journal',
    },
    releasePosture: 'NO-GO',
  };
}

function assertEvidenceScope(evidence, { claimId, rawSiteValues }) {
  assert.equal(evidence.localRecoverySupport.proved, true);
  assert.match(evidence.localRecoverySupport.observedHash, hashPattern);
  assert.match(evidence.localRecoverySupport.latestCommittedHash, hashPattern);
  assert.match(evidence.localRecoverySupport.journalRowsHash, hashPattern);
  assert.equal(evidence.leaseOwnerAudit.visible, true);
  assert.equal(evidence.leaseOwnerAudit.sourceEventType, 'journal-completed');
  assert.equal(evidence.leaseOwnerAudit.sourceRecordClaimId, claimId);
  assert.equal(evidence.leaseOwnerAudit.claimId, claimId);
  assert.equal(evidence.leaseOwnerAudit.writerLeaseClaimId, claimId);
  assert.equal(evidence.leaseOwnerAudit.leaseFenceWriterClaimId, claimId);
  assert.equal(evidence.leaseOwnerAudit.identityVisible, true);
  assert.match(evidence.leaseOwnerAudit.sourceRecordClaimHash, hashPattern);
  assert.match(evidence.leaseOwnerAudit.claimHash, hashPattern);
  assert.match(evidence.leaseOwnerAudit.claimKeyHash, hashPattern);
  assert.match(evidence.leaseOwnerAudit.writerLeaseClaimKeyHash, hashPattern);
  assert.match(evidence.leaseOwnerAudit.leaseFenceWriterClaimKeyHash, hashPattern);
  assert.match(evidence.leaseOwnerAudit.leaseOwnerHash, hashPattern);
  assert.equal(evidence.productionBackedDurableJournalProof.proved, false);
  assert.equal(evidence.productionBackedDurableJournalProof.reasonCode, 'LOCAL_SANDBOX_ONLY');
  assert.equal(evidence.releasePosture, 'NO-GO');
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0669 scope evidence');
}

test('RPP-0669 generated file-backed committed rows survive restart and expose lease owner identity variant 4', () => {
  for (const generatedCase of generatedCommittedStateCases) {
    const filePath = tempJournalPath();
    fs.chmodSync(path.dirname(filePath), 0o700);
    const {
      plan,
      remote,
      expectedCommitted,
      rawSiteValues,
    } = generatedSites(generatedCase);
    const artifactRefs = artifactRefsFor(generatedCase);
    const claimId = claimIdFor(generatedCase);

    const writer = spawnCommittedWriter({
      filePath,
      plan,
      remote,
      artifactRefs,
      claimId,
      now: fixedNow,
    });
    const writerInspection = parseChildInspection(writer);

    assertProductionLeaseOwnerAudit(writerInspection, { claimId, rawSiteValues });
    assert.equal(writerInspection.journal.productionAdapter, 'openProductionRecoveryJournal');
    assert.equal(writerInspection.journal.restartReadable, true);
    assert.equal(writerInspection.journal.committedState.restartReadable, true);
    assert.equal(writerInspection.journal.committedState.latestCommittedType, 'journal-completed');
    assert.equal(writerInspection.journal.committedState.leaseOwner.eventType, 'journal-completed');

    const afterFirstRestart = readRecoveryJournal(filePath);
    assertRestartedCommittedState(afterFirstRestart, {
      plan,
      expectedCommitted,
      artifactRefs,
      claimId,
      expectedOpenRows: 2,
      expectedLatestOpenState: 'retrying-old-remote',
      rawSiteValues,
    });
    assert.deepEqual(writerInspection.journal.committedState, afterFirstRestart.committedState);
    assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0669 first journal file');

    const firstInspection = inspectRecoveryJournal({
      journal: afterFirstRestart,
      plan,
      current: expectedCommitted,
    });
    assertFullyUpdatedInspection(firstInspection, { plan, claimId, rawSiteValues });

    const firstEvidence = committedStateEvidenceSummary({
      source: 'sandbox-file-backed-committed-state-before-retry',
      restarted: afterFirstRestart,
      completedRecord: recordsOfType(afterFirstRestart.records, 'journal-completed').at(-1),
      writerInspection,
    });
    assertEvidenceScope(firstEvidence, { claimId, rawSiteValues });

    const retryJournal = openProductionRecoveryJournal({
      filePath,
      plan,
      current: expectedCommitted,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 1_000),
      truncate: false,
      claimId,
    });
    const retryInspection = retryJournal.inspect();
    retryJournal.close();

    const afterProductionRetry = readRecoveryJournal(filePath);
    const completedRecord = recordsOfType(afterProductionRetry.records, 'journal-completed').at(-1);
    const retryRecord = openRecords(afterProductionRetry.records).at(-1);

    assertProductionLeaseOwnerAudit(retryInspection, { claimId, rawSiteValues });
    assert.equal(afterProductionRetry.records.length, afterFirstRestart.records.length + 1);
    assert.equal(retryRecord.type, 'journal-retry-opened');
    assert.equal(retryRecord.state, 'retrying-active-claim');
    assert.equal(retryRecord.claimId, claimId);
    assert.equal(retryRecord.claimHash, recoveryClaimHash(claimId));
    assert.deepEqual(retryInspection.journal.committedState, afterProductionRetry.committedState);
    assertRestartedCommittedState(afterProductionRetry, {
      plan,
      expectedCommitted,
      artifactRefs,
      claimId,
      expectedOpenRows: 3,
      expectedLatestOpenState: 'retrying-active-claim',
      rawSiteValues,
    });
    assert.equal(
      afterProductionRetry.committedState.latestCompletedSequence,
      afterFirstRestart.committedState.latestCompletedSequence,
    );
    assert.equal(afterProductionRetry.committedState.leaseOwner.sequence, completedRecord.sequence);

    const retryRestartInspection = inspectRecoveryJournal({
      journal: afterProductionRetry,
      plan,
      current: expectedCommitted,
    });
    assertFullyUpdatedInspection(retryRestartInspection, { plan, claimId, rawSiteValues });

    const retryEvidence = committedStateEvidenceSummary({
      source: 'sandbox-file-backed-committed-state-after-retry',
      restarted: afterProductionRetry,
      completedRecord,
      writerInspection: retryInspection,
    });
    assertEvidenceScope(retryEvidence, { claimId, rawSiteValues });
    assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0669 retry journal file');
  }
});

test('RPP-0669 stale and invalid committed restart state fails closed with hash-only evidence variant 4', () => {
  const generatedCase = generatedCommittedStateCases[0];
  const filePath = tempJournalPath();
  const invalidPath = tempJournalPath('reprint-rpp-0669-invalid-committed-state-');
  fs.chmodSync(path.dirname(filePath), 0o700);
  fs.chmodSync(path.dirname(invalidPath), 0o700);
  const {
    plan,
    remote,
    expectedCommitted,
    rawSiteValues,
  } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);
  const claimId = claimIdFor(generatedCase);

  const writer = spawnCommittedWriter({
    filePath,
    plan,
    remote,
    artifactRefs,
    claimId,
    now: fixedNow,
  });
  parseChildInspection(writer);

  const beforeStaleAttempt = readRecoveryJournal(filePath);
  assertRestartedCommittedState(beforeStaleAttempt, {
    plan,
    expectedCommitted,
    artifactRefs,
    claimId,
    expectedOpenRows: 2,
    expectedLatestOpenState: 'retrying-old-remote',
    rawSiteValues,
  });

  const stalePlan = {
    ...plan,
    id: `${plan.id}-stale-restart-state`,
  };
  const staleInspection = inspectRecoveryJournal({
    journal: beforeStaleAttempt,
    plan: stalePlan,
    current: expectedCommitted,
  });
  assert.equal(staleInspection.status, 'blocked-recovery');
  assert.equal(staleInspection.reasonCode, 'BLOCKED_JOURNAL_INTEGRITY');
  assert.deepEqual(staleInspection.counts, {
    old: 0,
    new: 0,
    blockedUnknown: stalePlan.mutations.length,
  });
  assert.equal(staleInspection.journal.integrity.status, 'blocked');
  assertNoRawSiteValues(staleInspection, rawSiteValues, 'RPP-0669 stale restart inspection');

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan: stalePlan,
      current: expectedCommitted,
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
  assert.equal(
    afterStaleAttempt.committedState.latestCompletedSequence,
    beforeStaleAttempt.committedState.latestCompletedSequence,
  );
  assertHashOnlyJournalRows(afterStaleAttempt.records, rawSiteValues);

  const validText = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(invalidPath, validText.replace(/\n$/, ''));
  const invalidBeforeText = fs.readFileSync(invalidPath, 'utf8');
  const invalidRead = readRecoveryJournal(invalidPath);

  assert.equal(invalidRead.integrity.status, 'blocked');
  assert.equal(invalidRead.committedState.status, 'completed');
  assert.equal(invalidRead.committedState.restartReadable, false);
  assert.equal(invalidRead.committedState.durableRows, 0);
  assert.equal(invalidRead.committedState.completedRows, 1);
  assert.equal(invalidRead.committedState.leaseOwner.visible, true);
  assert.equal(invalidRead.committedState.leaseOwner.claimHash, recoveryClaimHash(claimId));
  assert.equal(invalidRead.integrity.errors.some((error) => error.code === 'JOURNAL_TRUNCATED'), true);
  assertNoRawSiteValues(invalidRead, rawSiteValues, 'RPP-0669 invalid restart readback');

  const invalidInspection = inspectRecoveryJournal({
    journal: invalidRead,
    plan,
    current: expectedCommitted,
  });
  assert.equal(invalidInspection.status, 'blocked-recovery');
  assert.equal(invalidInspection.reasonCode, 'BLOCKED_JOURNAL_INTEGRITY');
  assert.deepEqual(invalidInspection.counts, {
    old: 0,
    new: 0,
    blockedUnknown: plan.mutations.length,
  });
  assertNoRawSiteValues(invalidInspection, rawSiteValues, 'RPP-0669 invalid restart inspection');

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath: invalidPath,
      plan,
      current: expectedCommitted,
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
  assert.equal(invalidAfter.committedState.restartReadable, false);
  assertHashOnlyJournalRows(invalidAfter.records, rawSiteValues);
});

test('RPP-0669 SQLite committed state readback mirrors restart-readable rows and corrupt rows fail closed variant 4', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const generatedCase = generatedCommittedStateCases[1];
  const filePath = tempJournalPath();
  const sqlitePath = tempSqlitePath();
  const corruptSqlitePath = tempSqlitePath();
  const {
    plan,
    remote,
    expectedCommitted,
    rawSiteValues,
  } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);
  const claimId = claimIdFor(generatedCase);

  const writerInspection = writeCommittedJournalInProcess({
    filePath,
    plan,
    remote,
    artifactRefs,
    claimId,
    now: fixedNow,
  });
  assertProductionLeaseOwnerAudit(writerInspection, { claimId, rawSiteValues });

  const seeded = readRecoveryJournal(filePath);
  assertRestartedCommittedState(seeded, {
    plan,
    expectedCommitted,
    artifactRefs,
    claimId,
    expectedOpenRows: 2,
    expectedLatestOpenState: 'retrying-old-remote',
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
    assert.deepEqual(restarted.committedState, seeded.committedState);
    assertRestartedCommittedState(restarted, {
      plan,
      expectedCommitted,
      artifactRefs,
      claimId,
      expectedOpenRows: 2,
      expectedLatestOpenState: 'retrying-old-remote',
      rawSiteValues,
    });

    const sqliteInspection = inspectRecoveryJournal({
      journal: restarted,
      plan,
      current: expectedCommitted,
    });
    assertFullyUpdatedInspection(sqliteInspection, { plan, claimId, rawSiteValues });

    const sqliteEvidence = committedStateEvidenceSummary({
      source: 'sandbox-sqlite-committed-state-readback',
      restarted,
      completedRecord: recordsOfType(restarted.records, 'journal-completed').at(-1),
      writerInspection,
    });
    assertEvidenceScope(sqliteEvidence, { claimId, rawSiteValues });
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
    assert.equal(corruptRead.committedState.status, 'completed');
    assert.equal(corruptRead.committedState.restartReadable, false);
    assert.equal(corruptRead.committedState.durableRows, 0);
    assert.equal(corruptRead.committedState.leaseOwner.visible, true);
    assert.equal(corruptRead.committedState.leaseOwner.claimHash, recoveryClaimHash(claimId));
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
      current: expectedCommitted,
    });
    assert.equal(corruptInspection.status, 'blocked-recovery');
    assert.equal(corruptInspection.reasonCode, 'BLOCKED_JOURNAL_INTEGRITY');
    assert.deepEqual(corruptInspection.counts, {
      old: 0,
      new: 0,
      blockedUnknown: plan.mutations.length,
    });
    assertNoRawSiteValues(corruptInspection, rawSiteValues, 'RPP-0669 corrupt SQLite inspection');
  } finally {
    database.close();
  }
});
