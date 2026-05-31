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
  classifyRecoveryJournalClaims,
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
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const openEventTypes = new Set(['journal-opened', 'journal-retry-opened']);
const claimStaleThresholdMs = 2_000;

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0688-staged-state-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stagedStateScenario() {
  const beforePlanPreservedKey = 'rpp-0688-preserved-before-plan.txt';
  const afterCrashPreservedKey = 'rpp-0688-preserved-after-crash.txt';
  const base = {
    files: {
      [beforePlanPreservedKey]: 'rpp-0688-base-raw-preserved-before-plan',
      [afterCrashPreservedKey]: 'rpp-0688-base-raw-preserved-after-crash',
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= 5; index++) {
    base.files[`rpp-0688-target-${index}.txt`] = `rpp-0688-base-raw-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= 5; index++) {
    local.files[`rpp-0688-target-${index}.txt`] = `rpp-0688-local-raw-target-${index}`;
  }
  remote.files[beforePlanPreservedKey] = 'rpp-0688-remote-raw-preserved-before-plan';

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 5);

  const expectedStaged = cloneJson(remote);
  applyMutations(expectedStaged, plan);

  const retryRemote = cloneJson(remote);
  retryRemote.files[afterCrashPreservedKey] = 'rpp-0688-remote-raw-preserved-after-crash';

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
    'rpp-0688-base-raw',
    'rpp-0688-local-raw',
    'rpp-0688-remote-raw',
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
    releaseProof: 'artifact://rpp-0688/release-verifier-restart-readable-staged-state-v5',
    recoverySupport: 'artifact://rpp-0688/local-restart-readable-staged-state-v5',
    durabilityScope: 'artifact://rpp-0688/sandbox-file-backed-release-verifier-shaped',
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
      filePath: process.env.RPP0688_JOURNAL_PATH,
      plan: JSON.parse(process.env.RPP0688_PLAN),
      current: JSON.parse(process.env.RPP0688_REMOTE_SITE),
      artifactRefs: JSON.parse(process.env.RPP0688_ARTIFACT_REFS),
      now: new Date(process.env.RPP0688_NOW),
      truncate: true,
      claimId: process.env.RPP0688_CLAIM_ID,
      claimStaleThresholdMs: Number(process.env.RPP0688_CLAIM_STALE_THRESHOLD_MS),
    });

    try {
      applyPlan(JSON.parse(process.env.RPP0688_REMOTE_SITE), JSON.parse(process.env.RPP0688_PLAN), {
        durableJournal,
        journal: JSON.parse(process.env.RPP0688_PREVIOUS_JOURNAL),
        failAfterStaging: true,
        mutateRemote: true,
        artifactRefs: JSON.parse(process.env.RPP0688_ARTIFACT_REFS),
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
      RPP0688_ARTIFACT_REFS: JSON.stringify(artifactRefs()),
      RPP0688_CLAIM_ID: claimId,
      RPP0688_CLAIM_STALE_THRESHOLD_MS: String(claimStaleThresholdMs),
      RPP0688_JOURNAL_PATH: filePath,
      RPP0688_NOW: fixedNow.toISOString(),
      RPP0688_PLAN: JSON.stringify(plan),
      RPP0688_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0688_REMOTE_SITE: JSON.stringify(remote),
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

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0688 evidence') {
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
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0688 journal rows');
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

function assertProductionRetryPreservedStagedState({
  afterFirstRestart,
  afterProductionRetry,
  retryInspection,
  expectedStaged,
  rawSiteValues,
}) {
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
  assertNoRawSiteValues(retryInspection, rawSiteValues, 'RPP-0688 retry writer inspection');
}

function assertReleaseVerifierRetryInspection({
  releaseRetryInspection,
  afterReleaseRetry,
  activeClaimId,
  releaseVerifierClaimId,
  expectedStaged,
  filePath,
  rawSiteValues,
}) {
  const claim = classifyRecoveryJournalClaims(afterReleaseRetry.records);
  const latestOpenRecord = openRecords(afterReleaseRetry.records).at(-1);

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(releaseRetryInspection), true);
  assert.equal(claim.status, 'advanced');
  assert.equal(claim.activeClaimId, releaseVerifierClaimId);
  assert.equal(claim.activeClaimHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(claim.previousClaimId, activeClaimId);
  assert.equal(claim.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(claim.claimExpiry.expired, true);
  assert.equal(claim.claimExpiry.previousClaimExpired, true);
  assert.equal(claim.claimExpiry.staleThresholdMs, claimStaleThresholdMs);
  assert.equal(releaseRetryInspection.claim.activeClaimId, releaseVerifierClaimId);
  assert.equal(releaseRetryInspection.claim.previousClaimId, activeClaimId);
  assert.equal(releaseRetryInspection.claim.staleClaimRejected, true);
  assert.equal(releaseRetryInspection.claim.claimExpiry.expired, true);
  assert.equal(releaseRetryInspection.journal.writerLease.claimId, releaseVerifierClaimId);
  assert.equal(releaseRetryInspection.journal.writerLease.claimKeyHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(releaseRetryInspection.journal.leaseFence.writerLease.claimId, releaseVerifierClaimId);
  assert.equal(
    releaseRetryInspection.journal.leaseFence.writerLease.claimKeyHash,
    recoveryClaimHash(releaseVerifierClaimId),
  );
  assert.equal(releaseRetryInspection.journal.leaseFence.staleClaimRejected, true);
  assert.equal(releaseRetryInspection.journal.ownership.ownsJournal, true);
  assert.equal(releaseRetryInspection.journal.ownership.restartReadable, true);
  assert.deepEqual(releaseRetryInspection.journal.checked, [filePath]);
  assert.equal(releaseRetryInspection.journal.records, afterReleaseRetry.records.length);
  assert.deepEqual(releaseRetryInspection.journal.openState, afterReleaseRetry.openState);
  assert.deepEqual(releaseRetryInspection.journal.stagedState, afterReleaseRetry.stagedState);
  assert.equal(afterReleaseRetry.openState.openRows, 4);
  assert.equal(afterReleaseRetry.openState.latestOpenSequence, latestOpenRecord.sequence);
  assert.equal(afterReleaseRetry.openState.latestOpenType, 'journal-retry-opened');
  assert.equal(afterReleaseRetry.openState.state, 'retrying-expired-claim');
  assert.equal(afterReleaseRetry.stagedState.restartReadable, true);
  assert.equal(afterReleaseRetry.stagedState.latestStagedType, 'apply-staged');
  assert.equal(afterReleaseRetry.stagedState.stagedRows, 1);
  assert.equal(afterReleaseRetry.stagedState.stagedHash, digest(expectedStaged));
  assert.equal(recordsOfType(afterReleaseRetry.records, 'stale-claim-advanced').length, 1);
  assert.equal(recordsOfType(afterReleaseRetry.records, 'journal-ownership-recorded').length, 2);
  assertHashOnlyJournalRows(afterReleaseRetry.records, rawSiteValues);
  assertNoRawSiteValues(releaseRetryInspection, rawSiteValues, 'RPP-0688 release-verifier retry inspection');
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
  assertNoRawSiteValues(replay.before.journal.records, rawSiteValues, 'RPP-0688 repair-before journal rows');
  assertNoRawSiteValues(replay.after.journal.records, rawSiteValues, 'RPP-0688 repair-after journal rows');
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0688 restart-readable staged-state release verifier old-remote classification',
    status: 200,
    state: inspection.status,
    observedState: inspection.remoteClassification?.state || inspection.status,
    counts: {
      ...inspection.counts,
      total: plan.mutations.length,
    },
    targetEnvelope: {
      total: plan.mutations.length,
      old: plan.mutations.length,
      new: 0,
      blockedUnknown: 0,
      hashOnly: true,
      checkedPath,
      allTargetsAccountedFor: true,
    },
  };
}

function retryPreservationEvidence({
  afterReleaseRetry,
  replay,
  writtenResourceKeys,
  beforePlanPreservedValue,
  afterCrashPreservedValue,
}) {
  return {
    status: 'replayed',
    code: 'STAGED_RETRY_REMOTE_PRESERVED',
    retryAttempts: afterReleaseRetry.openState.openRows - 1,
    preservedRemoteUnchanged: true,
    appliedMutations: replay.appliedMutations,
    mutationAppliedBeforeFailure: 0,
    applyCommittedDuringRetry: false,
    stagedRows: afterReleaseRetry.stagedState.stagedRows,
    latestStagedType: afterReleaseRetry.stagedState.latestStagedType,
    stagedStateRestartReadable: afterReleaseRetry.stagedState.restartReadable,
    writtenTargetsHash: digest(writtenResourceKeys),
    preservedBeforePlanHash: digest(beforePlanPreservedValue),
    preservedAfterCrashHash: digest(afterCrashPreservedValue),
    journalRowsHash: digest(afterReleaseRetry.records),
  };
}

function buildRecoveryReleaseSummary({
  productionInspection,
  plan,
  oldRemoteRecovery,
  stagedRetryPreservation,
}) {
  const mutationEvents = plan.mutations.length;
  const checkedPath = productionInspection.journal.checked[0];
  const originalRequestHash = 'a'.repeat(64);
  const conflictingRequestHash = 'b'.repeat(64);
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
      proof: productionInspection,
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
          checkedPath,
          restartReadableStagedState: {
            checkedPath,
            status: productionInspection.journal.stagedState.status,
            restartReadable: productionInspection.journal.stagedState.restartReadable,
            stagedRows: productionInspection.journal.stagedState.stagedRows,
            latestStagedType: productionInspection.journal.stagedState.latestStagedType,
            targetRows: productionInspection.journal.stagedState.targetRows,
            stagedHash: productionInspection.journal.stagedState.stagedHash,
          },
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
          },
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
          source: 'RPP-0688 different-body conflict recovery state',
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
        required: checkedPath,
        observed: checkedPath,
        retryAttempts: stagedRetryPreservation.retryAttempts,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
        preservedRemoteUnchanged: stagedRetryPreservation.preservedRemoteUnchanged,
        restartReadableStagedState: {
          checkedPath,
          restartReadable: stagedRetryPreservation.stagedStateRestartReadable,
          stagedRows: stagedRetryPreservation.stagedRows,
          latestStagedType: stagedRetryPreservation.latestStagedType,
        },
      },
      stagedRetryPreservation,
      readRetryEvidence: {
        [checkedPath]: stagedRetryPreservation.retryAttempts,
      },
      latestReadRetryEvidence: {
        [checkedPath]: stagedRetryPreservation.retryAttempts,
      },
    },
  };
}

function buildBlockedApplyRevalidation({
  plan,
  preservedRemoteUnchanged = true,
  mutationAppliedBeforeFailure = 0,
  applyCommitted = false,
}) {
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
      preservedRemoteUnchanged,
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
        mutationAppliedBeforeFailure,
        applyCommitted,
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

function assertReleaseVerifierCarriesStagedRetry({
  releaseRetryInspection,
  plan,
  oldRemoteRecovery,
  stagedRetryPreservation,
  rawSiteValues,
}) {
  const releaseSummary = buildRecoveryReleaseSummary({
    productionInspection: releaseRetryInspection,
    plan,
    oldRemoteRecovery,
    stagedRetryPreservation,
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation({ plan }),
  });

  const checkedPath = releaseRetryInspection.journal.checked[0];
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedPath);
  assert.equal(
    releaseSummary.releaseProof.recoveryInspect.recovery.restartReadableStagedState.checkedPath,
    checkedPath,
  );
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.restartReadableStagedState.restartReadable, true);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.restartReadableStagedState.restartReadable, true);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.preservedRemoteUnchanged, true);
  assert.equal(releaseSummary.releaseProof.stagedRetryPreservation.preservedRemoteUnchanged, true);
  assert.equal(releaseSummary.releaseProof.stagedRetryPreservation.stagedStateRestartReadable, true);
  assert.equal(releaseSummary.releaseProof.stagedRetryPreservation.appliedMutations, plan.mutations.length);
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
  assert.equal(releaseProof.checks.oldState, true);
  assert.equal(releaseProof.checks.newState, true);
  assert.equal(releaseProof.checks.blockedState, true);
  assert.equal(releaseProof.checks.recoveryInspectAfterRestart, true);
  assert.equal(releaseProof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(releaseProof.checks.preservedRejectedRemoteEvidence, true);
  assert.equal(releaseProof.checks.manualRecoveryAuditExport, true);
  assert.equal(releaseProof.recoveryInspectAfterRestart.journalState, 'ok');
  assert.equal(releaseProof.partialStates.old.proved, true);
  assert.equal(releaseProof.partialStates.old.state, 'old-remote');
  assert.deepEqual(releaseProof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.preservedRemoteUnchanged, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.mutationAppliedBeforeFailure, 0);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyCommitted, false);
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.proved, true);
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.applyStatus, 412);
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.applyCode, 'PRECONDITION_FAILED');
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.recoveryState, 'blocked-recovery');
  assert.equal(releaseProof.manualRecoveryAuditExport.proved, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assert.match(stagedRetryPreservation.writtenTargetsHash, hashPattern);
  assert.match(stagedRetryPreservation.preservedBeforePlanHash, hashPattern);
  assert.match(stagedRetryPreservation.preservedAfterCrashHash, hashPattern);
  assert.match(stagedRetryPreservation.journalRowsHash, hashPattern);
  assertNoRawSiteValues(releaseSummary, rawSiteValues, 'RPP-0688 release summary');
  assertNoRawSiteValues(releaseProof, rawSiteValues, 'RPP-0688 release proof');

  const mutatingRetryProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation({
      plan,
      preservedRemoteUnchanged: false,
      mutationAppliedBeforeFailure: 1,
      applyCommitted: true,
    }),
  });
  assert.equal(mutatingRetryProof.ok, false);
  assert.equal(mutatingRetryProof.checks.sameKeyReplayAfterRejection, false);
  assert.equal(mutatingRetryProof.sameKeyReplayAfterRejection.preservedRemoteUnchanged, false);
  assert.equal(mutatingRetryProof.sameKeyReplayAfterRejection.mutationAppliedBeforeFailure, 1);
  assert.equal(mutatingRetryProof.sameKeyReplayAfterRejection.applyCommitted, true);
  assertNoRawSiteValues(mutatingRetryProof, rawSiteValues, 'RPP-0688 mutating retry release proof');
}

test('RPP-0688 release verifier carries restart-readable staged retry without overwriting preserved remote changes variant 5', () => {
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
  const activeClaimId = 'rpp-0688-staged-state-active-claim';
  const releaseVerifierClaimId = 'rpp-0688-staged-state-release-verifier-claim';

  const stagedWriter = spawnStagedWriter({
    filePath,
    plan,
    remote,
    claimId: activeClaimId,
  });
  const beforeRestartInspection = parseChildInspection(stagedWriter);

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(beforeRestartInspection), true);
  assert.equal(beforeRestartInspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(beforeRestartInspection.journal.restartReadable, true);
  assert.equal(beforeRestartInspection.journal.stagedState.restartReadable, true);
  assert.equal(beforeRestartInspection.journal.stagedState.latestStagedType, 'apply-staged');
  assert.equal(beforeRestartInspection.journal.claimId, activeClaimId);
  assert.equal(beforeRestartInspection.journal.claimHash, recoveryClaimHash(activeClaimId));
  assertNoRawSiteValues(beforeRestartInspection, rawSiteValues, 'RPP-0688 first writer inspection');

  const afterFirstRestart = readRecoveryJournal(filePath);
  assertRestartedStagedState(afterFirstRestart, {
    plan,
    current: remote,
    expectedStaged,
    rawSiteValues,
  });
  assert.deepEqual(beforeRestartInspection.journal.stagedState, afterFirstRestart.stagedState);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0688 first journal file');

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
  assertNoRawSiteValues(restartInspection, rawSiteValues, 'RPP-0688 restart inspection');

  const repairInspection = inspectRecoveryRepair({
    journal: afterFirstRestart,
    plan,
    current: retryRemote,
  });
  assert.equal(repairInspection.status, 'old-remote-replayable');
  assert.equal(repairInspection.canRollForward, true);
  assert.equal(repairInspection.journal.stagedState.restartReadable, true);
  assertNoRawSiteValues(repairInspection.journal.records, rawSiteValues, 'RPP-0688 repair inspection rows');

  const retryRemoteBeforeJournalOpen = cloneJson(retryRemote);
  const retryJournal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: retryRemote,
    artifactRefs: artifactRefs(),
    now: new Date(fixedNow.getTime() + 1_000),
    truncate: false,
    claimId: activeClaimId,
    claimStaleThresholdMs,
  });
  const retryInspection = retryJournal.inspect();
  retryJournal.close();
  assert.deepEqual(retryRemote, retryRemoteBeforeJournalOpen);

  const afterProductionRetry = readRecoveryJournal(filePath);
  assertProductionRetryPreservedStagedState({
    afterFirstRestart,
    afterProductionRetry,
    retryInspection,
    expectedStaged,
    rawSiteValues,
  });

  const retryRemoteBeforeReleaseRetry = cloneJson(retryRemote);
  const releaseRetryJournal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: retryRemote,
    artifactRefs: artifactRefs(),
    now: new Date(fixedNow.getTime() + 7_000),
    truncate: false,
    claimId: releaseVerifierClaimId,
    claimStaleThresholdMs,
  });
  const releaseRetryInspection = releaseRetryJournal.inspect();
  releaseRetryJournal.close();
  assert.deepEqual(retryRemote, retryRemoteBeforeReleaseRetry);

  const afterReleaseRetry = readRecoveryJournal(filePath);
  assertReleaseVerifierRetryInspection({
    releaseRetryInspection,
    afterReleaseRetry,
    activeClaimId,
    releaseVerifierClaimId,
    expectedStaged,
    filePath,
    rawSiteValues,
  });

  const repairAfterReleaseRetry = inspectRecoveryRepair({
    journal: afterReleaseRetry,
    plan,
    current: retryRemote,
  });
  assert.equal(repairAfterReleaseRetry.status, 'old-remote-replayable');
  assert.equal(repairAfterReleaseRetry.journal.stagedState.restartReadable, true);

  const retryRemoteBeforeReplay = cloneJson(retryRemote);
  const expectedAfterReplay = cloneJson(retryRemoteBeforeReplay);
  applyMutations(expectedAfterReplay, plan);
  const writtenResourceKeys = [];
  const replay = replayRecoveryRepair({
    journal: afterReleaseRetry,
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

  const finalOldRemoteInspection = inspectRecoveryJournal({
    journal: afterReleaseRetry,
    plan,
    current: retryRemoteBeforeReplay,
  });
  assert.equal(finalOldRemoteInspection.status, 'old-remote');
  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: finalOldRemoteInspection,
    plan,
    checkedPath: releaseRetryInspection.journal.checked[0],
  });
  const stagedRetryPreservation = retryPreservationEvidence({
    afterReleaseRetry,
    replay,
    writtenResourceKeys,
    beforePlanPreservedValue: preservedBeforePlanValue,
    afterCrashPreservedValue: preservedAfterCrashValue,
  });
  assertReleaseVerifierCarriesStagedRetry({
    releaseRetryInspection,
    plan,
    oldRemoteRecovery,
    stagedRetryPreservation,
    rawSiteValues,
  });

  const journalText = fs.readFileSync(filePath, 'utf8');
  assertNoRawSiteValues(journalText, rawSiteValues, 'RPP-0688 retry journal file');
});
