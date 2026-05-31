import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createPushPlan } from '../src/planner.js';
import {
  appendRecoveryClaimOpened,
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  openRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import {
  inspectRecoveryJournal,
  RECOVERY_INSPECT_REASON_CODES,
} from '../src/recovery-inspect.js';
import { deserializeResourceValue, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T13:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const driftedRawValue = 'rpp-0692-drift-private-charlie';

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0692-blocked-v5-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'rpp-0692-alpha.txt': 'rpp-0692-base-private-alpha',
      'rpp-0692-bravo.txt': 'rpp-0692-base-private-bravo',
      'rpp-0692-charlie.txt': 'rpp-0692-base-private-charlie',
      'rpp-0692-delta.txt': 'rpp-0692-base-private-delta',
    },
    plugins: {},
    db: {},
  };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  site.files['rpp-0692-alpha.txt'] = 'rpp-0692-local-private-alpha';
  site.files['rpp-0692-bravo.txt'] = 'rpp-0692-local-private-bravo';
  site.files['rpp-0692-charlie.txt'] = 'rpp-0692-local-private-charlie';
  site.files['rpp-0692-delta.txt'] = 'rpp-0692-local-private-delta';
  return site;
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    driftedRawValue,
    'rpp-0692-base-private-alpha',
    'rpp-0692-base-private-bravo',
    'rpp-0692-base-private-charlie',
    'rpp-0692-base-private-delta',
    'rpp-0692-local-private-alpha',
    'rpp-0692-local-private-bravo',
    'rpp-0692-local-private-charlie',
    'rpp-0692-local-private-delta',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function buildScenario() {
  const base = baseSite();
  const local = localSite(base);
  const remote = cloneJson(base);
  const plan = createPushPlan({ base, local, remote, now: fixedNow });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 4);

  return {
    base,
    local,
    remote,
    plan,
    rawValues: rawSiteValuesFor(base, local, remote),
  };
}

function applyFirstMutations(site, plan, count) {
  for (const mutation of plan.mutations.slice(0, count)) {
    setResource(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
}

function assertNoRawValues(value, rawValues, label = 'RPP-0692 hash-only evidence') {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `${label} leaked raw payload: ${rawValue}`,
    );
  }
}

function assertHashOnlyJournal(journal, rawValues) {
  assert.equal(journal.integrity.status, 'ok');
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    Array.from({ length: journal.records.length }, (_, index) => index + 1),
  );
  assert.ok(journal.records.every((record) => record.fsync?.requested === true));
  for (const record of journal.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoRawValues(journal, rawValues, 'RPP-0692 durable journal');
}

function assertWriterRestartRows(journal, { plan, activeClaimId }) {
  const mutationRows = journal.records.filter((record) => record.type === 'mutation-observed');
  const recoveryStateRows = journal.records.filter((record) => record.type === 'recovery-state');

  assert.deepEqual(
    journal.records.map((record) => record.type),
    [
      'recovery-claim-opened',
      'journal-opened',
      'target-planned',
      'target-planned',
      'target-planned',
      'target-planned',
      'apply-staged',
      'dependencies-validated',
      'apply-committing',
      'mutation-observed',
      'mutation-observed',
      'recovery-state',
    ],
  );
  assert.equal(journal.openState.restartReadable, true);
  assert.equal(journal.stagedState.restartReadable, true);
  assert.equal(journal.committedState.restartReadable, true);
  assert.equal(journal.committedState.status, 'committed');
  assert.equal(journal.committedState.records, journal.records.length);
  assert.equal(journal.committedState.durableRows, journal.records.length);
  assert.equal(journal.committedState.mutationRows, 2);
  assert.equal(journal.committedState.completedRows, 0);
  assert.equal(journal.committedState.targetEnvelope.plannedTargets, plan.mutations.length);
  assert.equal(journal.committedState.targetEnvelope.committedTargets, 2);
  assert.equal(journal.committedState.targetEnvelope.allTargetsCommitted, false);
  assert.equal(journal.committedState.leaseOwner.claimId, activeClaimId);
  assert.equal(journal.committedState.leaseOwner.claimHash, recoveryClaimHash(activeClaimId));
  assert.equal(mutationRows.length, 2);
  assert.equal(recoveryStateRows.length, 1);
  assert.equal(recoveryStateRows[0].state, 'blocked-recovery');
  assert.equal(journal.records.some((record) => record.type === 'journal-completed'), false);
}

function assertProductionRetryPreservedRows({
  writerRestart,
  productionRestart,
  retryClaimId,
}) {
  assert.deepEqual(
    productionRestart.records.slice(0, writerRestart.records.length),
    writerRestart.records,
  );
  assert.deepEqual(
    productionRestart.records.slice(writerRestart.records.length).map((record) => record.type),
    [
      'stale-claim-advanced',
      'journal-retry-opened',
      'journal-ownership-recorded',
    ],
  );

  const retryRows = productionRestart.records.slice(writerRestart.records.length);
  for (const row of retryRows) {
    assert.equal(row.claimId, retryClaimId);
    assert.equal(row.claimHash, recoveryClaimHash(retryClaimId));
  }
}

function assertProductionInspection(inspection, { filePath, retryClaimId, activeClaimId, rawValues }) {
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, 'advanced');
  assert.equal(inspection.claim.activeClaimId, retryClaimId);
  assert.equal(inspection.claim.activeClaimHash, recoveryClaimHash(retryClaimId));
  assert.equal(inspection.claim.previousClaimId, activeClaimId);
  assert.equal(inspection.claim.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.claim.claimExpiry.expired, true);
  assert.equal(inspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.ownership.ownsJournal, true);
  assert.equal(inspection.journal.ownership.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.writerLease.claimId, retryClaimId);
  assert.equal(inspection.journal.writerLease.claimKeyHash, recoveryClaimHash(retryClaimId));
  assert.equal(inspection.journal.leaseFence.writerLease.claimId, retryClaimId);
  assert.equal(
    inspection.journal.leaseFence.writerLease.claimKeyHash,
    recoveryClaimHash(retryClaimId),
  );
  assert.deepEqual(inspection.journal.checked, [filePath]);
  assertNoRawValues(inspection, rawValues, 'RPP-0692 production retry inspection');
}

function writeBlockedJournalInChild({
  filePath,
  base,
  local,
  remote,
  artifactRefs,
  activeClaimId,
  claimStaleThresholdMs,
}) {
  const childScript = `
    import { applyPlan } from ${JSON.stringify(new URL('../src/apply.js', import.meta.url).href)};
    import { createPushPlan } from ${JSON.stringify(new URL('../src/planner.js', import.meta.url).href)};
    import {
      appendRecoveryClaimOpened,
      openRecoveryJournal,
    } from ${JSON.stringify(new URL('../src/recovery-journal.js', import.meta.url).href)};

    const fixedNow = new Date('2026-05-31T13:00:00.000Z');
    const filePath = process.env.RPP0692_JOURNAL_PATH;
    const base = JSON.parse(process.env.RPP0692_BASE_SITE);
    const local = JSON.parse(process.env.RPP0692_LOCAL_SITE);
    const remote = JSON.parse(process.env.RPP0692_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0692_ARTIFACT_REFS);
    const claimStaleThresholdMs = Number(process.env.RPP0692_STALE_THRESHOLD_MS);
    const plan = createPushPlan({ base, local, remote, now: fixedNow });
    const durableJournal = openRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      claimId: process.env.RPP0692_ACTIVE_CLAIM_ID,
      claimStaleThresholdMs,
    });
    appendRecoveryClaimOpened(durableJournal, {
      plan,
      current: remote,
      claimId: process.env.RPP0692_ACTIVE_CLAIM_ID,
      staleThresholdMs: claimStaleThresholdMs,
      artifactRefs,
      reason: 'RPP-0692 generated blocked recovery writer claim opened.',
    });

    try {
      applyPlan(remote, plan, {
        durableJournal,
        journalArtifactRefs: artifactRefs,
        mutateRemote: true,
        failDuringCommitAtMutation: 2,
      });
      console.error('expected injected partial commit failure');
      process.exit(3);
    } catch (error) {
      if (
        error?.code !== 'INJECTED_FAILURE_DURING_COMMIT'
        || error?.details?.recovery?.status !== 'blocked-recovery'
      ) {
        console.error(error?.stack || String(error));
        process.exit(2);
      }
      process.exit(0);
    }
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0692_JOURNAL_PATH: filePath,
      RPP0692_BASE_SITE: JSON.stringify(base),
      RPP0692_LOCAL_SITE: JSON.stringify(local),
      RPP0692_REMOTE_SITE: JSON.stringify(remote),
      RPP0692_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0692_ACTIVE_CLAIM_ID: activeClaimId,
      RPP0692_STALE_THRESHOLD_MS: String(claimStaleThresholdMs),
    },
    encoding: 'utf8',
  });

  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0692 release-verifier old-remote classification from restarted journal',
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

function blockedRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0692 release-verifier blocked recovery classification after restart',
    status: 409,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    reasonCode: inspection.reasonCode,
    counts: {
      ...inspection.counts,
      total: plan.mutations.length,
    },
    targetEnvelope: {
      total: plan.mutations.length,
      old: inspection.counts.old,
      new: inspection.counts.new,
      blockedUnknown: inspection.counts.blockedUnknown,
      hashOnly: true,
      checkedPath,
      allTargetsAccountedFor: true,
    },
  };
}

function restartDurabilityEvidence({
  writerRestart,
  productionRestart,
  partialInspection,
  plan,
  checkedPath,
}) {
  const writerRows = writerRestart.records;
  const preservedRows = productionRestart.records.slice(0, writerRows.length);
  const evidence = {
    source: 'RPP-0692 release-verifier restarted blocked journal rows',
    checkedPath,
    restartReadable: true,
    writerRows: writerRows.length,
    productionRows: productionRestart.records.length,
    writerRowsPreservedAfterRetry: digest(preservedRows) === digest(writerRows),
    rowTypes: writerRows.map((record) => record.type),
    rowHash: digest(writerRows),
    productionRowHash: digest(productionRestart.records),
    committedState: {
      status: writerRestart.committedState.status,
      restartReadable: writerRestart.committedState.restartReadable,
      durableRows: writerRestart.committedState.durableRows,
      mutationRows: writerRestart.committedState.mutationRows,
      completedRows: writerRestart.committedState.completedRows,
      plannedTargets: writerRestart.committedState.targetEnvelope.plannedTargets,
      committedTargets: writerRestart.committedState.targetEnvelope.committedTargets,
      allTargetsCommitted: writerRestart.committedState.targetEnvelope.allTargetsCommitted,
    },
    blockedClassification: {
      state: partialInspection.status,
      reasonCode: partialInspection.reasonCode,
      counts: {
        ...partialInspection.counts,
        total: plan.mutations.length,
      },
      durableRows: partialInspection.classification.durableRows,
    },
  };

  assert.match(evidence.rowHash, hashPattern);
  assert.match(evidence.productionRowHash, hashPattern);
  assert.equal(evidence.writerRowsPreservedAfterRetry, true);
  assert.equal(evidence.committedState.restartReadable, true);
  assert.equal(evidence.committedState.durableRows, writerRows.length);
  assert.equal(evidence.committedState.mutationRows, 2);
  assert.equal(evidence.committedState.completedRows, 0);
  assert.equal(evidence.committedState.committedTargets, 2);
  assert.equal(evidence.committedState.allTargetsCommitted, false);
  assert.equal(evidence.blockedClassification.state, 'blocked-recovery');
  assert.equal(evidence.blockedClassification.durableRows, productionRestart.records.length);
  return evidence;
}

function buildRecoveryReleaseSummary({
  productionInspection,
  plan,
  oldRemoteRecovery,
  restartRows,
}) {
  const mutationEvents = plan.mutations.length;
  const checkedPath = productionInspection.journal.checked[0];
  const originalRequestHash = '5'.repeat(64);
  const conflictingRequestHash = '6'.repeat(64);
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
          restartDurability: restartRows,
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
          source: 'RPP-0692 different-body conflict recovery state',
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
        restartDurability: restartRows,
      },
    },
  };
}

function buildBlockedApplyRevalidation({ blockedRecovery, preservedRemoteUnchanged = true }) {
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
      recovery: blockedRecovery,
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

test('RPP-0692 blocked recovery classification variant 5 carries durable restart rows through release verifier', () => {
  const filePath = tempJournalPath();
  const { base, local, remote, plan, rawValues } = buildScenario();
  const activeClaimId = 'rpp-0692-blocked-active-claim';
  const retryClaimId = 'rpp-0692-blocked-release-verifier-retry';
  const claimStaleThresholdMs = 2_000;
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0692-blocked-recovery-v5-release-proof',
    recoverySupport: 'artifact://rpp-0692-blocked-recovery-v5-support',
  };
  const partialRemote = cloneJson(remote);
  applyFirstMutations(partialRemote, plan, 2);

  writeBlockedJournalInChild({
    filePath,
    base,
    local,
    remote,
    artifactRefs,
    activeClaimId,
    claimStaleThresholdMs,
  });

  const writerRestart = readRecoveryJournal(filePath);
  assertHashOnlyJournal(writerRestart, rawValues);
  assertWriterRestartRows(writerRestart, { plan, activeClaimId });

  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: partialRemote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 7_000),
    truncate: false,
    claimId: retryClaimId,
    claimStaleThresholdMs,
  });
  const productionInspection = retry.inspect();
  retry.close();

  assertProductionInspection(productionInspection, {
    filePath,
    retryClaimId,
    activeClaimId,
    rawValues,
  });

  const productionRestart = readRecoveryJournal(filePath);
  assertHashOnlyJournal(productionRestart, rawValues);
  assertProductionRetryPreservedRows({
    writerRestart,
    productionRestart,
    retryClaimId,
  });

  const partialInspection = inspectRecoveryJournal({
    journal: productionRestart,
    plan,
    current: partialRemote,
  });
  assert.equal(partialInspection.status, 'blocked-recovery');
  assert.equal(partialInspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedPartialRemote);
  assert.match(partialInspection.reason, /partially updated/);
  assert.deepEqual(partialInspection.counts, {
    old: 2,
    new: 2,
    blockedUnknown: 0,
  });
  assert.deepEqual(partialInspection.classification, {
    state: 'blocked-recovery',
    reasonCode: RECOVERY_INSPECT_REASON_CODES.blockedPartialRemote,
    journalIntegrity: 'ok',
    durableRows: productionRestart.records.length,
    retry: 'blocked',
    targetEnvelope: {
      total: plan.mutations.length,
      old: 2,
      new: 2,
      blockedUnknown: 0,
    },
  });
  assert.deepEqual(
    partialInspection.targets.map((target) => [target.resourceKey, target.state]),
    [
      ['file:rpp-0692-alpha.txt', 'new'],
      ['file:rpp-0692-bravo.txt', 'new'],
      ['file:rpp-0692-charlie.txt', 'old'],
      ['file:rpp-0692-delta.txt', 'old'],
    ],
  );

  const driftedRemote = cloneJson(partialRemote);
  driftedRemote.files['rpp-0692-charlie.txt'] = driftedRawValue;
  const blockedUnknownInspection = inspectRecoveryJournal({
    journal: productionRestart,
    plan,
    current: driftedRemote,
  });
  assert.equal(blockedUnknownInspection.status, 'blocked-recovery');
  assert.equal(blockedUnknownInspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedTargetUnknown);
  assert.deepEqual(blockedUnknownInspection.counts, {
    old: 1,
    new: 2,
    blockedUnknown: 1,
  });
  assert.deepEqual(
    blockedUnknownInspection.targets.map((target) => [target.resourceKey, target.state]),
    [
      ['file:rpp-0692-alpha.txt', 'new'],
      ['file:rpp-0692-bravo.txt', 'new'],
      ['file:rpp-0692-charlie.txt', 'blocked-unknown'],
      ['file:rpp-0692-delta.txt', 'old'],
    ],
  );
  for (const target of blockedUnknownInspection.targets) {
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    if (target.state !== 'blocked-unknown') {
      assert.match(target.observedHash, hashPattern);
    }
  }

  const oldRemoteInspection = inspectRecoveryJournal({
    journal: productionRestart,
    plan,
    current: remote,
  });
  assert.equal(oldRemoteInspection.status, 'old-remote');
  assert.deepEqual(oldRemoteInspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });

  const checkedPath = productionInspection.journal.checked[0];
  const restartRows = restartDurabilityEvidence({
    writerRestart,
    productionRestart,
    partialInspection,
    plan,
    checkedPath,
  });
  const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
    inspection: oldRemoteInspection,
    plan,
    checkedPath,
  });
  const blockedRecovery = blockedRecoveryFromInspection({
    inspection: blockedUnknownInspection,
    plan,
    checkedPath,
  });
  const releaseSummary = buildRecoveryReleaseSummary({
    productionInspection,
    plan,
    oldRemoteRecovery,
    restartRows,
  });
  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation({ blockedRecovery }),
  });

  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.restartDurability.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.restartDurability.restartReadable, true);
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.restartDurability.writerRows, 12);
  assert.equal(
    releaseSummary.releaseProof.recoveryInspect.recovery.restartDurability.productionRows,
    productionRestart.records.length,
  );
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.restartDurability.writerRowsPreservedAfterRetry, true);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.restartDurability.rowHash, restartRows.rowHash);

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
  assert.equal(releaseProof.checks.sameKeyBodyReplay, true);
  assert.equal(releaseProof.checks.sameKeyDifferentBodyConflict, true);
  assert.equal(releaseProof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(releaseProof.checks.sameKeyRejectedReplay, true);
  assert.equal(releaseProof.checks.oldState, true);
  assert.equal(releaseProof.checks.newState, true);
  assert.equal(releaseProof.checks.blockedState, true);
  assert.equal(releaseProof.checks.preservedRejectedRemoteEvidence, true);
  assert.equal(releaseProof.checks.manualRecoveryAuditExport, true);
  assert.equal(releaseProof.recoveryInspectAfterRestart.proved, true);
  assert.equal(releaseProof.recoveryInspectAfterRestart.journalState, 'ok');
  assert.equal(releaseProof.partialStates.old.proved, true);
  assert.deepEqual(releaseProof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(releaseProof.partialStates.new.proved, true);
  assert.equal(releaseProof.partialStates.blocked.proved, true);
  assert.deepEqual(releaseProof.partialStates.blocked.counts, blockedRecovery.counts);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.mutationAppliedBeforeFailure, 0);
  assert.equal(releaseProof.sameKeyReplayAfterRejection.applyCommitted, false);
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.proved, true);
  assert.equal(releaseProof.preservedRejectedRemoteEvidence.recoveryState, 'blocked-recovery');
  assert.equal(releaseProof.manualRecoveryAuditExport.proved, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(releaseProof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);

  const mutatingRetryProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary,
    applyRevalidation: buildBlockedApplyRevalidation({
      blockedRecovery,
      preservedRemoteUnchanged: false,
    }),
  });
  assert.equal(mutatingRetryProof.ok, false);
  assert.equal(mutatingRetryProof.checks.sameKeyReplayAfterRejection, false);
  assert.equal(mutatingRetryProof.sameKeyReplayAfterRejection.preservedRemoteUnchanged, false);

  assertNoRawValues(fs.readFileSync(filePath, 'utf8'), rawValues, 'RPP-0692 raw journal file');
  assertNoRawValues(productionInspection, rawValues, 'RPP-0692 production inspection');
  assertNoRawValues(productionRestart, rawValues, 'RPP-0692 production restart');
  assertNoRawValues(partialInspection, rawValues, 'RPP-0692 partial inspection');
  assertNoRawValues(blockedUnknownInspection, rawValues, 'RPP-0692 blocked unknown inspection');
  assertNoRawValues(releaseSummary, rawValues, 'RPP-0692 release summary');
  assertNoRawValues(releaseProof, rawValues, 'RPP-0692 release proof');
  assertNoRawValues(mutatingRetryProof, rawValues, 'RPP-0692 mutating retry proof');
});
