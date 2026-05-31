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
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

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
    id: 'rpp-0689-committed-state-three-v5',
    mutationCount: 3,
  },
  {
    id: 'rpp-0689-committed-state-six-v5',
    mutationCount: 6,
  },
]);

function tempJournalPath(prefix = 'reprint-rpp-0689-committed-state-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0689-committed-state-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const base = {
    files: {
      [`${generatedCase.id}-preserved.txt`]:
        `base-raw-rpp-0689-${generatedCase.id}-preserved`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-raw-rpp-0689-${generatedCase.id}-target-${index}`;
  }

  const local = clone(base);
  const remote = clone(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-raw-rpp-0689-${generatedCase.id}-target-${index}`;
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
    'base-raw-rpp-0689',
    'local-raw-rpp-0689',
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
    releaseProof: `artifact://rpp-0689/${generatedCase.id}/local-release-proof-not-production-durable`,
    recoverySupport: `artifact://rpp-0689/${generatedCase.id}/local-restart-readable-committed-state-v5`,
    durabilityScope: `artifact://rpp-0689/${generatedCase.id}/sandbox-file-backed-only`,
  };
}

function claimIdFor(generatedCase) {
  return `${generatedCase.id}-claim`;
}

function activeReleaseClaimIdFor(generatedCase) {
  return `${generatedCase.id}-active-release-claim`;
}

function retryReleaseClaimIdFor(generatedCase) {
  return `${generatedCase.id}-release-verifier-retry-claim`;
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

    const plan = JSON.parse(process.env.RPP0689_PLAN);
    const remote = JSON.parse(process.env.RPP0689_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0689_ARTIFACT_REFS);
    const durableJournal = openProductionRecoveryJournal({
      filePath: process.env.RPP0689_JOURNAL_PATH,
      plan,
      current: remote,
      artifactRefs,
      now: new Date(process.env.RPP0689_NOW),
      truncate: true,
      claimId: process.env.RPP0689_CLAIM_ID,
    });

    try {
      const result = applyPlan(remote, plan, {
        durableJournal,
        journal: JSON.parse(process.env.RPP0689_PREVIOUS_JOURNAL),
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
      RPP0689_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0689_CLAIM_ID: claimId,
      RPP0689_JOURNAL_PATH: filePath,
      RPP0689_NOW: now.toISOString(),
      RPP0689_PLAN: JSON.stringify(plan),
      RPP0689_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0689_REMOTE_SITE: JSON.stringify(remote),
    },
    encoding: 'utf8',
  });
}

function seedActiveReleaseClaim({
  filePath,
  plan,
  remote,
  artifactRefs,
  claimId,
  now,
  claimStaleThresholdMs,
}) {
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now,
    truncate: true,
    claimId,
    claimStaleThresholdMs,
  });
  try {
    return journal.inspect();
  } finally {
    journal.close();
  }
}

function spawnReleaseVerifierCommittedWriter({
  filePath,
  plan,
  remote,
  artifactRefs,
  claimId,
  now,
  claimStaleThresholdMs,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const recoveryInspectModule = new URL('../src/recovery-inspect.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const childScript = `
    import {
      openProductionRecoveryJournal,
      readRecoveryJournal,
    } from ${JSON.stringify(recoveryJournalModule)};
    import { inspectRecoveryJournal } from ${JSON.stringify(recoveryInspectModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};

    const plan = JSON.parse(process.env.RPP0689_PLAN);
    const remote = JSON.parse(process.env.RPP0689_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0689_ARTIFACT_REFS);
    const durableJournal = openProductionRecoveryJournal({
      filePath: process.env.RPP0689_JOURNAL_PATH,
      plan,
      current: remote,
      artifactRefs,
      now: new Date(process.env.RPP0689_NOW),
      truncate: false,
      claimId: process.env.RPP0689_CLAIM_ID,
      claimStaleThresholdMs: Number(process.env.RPP0689_CLAIM_STALE_THRESHOLD_MS),
    });

    try {
      const oldRemoteInspection = inspectRecoveryJournal({
        journal: readRecoveryJournal(process.env.RPP0689_JOURNAL_PATH),
        plan,
        current: remote,
      });
      const oldRemoteRecovery = {
        source: 'RPP-0689 release-verifier restart inspect before committed apply',
        status: 200,
        state: oldRemoteInspection.status,
        observedState: oldRemoteInspection.status,
        counts: {
          ...oldRemoteInspection.counts,
          total: plan.mutations.length,
        },
        targetEnvelope: {
          plannedTargets: plan.mutations.length,
          checkedPath: process.env.RPP0689_JOURNAL_PATH,
          allOldTargetsHaveHashes: oldRemoteInspection.targets.every((target) => (
            target.observedHash === target.beforeHash
            && target.observedHash !== target.afterHash
          )),
        },
      };
      const result = applyPlan(remote, plan, {
        durableJournal,
        journal: JSON.parse(process.env.RPP0689_PREVIOUS_JOURNAL),
        mutateRemote: true,
        artifactRefs,
      });
      if (result.appliedMutations !== plan.mutations.length) {
        console.error(\`expected \${plan.mutations.length} applied mutations, saw \${result.appliedMutations}\`);
        process.exit(3);
      }
      console.log(JSON.stringify({
        writerInspection: durableJournal.inspect(),
        oldRemoteRecovery,
      }));
      process.exit(0);
    } catch (error) {
      console.error(error?.stack || String(error));
      process.exit(2);
    }
  `;

  return spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0689_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0689_CLAIM_ID: claimId,
      RPP0689_CLAIM_STALE_THRESHOLD_MS: String(claimStaleThresholdMs),
      RPP0689_JOURNAL_PATH: filePath,
      RPP0689_NOW: now.toISOString(),
      RPP0689_PLAN: JSON.stringify(plan),
      RPP0689_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0689_REMOTE_SITE: JSON.stringify(remote),
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

function parseChildReleaseVerifierOutput(child) {
  const output = parseChildInspection(child);
  assert.ok(output.writerInspection);
  assert.ok(output.oldRemoteRecovery);
  return output;
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

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0689 evidence') {
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
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0689 journal rows');
}

function assertProductionLeaseOwnerAudit(inspection, {
  claimId,
  expectedStatus = 'active',
  previousClaimId = null,
  staleClaimRejected = false,
  claimExpired = false,
  previousClaimAgeMs = null,
  rawSiteValues,
}) {
  const claimHash = recoveryClaimHash(claimId);
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, expectedStatus);
  assert.equal(inspection.claim.activeClaimId, claimId);
  assert.equal(inspection.claim.activeClaimHash, claimHash);
  assert.equal(inspection.claim.previousClaimId, previousClaimId);
  assert.equal(inspection.claim.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.claim.claimExpiry.expired, claimExpired);
  if (previousClaimAgeMs !== null) {
    assert.equal(inspection.claim.claimExpiry.previousClaimAgeMs, previousClaimAgeMs);
  }
  assert.equal(inspection.journal.claimId, claimId);
  assert.equal(inspection.journal.claimHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimId, claimId);
  assert.equal(inspection.journal.writerLease.claimHash, claimHash);
  assert.equal(inspection.journal.writerLease.claimKeyHash, claimHash);
  assert.equal(inspection.journal.writerLease.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.journal.writerLease.claimExpiry.expired, claimExpired);
  assert.equal(inspection.journal.writerLease.restartReadable, true);
  assert.equal(inspection.journal.writerLease.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.journal.leaseFence.writerLease.claimId, claimId);
  assert.equal(inspection.journal.leaseFence.writerLease.claimHash, claimHash);
  assert.equal(inspection.journal.leaseFence.writerLease.claimKeyHash, claimHash);
  assert.equal(inspection.journal.leaseFence.staleClaimRejected, staleClaimRejected);
  assert.equal(inspection.journal.leaseFence.claimExpiry.expired, claimExpired);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.monotonicSequence, true);
  assert.equal(inspection.journal.leaseFence.fsyncEvidence, true);
  assert.deepEqual(inspection.leaseFence, inspection.journal.leaseFence);
  assert.deepEqual(inspection.leaseFence.writerLease, inspection.journal.writerLease);
  assert.equal(inspection.journal.committedState.leaseOwner.visible, true);
  assert.equal(inspection.journal.committedState.leaseOwner.claimId, claimId);
  assert.equal(inspection.journal.committedState.leaseOwner.claimHash, claimHash);
  assert.equal(inspection.journal.committedState.leaseOwner.claimKeyHash, claimHash);
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0689 production lease audit');
}

function assertRestartedCommittedState(restarted, {
  plan,
  expectedCommitted,
  artifactRefs,
  claimId,
  expectedOpenRows,
  expectedLatestOpenState,
  expectedOwnershipRows = 1,
  expectedRecoveryClaimRows = 1,
  expectedAdvancedClaimRows = 0,
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
  assert.equal(recordsOfType(restarted.records, 'journal-ownership-recorded').length, expectedOwnershipRows);
  assert.equal(recordsOfType(restarted.records, 'recovery-claim-opened').length, expectedRecoveryClaimRows);
  assert.equal(recordsOfType(restarted.records, 'stale-claim-advanced').length, expectedAdvancedClaimRows);
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
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0689 restart inspection');
}

function buildReleaseVerifierAuditCandidate({
  plan,
  restarted,
  completedRecord,
  writerInspection,
}) {
  const claim = writerInspection.journal.claim;
  const writerLease = writerInspection.journal.writerLease;
  const fenceWriterLease = writerInspection.journal.leaseFence.writerLease;
  const leaseOwner = restarted.committedState.leaseOwner;

  return {
    schemaVersion: 1,
    kind: 'manual-recovery-audit-export',
    format: 'hash-only',
    rawValuesIncluded: false,
    sameReleaseBoundary: true,
    source: 'RPP-0689 release-verifier committed-state audit',
    sourceUrl: 'http://127.0.0.1:8080',
    targetEnvelope: {
      total: plan.mutations.length,
      hashOnly: true,
      rawValuesIncluded: false,
      committedTargets: restarted.committedState.committedTargetRows,
      allTargetsCommitted: restarted.committedState.targetEnvelope.allTargetsCommitted,
    },
    leaseOwnerIdentity: {
      activeClaimId: claim.activeClaimId,
      activeClaimKeyHash: claim.activeClaimHash,
      writerLeaseClaimId: writerLease.claimId,
      writerLeaseClaimKeyHash: writerLease.claimKeyHash,
      leaseFenceClaimId: fenceWriterLease.claimId,
      leaseFenceClaimKeyHash: fenceWriterLease.claimKeyHash,
      matches: claim.activeClaimId === writerLease.claimId
        && claim.activeClaimId === fenceWriterLease.claimId
        && claim.activeClaimHash === writerLease.claimKeyHash
        && claim.activeClaimHash === fenceWriterLease.claimKeyHash,
    },
    committedStateLeaseOwner: {
      visible: leaseOwner.visible,
      sourceEventType: leaseOwner.eventType,
      sourceSequence: leaseOwner.sequence,
      sourceRecordClaimId: completedRecord.claimId,
      sourceRecordClaimHash: completedRecord.claimHash,
      claimId: leaseOwner.claimId,
      claimHash: leaseOwner.claimHash,
      claimKeyHash: leaseOwner.claimKeyHash,
      writerLeaseClaimId: writerLease.claimId,
      writerLeaseClaimKeyHash: writerLease.claimKeyHash,
      leaseFenceWriterClaimId: fenceWriterLease.claimId,
      leaseFenceWriterClaimKeyHash: fenceWriterLease.claimKeyHash,
      identityVisible: leaseOwner.visible === true
        && leaseOwner.claimId === completedRecord.claimId
        && leaseOwner.claimId === writerLease.claimId
        && leaseOwner.claimId === fenceWriterLease.claimId,
      leaseOwnerHash: digest(leaseOwner),
    },
  };
}

function buildReleaseVerifierRecoverySummary({
  writerInspection,
  plan,
  oldRemoteRecovery,
  auditEvidence,
}) {
  const mutationEvents = plan.mutations.length;
  const originalRequestHash = '8'.repeat(64);
  const conflictingRequestHash = '9'.repeat(64);
  const latestEvents = [
    { sequence: 1, event: 'idempotency-opened', requestHash: originalRequestHash },
    { sequence: 2, event: 'apply-started', requestHash: originalRequestHash },
    ...Array.from({ length: mutationEvents }, (_, index) => ({
      sequence: 3 + index,
      event: 'mutation-applied',
      requestHash: originalRequestHash,
    })),
    { sequence: 3 + mutationEvents, event: 'apply-committed', requestHash: originalRequestHash },
    { sequence: 4 + mutationEvents, event: 'apply-replayed', requestHash: originalRequestHash },
    { sequence: 5 + mutationEvents, event: 'idempotency-key-conflict', requestHash: conflictingRequestHash },
  ];

  return {
    topology: {
      sourceUrl: 'http://127.0.0.1:8080',
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    durableJournal: {
      proof: writerInspection,
    },
    releaseProof: {
      plan: {
        mutations: mutationEvents,
      },
      recoveryInspect: {
        status: 200,
        recovery: {
          state: 'fully-updated-remote',
          journalState: 'ok',
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
          },
          manualRecoveryAuditExport: auditEvidence,
        },
      },
      replay: {
        idempotency: {
          replayed: true,
          freshMutationWork: false,
        },
      },
      idempotencyConflict: {
        status: 409,
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        idempotency: {
          conflict: true,
          freshMutationWork: false,
          requestHash: conflictingRequestHash,
          originalRequestHash,
        },
        targetSnapshotUnchanged: true,
        recoveryState: {
          source: 'RPP-0689 release-verifier recovery inspect after different-body conflict',
          storage: 'sqlite',
          state: 'fully-updated-remote',
          restartReadable: true,
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
          },
        },
      },
      dbJournal: {
        mutationApplied: mutationEvents,
        eventCounts: {
          'idempotency-key-conflict': 1,
        },
        latestEvents,
      },
      staleClaimRetry: {
        oldRemoteRecovery,
        abandoned: {
          status: 500,
          code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
          recovery: oldRemoteRecovery,
        },
      },
      replayAndRetry: {
        required: '/snapshot',
        observed: '/snapshot',
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function buildBlockedApplyRevalidation(plan) {
  return {
    ok: true,
    apply: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      applied: 0,
      applyRevalidation: {
        phase: 'before-first-mutation',
        checkedAgainst: 'live-remote',
      },
    },
    replay: {
      status: 412,
      code: 'PRECONDITION_FAILED',
      replayed: true,
      freshMutationWork: false,
      preservedRemoteUnchanged: true,
    },
    recoveryInspect: {
      recovery: {
        state: 'blocked-recovery',
        counts: {
          old: plan.mutations.length - 1,
          new: 0,
          blockedUnknown: 1,
          total: plan.mutations.length,
        },
      },
    },
    dbJournal: {
      ordering: {
        ordered: true,
        applyRejected: 20,
        applyReplayed: 21,
        mutationAppliedBeforeFailure: 0,
        applyCommitted: false,
      },
    },
    durableJournal: {
      checkedAccepted: true,
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      durableJournal: {
        verdict: 'LIVE_RELEASE_BOUNDARY_OK',
      },
    },
  };
}

function committedStateEvidenceSummary({
  source,
  restarted,
  completedRecord,
  writerInspection,
  releaseProof = null,
}) {
  const leaseOwner = restarted.committedState.leaseOwner;
  const writerLease = writerInspection?.journal?.writerLease || {};
  const fenceWriterLease = writerInspection?.journal?.leaseFence?.writerLease || {};
  return {
    issue: 'RPP-0689',
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
    releaseVerifierAudit: releaseProof
      ? {
          gate: releaseProof.gate,
          boundary: releaseProof.durableRecoveryJournalBoundary,
          ok: releaseProof.ok === true,
          gateStatus: releaseProof.gateStatus,
          leaseOwnerIdentityVisible: releaseProof.leaseOwnerIdentity.matches === true,
          auditExportProved: releaseProof.manualRecoveryAuditExport.proved === true,
          auditExportHashOnly: releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly === true,
          auditExportLeaseOwnerVisible:
            releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.identityVisible === true,
          activeClaimId: releaseProof.leaseOwnerIdentity.activeClaimId,
          writerLeaseClaimId: releaseProof.leaseOwnerIdentity.writerLeaseClaimId,
          leaseFenceClaimId: releaseProof.leaseOwnerIdentity.leaseFenceClaimId,
          committedLeaseOwnerClaimId:
            releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.claimId,
          committedLeaseOwnerHash:
            releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.leaseOwnerHash,
        }
      : null,
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
  if (evidence.releaseVerifierAudit) {
    assert.equal(evidence.releaseVerifierAudit.gate, 'GATE-2');
    assert.equal(evidence.releaseVerifierAudit.boundary, 'release-verifier');
    assert.equal(evidence.releaseVerifierAudit.ok, true);
    assert.equal(evidence.releaseVerifierAudit.gateStatus, 'proven');
    assert.equal(evidence.releaseVerifierAudit.leaseOwnerIdentityVisible, true);
    assert.equal(evidence.releaseVerifierAudit.auditExportProved, true);
    assert.equal(evidence.releaseVerifierAudit.auditExportHashOnly, true);
    assert.equal(evidence.releaseVerifierAudit.auditExportLeaseOwnerVisible, true);
    assert.equal(evidence.releaseVerifierAudit.activeClaimId, claimId);
    assert.equal(evidence.releaseVerifierAudit.writerLeaseClaimId, claimId);
    assert.equal(evidence.releaseVerifierAudit.leaseFenceClaimId, claimId);
    assert.equal(evidence.releaseVerifierAudit.committedLeaseOwnerClaimId, claimId);
    assert.match(evidence.releaseVerifierAudit.committedLeaseOwnerHash, hashPattern);
  }
  assert.equal(evidence.productionBackedDurableJournalProof.proved, false);
  assert.equal(evidence.productionBackedDurableJournalProof.reasonCode, 'LOCAL_SANDBOX_ONLY');
  assert.equal(evidence.releasePosture, 'NO-GO');
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0689 scope evidence');
}

function assertReleaseVerifierCommittedStateProof(releaseProof, {
  plan,
  claimId,
  oldRemoteRecovery,
  rawSiteValues,
}) {
  const claimHash = recoveryClaimHash(claimId);
  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.sourceUrl, 'http://127.0.0.1:8080');
  assert.equal(releaseProof.checks.ownsJournal, true);
  assert.equal(releaseProof.checks.restartReadable, true);
  assert.equal(releaseProof.checks.leaseOwnerIdentity, true);
  assert.equal(releaseProof.checks.staleOwnerFencing, true);
  assert.equal(releaseProof.checks.claimExpiryPolicy, true);
  assert.equal(releaseProof.checks.recoveryInspectAfterRestart, true);
  assert.equal(releaseProof.checks.oldState, true);
  assert.equal(releaseProof.checks.newState, true);
  assert.equal(releaseProof.checks.blockedState, true);
  assert.equal(releaseProof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(releaseProof.checks.sameKeyDifferentBodyConflict, true);
  assert.equal(releaseProof.checks.preservedRejectedRemoteEvidence, true);
  assert.equal(releaseProof.checks.manualRecoveryAuditExport, true);
  assert.equal(releaseProof.leaseOwnerIdentity.activeClaimId, claimId);
  assert.equal(releaseProof.leaseOwnerIdentity.activeClaimKeyHash, claimHash);
  assert.equal(releaseProof.leaseOwnerIdentity.writerLeaseClaimId, claimId);
  assert.equal(releaseProof.leaseOwnerIdentity.writerLeaseClaimKeyHash, claimHash);
  assert.equal(releaseProof.leaseOwnerIdentity.leaseFenceClaimId, claimId);
  assert.equal(releaseProof.leaseOwnerIdentity.leaseFenceClaimKeyHash, claimHash);
  assert.equal(releaseProof.leaseOwnerIdentity.matches, true);
  assert.equal(releaseProof.staleOwnerFencing.proved, true);
  assert.equal(releaseProof.claimExpiryPolicy.proved, true);
  assert.equal(releaseProof.claimExpiryPolicy.previousClaimExpired, true);
  assert.equal(releaseProof.recoveryInspectAfterRestart.proved, true);
  assert.equal(releaseProof.recoveryInspectAfterRestart.state, 'fully-updated-remote');
  assert.equal(releaseProof.recoveryInspectAfterRestart.journalState, 'ok');
  assert.deepEqual(releaseProof.recoveryInspectAfterRestart.counts, {
    old: 0,
    new: plan.mutations.length,
    blockedUnknown: 0,
    total: plan.mutations.length,
  });
  assert.equal(releaseProof.partialStates.old.proved, true);
  assert.equal(releaseProof.partialStates.old.source, oldRemoteRecovery.source);
  assert.equal(releaseProof.partialStates.old.state, 'old-remote');
  assert.deepEqual(releaseProof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(releaseProof.partialStates.new.proved, true);
  assert.equal(releaseProof.partialStates.blocked.proved, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.proved, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.proved, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.format, 'hash-only');
  assert.equal(releaseProof.manualRecoveryAuditExport.rawValuesIncluded, false);
  assert.equal(releaseProof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.total, plan.mutations.length);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assert.equal(releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity.activeClaimId, claimId);
  assert.equal(releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity.activeClaimKeyHash, claimHash);
  assert.equal(releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity.writerLeaseClaimId, claimId);
  assert.equal(releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity.writerLeaseClaimKeyHash, claimHash);
  assert.equal(releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity.leaseFenceClaimId, claimId);
  assert.equal(releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity.leaseFenceClaimKeyHash, claimHash);
  assert.equal(releaseProof.manualRecoveryAuditExport.leaseOwnerIdentity.matches, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.visible, true);
  assert.equal(
    releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.sourceEventType,
    'journal-completed',
  );
  assert.equal(releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.claimId, claimId);
  assert.equal(releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.claimHash, claimHash);
  assert.equal(releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.claimKeyHash, claimHash);
  assert.equal(
    releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.writerLeaseClaimId,
    claimId,
  );
  assert.equal(
    releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.leaseFenceWriterClaimId,
    claimId,
  );
  assert.equal(releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.identityVisible, true);
  assert.match(releaseProof.manualRecoveryAuditExport.committedStateLeaseOwner.leaseOwnerHash, hashPattern);
  assertNoRawSiteValues(releaseProof, rawSiteValues, 'RPP-0689 release verifier proof');
}

test('RPP-0689 release verifier audit exposes restart-readable committed lease owner identity variant 5', () => {
  const generatedCase = generatedCommittedStateCases[0];
  const filePath = tempJournalPath('reprint-rpp-0689-release-verifier-committed-state-');
  fs.chmodSync(path.dirname(filePath), 0o700);
  const {
    plan,
    remote,
    expectedCommitted,
    rawSiteValues,
  } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);
  const activeClaimId = activeReleaseClaimIdFor(generatedCase);
  const retryClaimId = retryReleaseClaimIdFor(generatedCase);
  const claimStaleThresholdMs = 2_000;

  const activeInspection = seedActiveReleaseClaim({
    filePath,
    plan,
    remote,
    artifactRefs,
    claimId: activeClaimId,
    now: fixedNow,
    claimStaleThresholdMs,
  });
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(activeInspection), true);
  assert.equal(activeInspection.claim.status, 'active');
  assert.equal(activeInspection.claim.activeClaimId, activeClaimId);
  assert.equal(activeInspection.claim.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(activeInspection.claim.claimExpiry.expired, false);
  assert.equal(activeInspection.journal.writerLease.claimId, activeClaimId);
  assertNoRawSiteValues(activeInspection, rawSiteValues, 'RPP-0689 active release claim inspection');

  const writer = spawnReleaseVerifierCommittedWriter({
    filePath,
    plan,
    remote,
    artifactRefs,
    claimId: retryClaimId,
    now: new Date(fixedNow.getTime() + 7_000),
    claimStaleThresholdMs,
  });
  const {
    writerInspection,
    oldRemoteRecovery,
  } = parseChildReleaseVerifierOutput(writer);

  assert.equal(oldRemoteRecovery.state, 'old-remote');
  assert.deepEqual(oldRemoteRecovery.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
    total: plan.mutations.length,
  });
  assert.equal(oldRemoteRecovery.targetEnvelope.allOldTargetsHaveHashes, true);
  assertNoRawSiteValues(oldRemoteRecovery, rawSiteValues, 'RPP-0689 old remote release recovery');

  assertProductionLeaseOwnerAudit(writerInspection, {
    claimId: retryClaimId,
    expectedStatus: 'advanced',
    previousClaimId: activeClaimId,
    staleClaimRejected: true,
    claimExpired: true,
    previousClaimAgeMs: 7_000,
    rawSiteValues,
  });
  assert.equal(writerInspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(writerInspection.journal.restartReadable, true);
  assert.equal(writerInspection.journal.committedState.restartReadable, true);
  assert.equal(writerInspection.journal.committedState.latestCommittedType, 'journal-completed');
  assert.equal(writerInspection.journal.committedState.leaseOwner.eventType, 'journal-completed');
  assert.equal(writerInspection.journal.claim.previousClaimId, activeClaimId);
  assert.equal(writerInspection.journal.claimExpiry.previousClaimExpired, true);

  const restarted = readRecoveryJournal(filePath);
  assertRestartedCommittedState(restarted, {
    plan,
    expectedCommitted,
    artifactRefs,
    claimId: retryClaimId,
    expectedOpenRows: 3,
    expectedLatestOpenState: 'retrying-old-remote',
    expectedOwnershipRows: 2,
    expectedRecoveryClaimRows: 1,
    expectedAdvancedClaimRows: 1,
    rawSiteValues,
  });
  assert.deepEqual(writerInspection.journal.committedState, restarted.committedState);

  const advancedRecord = recordsOfType(restarted.records, 'stale-claim-advanced').at(-1);
  assert.ok(advancedRecord);
  assert.equal(advancedRecord.claimId, retryClaimId);
  assert.equal(advancedRecord.claimHash, recoveryClaimHash(retryClaimId));
  assert.equal(advancedRecord.previousClaimId, activeClaimId);
  assert.equal(advancedRecord.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(advancedRecord.claimExpired, true);
  assert.equal(advancedRecord.previousClaimAgeMs, 7_000);

  const completedRecord = recordsOfType(restarted.records, 'journal-completed').at(-1);
  const restartInspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: expectedCommitted,
  });
  assertFullyUpdatedInspection(restartInspection, { plan, claimId: retryClaimId, rawSiteValues });

  const auditEvidence = buildReleaseVerifierAuditCandidate({
    plan,
    restarted,
    completedRecord,
    writerInspection,
  });
  assertNoRawSiteValues(auditEvidence, rawSiteValues, 'RPP-0689 release verifier audit candidate');

  const releaseSummary = buildReleaseVerifierRecoverySummary({
    writerInspection,
    plan,
    oldRemoteRecovery,
    auditEvidence,
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation(plan),
  });
  assertReleaseVerifierCommittedStateProof(releaseProof, {
    plan,
    claimId: retryClaimId,
    oldRemoteRecovery,
    rawSiteValues,
  });

  const evidence = committedStateEvidenceSummary({
    source: 'release-verifier-shaped-committed-state-after-expired-claim-retry',
    restarted,
    completedRecord,
    writerInspection,
    releaseProof,
  });
  assertEvidenceScope(evidence, { claimId: retryClaimId, rawSiteValues });
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0689 release verifier journal file');
});

test('RPP-0689 generated file-backed committed rows survive restart and expose lease owner identity variant 5', () => {
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
    assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0689 first journal file');

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
    assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0689 retry journal file');
  }
});

test('RPP-0689 stale and invalid committed restart state fails closed with hash-only evidence variant 5', () => {
  const generatedCase = generatedCommittedStateCases[0];
  const filePath = tempJournalPath();
  const invalidPath = tempJournalPath('reprint-rpp-0689-invalid-committed-state-');
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
  assertNoRawSiteValues(staleInspection, rawSiteValues, 'RPP-0689 stale restart inspection');

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
  assertNoRawSiteValues(invalidRead, rawSiteValues, 'RPP-0689 invalid restart readback');

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
  assertNoRawSiteValues(invalidInspection, rawSiteValues, 'RPP-0689 invalid restart inspection');

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

test('RPP-0689 SQLite committed state readback mirrors restart-readable rows and corrupt rows fail closed variant 5', {
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
    assertNoRawSiteValues(corruptInspection, rawSiteValues, 'RPP-0689 corrupt SQLite inspection');
  } finally {
    database.close();
  }
});
