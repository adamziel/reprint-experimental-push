import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  assertJournalRecordHasNoRawValues,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T00:00:00.000Z');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hashPattern = /^[a-f0-9]{64}$/;
const openEventTypes = new Set(['journal-opened', 'journal-retry-opened']);

const fileJournalReadScript = `
import { readRecoveryJournal } from './src/recovery-journal.js';

const journal = readRecoveryJournal(process.argv[1]);
process.stdout.write(JSON.stringify(journal));
`;

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-rpp-0687-open-state-v5-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 5; index++) {
    files[`rpp-0687-open-state-file-${index}.txt`] =
      `rpp-0687-base-private-open-state-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  for (let index = 1; index <= 4; index++) {
    site.files[`rpp-0687-open-state-file-${index}.txt`] =
      `rpp-0687-local-private-open-state-${index}`;
  }
  return site;
}

function buildScenario() {
  const base = baseSite();
  const local = localSite(base);
  const remote = cloneJson(base);
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
  const values = new Set([
    'rpp-0687-base-private-open-state',
    'rpp-0687-local-private-open-state',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function artifactRefsFor(plan) {
  return {
    releaseProof: `artifact://rpp-0687/${plan.id}/release-verifier-open-state-v5`,
    recoverySupport: `artifact://rpp-0687/${plan.id}/restart-readable-open-state-v5`,
    durabilityScope: `artifact://rpp-0687/${plan.id}/sandbox-process-boundary`,
  };
}

function spawnProductionOpen({
  filePath,
  plan,
  current,
  artifactRefs,
  claimId,
  claimStaleThresholdMs,
  now,
  truncate,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const childScript = `
    import { openProductionRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};

    try {
      const journal = openProductionRecoveryJournal({
        filePath: process.env.RPP0687_JOURNAL_PATH,
        plan: JSON.parse(process.env.RPP0687_PLAN),
        current: JSON.parse(process.env.RPP0687_CURRENT),
        artifactRefs: JSON.parse(process.env.RPP0687_ARTIFACT_REFS),
        now: new Date(process.env.RPP0687_NOW),
        truncate: process.env.RPP0687_TRUNCATE === 'true',
        claimId: process.env.RPP0687_CLAIM_ID,
        claimStaleThresholdMs: Number(process.env.RPP0687_CLAIM_STALE_THRESHOLD_MS),
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
      RPP0687_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0687_CLAIM_ID: claimId,
      RPP0687_CLAIM_STALE_THRESHOLD_MS: String(claimStaleThresholdMs),
      RPP0687_CURRENT: JSON.stringify(current),
      RPP0687_JOURNAL_PATH: filePath,
      RPP0687_NOW: now.toISOString(),
      RPP0687_PLAN: JSON.stringify(plan),
      RPP0687_TRUNCATE: truncate ? 'true' : 'false',
    },
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
}

function readFileJournalAfterProcessRestart(filePath) {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    fileJournalReadScript,
    filePath,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });

  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
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

function assertNoRawSiteValues(value, rawSiteValues, label = 'RPP-0687 evidence') {
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
  assertNoRawSiteValues(records, rawSiteValues, 'RPP-0687 journal rows');
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
  assert.equal(recordsOfType(restarted.records, 'recovery-claim-opened').length, 1);
  assert.ok(restarted.records.every((record) => record.fsync.requested === true));
  assertHashOnlyJournalRows(restarted.records, rawSiteValues);
}

function assertProductionInspection(inspection, {
  filePath,
  activeClaimId,
  retryClaimId,
  claimStaleThresholdMs,
  rawSiteValues,
}) {
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, 'advanced');
  assert.equal(inspection.claim.activeClaimId, retryClaimId);
  assert.equal(inspection.claim.activeClaimHash, recoveryClaimHash(retryClaimId));
  assert.equal(inspection.claim.previousClaimId, activeClaimId);
  assert.equal(inspection.claim.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.claim.staleClaimRejected, true);
  assert.equal(inspection.claim.claimExpiry.policy, 'bounded-stale-claim-advance');
  assert.equal(inspection.claim.claimExpiry.expired, true);
  assert.equal(inspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(inspection.claim.claimExpiry.previousClaimAgeMs, 7_000);
  assert.equal(inspection.claim.claimExpiry.staleThresholdMs, claimStaleThresholdMs);
  assert.equal(inspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.openState.restartReadable, true);
  assert.equal(inspection.journal.openState.latestOpenType, 'journal-retry-opened');
  assert.equal(inspection.journal.openState.state, 'retrying-expired-claim');
  assert.equal(inspection.journal.ownership.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.staleClaimRejected, true);
  assert.equal(inspection.journal.writerLease.claimId, retryClaimId);
  assert.equal(inspection.journal.writerLease.claimKeyHash, recoveryClaimHash(retryClaimId));
  assert.deepEqual(inspection.journal.checked, [filePath]);
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0687 writer inspection');
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
  assert.equal(inspection.journal.openState.latestOpenType, 'journal-retry-opened');
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0687 restart inspection');
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0687 restarted open-state readback',
    status: 200,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
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

function buildRecoveryReleaseSummary({
  productionInspection,
  restarted,
  plan,
  oldRemoteRecovery,
}) {
  const mutationEvents = plan.mutations.length;
  const checkedPath = productionInspection.journal.checked[0];
  const originalRequestHash = '7'.repeat(64);
  const conflictingRequestHash = '8'.repeat(64);
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
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
          },
          journal: {
            restartReadable: true,
            openState: restarted.openState,
            records: restarted.records.length,
          },
        },
      },
      openStateReadback: {
        source: 'release-verifier durable journal proof',
        checkedPath,
        restartReadable: restarted.openState.restartReadable,
        status: restarted.openState.status,
        phase: restarted.openState.phase,
        durableRows: restarted.openState.durableRows,
        openRows: restarted.openState.openRows,
        latestOpenType: restarted.openState.latestOpenType,
        latestOpenSequence: restarted.openState.latestOpenSequence,
        rowsHash: digest(restarted.records),
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
          source: 'RPP-0687 different-body conflict recovery state',
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

function assertReleaseVerifierProof(proof, {
  releaseSummary,
  plan,
  retryClaimId,
  checkedPath,
  restarted,
  oldRemoteRecovery,
  rawSiteValues,
}) {
  const openStateReadback = releaseSummary.releaseProof.openStateReadback;
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedPath);
  assert.equal(
    releaseSummary.releaseProof.staleClaimRetry.oldRemoteRecovery.targetEnvelope.checkedPath,
    checkedPath,
  );
  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedPath);
  assert.equal(openStateReadback.checkedPath, checkedPath);
  assert.equal(openStateReadback.restartReadable, true);
  assert.equal(openStateReadback.durableRows, restarted.records.length);
  assert.equal(openStateReadback.openRows, 2);
  assert.equal(openStateReadback.latestOpenType, 'journal-retry-opened');
  assert.match(openStateReadback.rowsHash, hashPattern);
  assert.deepEqual(
    releaseSummary.releaseProof.recoveryInspect.recovery.journal.openState,
    restarted.openState,
  );

  assert.equal(proof.ok, true);
  assert.equal(proof.gate, 'GATE-2');
  assert.equal(proof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(proof.gateStatus, 'proven');
  assert.equal(proof.sameReleaseBoundary, true);
  assert.equal(proof.sourceUrl, 'http://127.0.0.1:8080');
  assert.equal(proof.checks.ownsJournal, true);
  assert.equal(proof.checks.restartReadable, true);
  assert.equal(proof.checks.leaseOwnerIdentity, true);
  assert.equal(proof.checks.staleOwnerFencing, true);
  assert.equal(proof.checks.claimExpiryPolicy, true);
  assert.equal(proof.checks.recoveryInspectAfterRestart, true);
  assert.equal(proof.checks.oldState, true);
  assert.equal(proof.checks.newState, true);
  assert.equal(proof.checks.blockedState, true);
  assert.equal(proof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(proof.checks.manualRecoveryAuditExport, true);
  assert.equal(proof.leaseOwnerIdentity.activeClaimId, retryClaimId);
  assert.equal(proof.leaseOwnerIdentity.activeClaimKeyHash, recoveryClaimHash(retryClaimId));
  assert.equal(proof.leaseOwnerIdentity.matches, true);
  assert.equal(proof.claimExpiryPolicy.proved, true);
  assert.equal(proof.claimExpiryPolicy.previousClaimAgeMs, 7_000);
  assert.equal(proof.recoveryInspectAfterRestart.proved, true);
  assert.equal(proof.recoveryInspectAfterRestart.journalState, 'ok');
  assert.equal(proof.partialStates.old.proved, true);
  assert.equal(proof.partialStates.old.source, oldRemoteRecovery.source);
  assert.equal(proof.partialStates.old.state, 'old-remote');
  assert.deepEqual(proof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(proof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(proof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(proof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(proof.manualRecoveryAuditExport.proved, true);
  assert.equal(proof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(proof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.plannedTargets, plan.mutations.length);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.summaryOnly, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawSiteValues(releaseSummary, rawSiteValues, 'RPP-0687 release summary');
  assertNoRawSiteValues(proof, rawSiteValues, 'RPP-0687 release proof');
}

test('RPP-0687 restart-readable open state rows are durable after process restart and carried through the release verifier', () => {
  const filePath = tempJournalPath();
  fs.chmodSync(path.dirname(filePath), 0o700);
  const { plan, remote, rawSiteValues } = buildScenario();
  const artifactRefs = artifactRefsFor(plan);
  const claimStaleThresholdMs = 2_000;
  const activeClaimId = 'rpp-0687-open-state-active-claim';
  const retryClaimId = 'rpp-0687-open-state-expired-retry-claim';

  const firstOpen = spawnProductionOpen({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId: activeClaimId,
    claimStaleThresholdMs,
    now: fixedNow,
    truncate: true,
  });
  const firstOpenInspection = parseChildInspection(firstOpen);

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(firstOpenInspection), true);
  assert.equal(firstOpenInspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(firstOpenInspection.journal.restartReadable, true);
  assert.equal(firstOpenInspection.journal.openState.latestOpenType, 'journal-opened');
  assert.equal(firstOpenInspection.journal.claimId, activeClaimId);
  assert.equal(firstOpenInspection.journal.claimHash, recoveryClaimHash(activeClaimId));
  assertNoRawSiteValues(firstOpenInspection, rawSiteValues, 'RPP-0687 first writer inspection');

  const afterFirstRestart = readFileJournalAfterProcessRestart(filePath);
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
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0687 first journal file');

  const firstRows = cloneJson(afterFirstRestart.records);
  const retryOpen = spawnProductionOpen({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    claimId: retryClaimId,
    claimStaleThresholdMs,
    now: new Date(fixedNow.getTime() + 7_000),
    truncate: false,
  });
  const retryInspection = parseChildInspection(retryOpen);

  assertProductionInspection(retryInspection, {
    filePath,
    activeClaimId,
    retryClaimId,
    claimStaleThresholdMs,
    rawSiteValues,
  });

  const afterRetryRestart = readFileJournalAfterProcessRestart(filePath);
  const retryOpenRecord = openRecords(afterRetryRestart.records).at(-1);

  assertRestartedOpenState(afterRetryRestart, {
    plan,
    current: remote,
    artifactRefs,
    expectedOpenRows: 2,
    expectedLatestType: 'journal-retry-opened',
    expectedLatestState: 'retrying-expired-claim',
    rawSiteValues,
  });
  assert.deepEqual(afterRetryRestart.records.slice(0, firstRows.length), firstRows);
  assert.equal(recordsOfType(afterRetryRestart.records, 'journal-ownership-recorded').length, 2);
  assert.equal(recordsOfType(afterRetryRestart.records, 'stale-claim-advanced').length, 1);
  assert.equal(retryOpenRecord.sequence > firstRows.length, true);
  assert.equal(retryOpenRecord.claimId, retryClaimId);
  assert.equal(retryOpenRecord.claimHash, recoveryClaimHash(retryClaimId));
  assert.deepEqual(retryInspection.journal.openState, afterRetryRestart.openState);
  assert.equal(retryInspection.journal.records, afterRetryRestart.records.length);
  assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0687 retry journal file');

  const oldRemoteInspection = inspectRecoveryJournal({
    journal: afterRetryRestart,
    plan,
    current: remote,
  });
  assertOldRemoteInspection(oldRemoteInspection, { plan, rawSiteValues });

  const checkedPath = retryInspection.journal.checked[0];
  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath,
  });
  const releaseSummary = buildRecoveryReleaseSummary({
    productionInspection: retryInspection,
    restarted: afterRetryRestart,
    plan,
    oldRemoteRecovery,
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation(plan),
  });

  assert.equal(checkedPath, filePath);
  assertReleaseVerifierProof(releaseProof, {
    releaseSummary,
    plan,
    retryClaimId,
    checkedPath,
    restarted: afterRetryRestart,
    oldRemoteRecovery,
    rawSiteValues,
  });
});
