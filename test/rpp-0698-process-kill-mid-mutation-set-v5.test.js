import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { applyPlan } from '../src/apply.js';
import { createPushPlan } from '../src/planner.js';
import {
  inspectRecoveryJournal,
  RECOVERY_INSPECT_REASON_CODES,
} from '../src/recovery-inspect.js';
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
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T14:00:00.000Z');
const retryNow = new Date(fixedNow.getTime() + 7_000);
const checkedCommand = 'timeout 300s npm run verify:release';
const checkedRoute = '/wp-json/reprint/v1/push/recovery/inspect';
const sourceUrl = 'http://127.0.0.1:8080';
const claimStaleThresholdMs = 2_000;
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const generatedProcessKillCases = Object.freeze([
  {
    id: 'rpp-0698-mid-set-six-v5',
    mutationCount: 6,
    killAfterMutations: 3,
  },
  {
    id: 'rpp-0698-mid-set-eight-v5',
    mutationCount: 8,
    killAfterMutations: 5,
  },
]);

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0698-mid-mutation-set-v5-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const beforePlanPreservedKey = `${generatedCase.id}-preserved-before-plan.txt`;
  const afterKillPreservedKey = `${generatedCase.id}-preserved-after-kill.txt`;
  const base = {
    files: {
      [beforePlanPreservedKey]:
        `base-raw-rpp-0698-${generatedCase.id}-preserved-before-plan`,
      [afterKillPreservedKey]:
        `base-raw-rpp-0698-${generatedCase.id}-preserved-after-kill`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[targetFileName(generatedCase, index)] =
      `base-raw-rpp-0698-${generatedCase.id}-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[targetFileName(generatedCase, index)] =
      `local-raw-rpp-0698-${generatedCase.id}-target-${index}`;
  }
  remote.files[beforePlanPreservedKey] =
    `remote-raw-rpp-0698-${generatedCase.id}-preserved-before-plan`;

  const preservedAfterKillValue =
    `remote-raw-rpp-0698-${generatedCase.id}-preserved-after-kill`;
  const retryRemote = cloneJson(remote);
  retryRemote.files[afterKillPreservedKey] = preservedAfterKillValue;

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);
  assert.deepEqual(
    plan.mutations.map((mutation) => mutation.resourceKey),
    expectedTargetResourceKeys(generatedCase),
  );

  const expectedPartial = cloneJson(remote);
  applyFirstMutations(expectedPartial, plan, generatedCase.killAfterMutations);

  return {
    plan,
    remote,
    expectedPartial,
    beforePlanPreservedKey,
    afterKillPreservedKey,
    preservedBeforePlanValue: remote.files[beforePlanPreservedKey],
    preservedAfterKillValue,
    rawValues: rawSiteValuesFor(base, local, remote, retryRemote),
  };
}

function targetFileName(generatedCase, index) {
  return `${generatedCase.id}-target-${String(index).padStart(2, '0')}.txt`;
}

function expectedTargetResourceKeys(generatedCase) {
  return Array.from({ length: generatedCase.mutationCount }, (_, index) =>
    `file:${targetFileName(generatedCase, index + 1)}`);
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

function applyFirstMutations(site, plan, count) {
  for (const mutation of plan.mutations.slice(0, count)) {
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

function artifactRefsFor(generatedCase) {
  return {
    releaseProof: `artifact://rpp-0698/${generatedCase.id}/release-verifier-process-kill-v5`,
    recoverySupport: `artifact://rpp-0698/${generatedCase.id}/process-kill-mid-mutation-set-v5`,
    durabilityScope: `artifact://rpp-0698/${generatedCase.id}/sandbox-jsonl-only`,
  };
}

function activeClaimIdFor(generatedCase) {
  return `${generatedCase.id}-active-claim`;
}

function releaseVerifierClaimIdFor(generatedCase) {
  return `${generatedCase.id}-release-verifier-claim`;
}

function spawnProcessKilledWriter({
  filePath,
  remoteAfterKillPath,
  plan,
  remote,
  artifactRefs,
  activeClaimId,
  killAfterMutations,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const childScript = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { openProductionRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};

    const plan = JSON.parse(process.env.RPP0698_PLAN);
    const remote = JSON.parse(process.env.RPP0698_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0698_ARTIFACT_REFS);
    const killAfterMutations = Number(process.env.RPP0698_KILL_AFTER_MUTATIONS);
    const claimStaleThresholdMs = Number(process.env.RPP0698_STALE_THRESHOLD_MS);
    const filePath = process.env.RPP0698_JOURNAL_PATH;
    const remoteAfterKillPath = process.env.RPP0698_REMOTE_AFTER_KILL_PATH;

    function writeJsonDurably(targetPath, value) {
      const tempPath = \`\${targetPath}.\${process.pid}.tmp\`;
      const fd = fs.openSync(tempPath, 'w', 0o600);
      try {
        fs.writeSync(fd, JSON.stringify(value));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tempPath, targetPath);
      const dirFd = fs.openSync(path.dirname(targetPath), 'r');
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    }

    const writer = openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      now: new Date(process.env.RPP0698_NOW),
      truncate: true,
      claimId: process.env.RPP0698_ACTIVE_CLAIM_ID,
      claimStaleThresholdMs,
    });

    let observedMutations = 0;
    const durableJournal = {
      filePath: writer.filePath,
      claimFenced: writer.claimFenced,
      claimHash: writer.claimHash,
      productionAdapter: writer.productionAdapter,
      get claimOpened() {
        return writer.claimOpened;
      },
      set claimOpened(value) {
        writer.claimOpened = value;
      },
      appendEvent(type, payload) {
        const record = writer.appendEvent(type, payload);
        if (type === 'mutation-observed') {
          observedMutations += 1;
          if (observedMutations === killAfterMutations) {
            writeJsonDurably(remoteAfterKillPath, remote);
            process.kill(process.pid, 'SIGKILL');
          }
        }
        return record;
      },
      assertCurrentClaim(type) {
        return writer.assertCurrentClaim(type);
      },
      close() {
        return writer.close();
      },
    };

    applyPlan(remote, plan, {
      durableJournal,
      journal: JSON.parse(process.env.RPP0698_PREVIOUS_JOURNAL),
      mutateRemote: true,
      artifactRefs,
    });
    console.error('expected SIGKILL after mutation-observed row');
    process.exit(4);
  `;

  return spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0698_ACTIVE_CLAIM_ID: activeClaimId,
      RPP0698_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0698_JOURNAL_PATH: filePath,
      RPP0698_KILL_AFTER_MUTATIONS: String(killAfterMutations),
      RPP0698_NOW: fixedNow.toISOString(),
      RPP0698_PLAN: JSON.stringify(plan),
      RPP0698_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0698_REMOTE_AFTER_KILL_PATH: remoteAfterKillPath,
      RPP0698_REMOTE_SITE: JSON.stringify(remote),
      RPP0698_STALE_THRESHOLD_MS: String(claimStaleThresholdMs),
    },
    encoding: 'utf8',
  });
}

function assertPlanPreservesRemoteOnlyResource(plan, preservedKey) {
  const preservedResourceKey = `file:${preservedKey}`;
  const preservedDecision = plan.decisions.find(
    (decision) => decision.resourceKey === preservedResourceKey,
  );

  if (preservedDecision) {
    assert.equal(preservedDecision.decision, 'keep-remote');
    assert.match(preservedDecision.remoteHash, hashPattern);
  }
  assert.equal(
    plan.mutations.some((mutation) => mutation.resourceKey === preservedResourceKey),
    false,
  );
  assert.equal(
    plan.preconditions.some((precondition) => precondition.resourceKey === preservedResourceKey),
    false,
  );
}

function assertPartialJournalAfterKill({
  journal,
  plan,
  generatedCase,
  rawValues,
}) {
  assert.equal(journal.integrity.status, 'ok');
  assert.equal(journal.committedState.status, 'committed');
  assert.equal(journal.committedState.restartReadable, true);
  assert.equal(journal.committedState.mutationRows, generatedCase.killAfterMutations);
  assert.equal(journal.committedState.completedRows, 0);
  assert.equal(journal.records.some((record) => record.type === 'journal-completed'), false);
  assert.equal(recordsOfType(journal.records, 'target-planned').length, plan.mutations.length);
  assert.equal(recordsOfType(journal.records, 'journal-ownership-recorded').length, 1);
  assert.equal(recordsOfType(journal.records, 'recovery-claim-opened').length, 1);
  assert.equal(
    recordsOfType(journal.records, 'mutation-observed').length,
    generatedCase.killAfterMutations,
  );
  assert.deepEqual(
    recordsOfType(journal.records, 'mutation-observed').map((record) => record.resourceKey),
    expectedTargetResourceKeys(generatedCase).slice(0, generatedCase.killAfterMutations),
  );
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    Array.from({ length: journal.records.length }, (_, index) => index + 1),
  );
  assert.equal(journal.records.every((record) => record.fsync.requested === true), true);
  assertHashOnlyJournalRows(journal.records, rawValues);
}

function assertPartialInspection({
  inspection,
  plan,
  generatedCase,
  rawValues,
}) {
  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedPartialRemote);
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length - generatedCase.killAfterMutations,
    new: generatedCase.killAfterMutations,
    blockedUnknown: 0,
  });
  assert.equal(inspection.remoteClassification.allTargetsAccountedFor, true);
  assert.equal(inspection.journal.committedState.restartReadable, true);
  assert.equal(inspection.targets.length, plan.mutations.length);
  for (const target of inspection.targets) {
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    assert.match(target.observedHash, hashPattern);
  }
  assertNoRawValues(inspection, rawValues, 'RPP-0698 partial inspection');
}

function assertPartialRepairInspection({
  repairInspection,
  plan,
  generatedCase,
  rawValues,
}) {
  assert.equal(repairInspection.status, 'partial-remote-replayable');
  assert.equal(repairInspection.canRollForward, true);
  assert.equal(repairInspection.canMarkRepaired, false);
  assert.deepEqual(repairInspection.counts, {
    old: plan.mutations.length - generatedCase.killAfterMutations,
    new: generatedCase.killAfterMutations,
    unknown: 0,
    total: plan.mutations.length,
  });
  assert.deepEqual(
    repairInspection.rollForwardTargets.map((target) => target.resourceKey),
    expectedTargetResourceKeys(generatedCase).slice(generatedCase.killAfterMutations),
  );
  assert.deepEqual(
    repairInspection.alreadyUpdatedTargets.map((target) => target.resourceKey),
    expectedTargetResourceKeys(generatedCase).slice(0, generatedCase.killAfterMutations),
  );
  assertNoRawValues(repairInspection.journal.records, rawValues, 'RPP-0698 repair inspection rows');
}

function openProductionRetry({
  filePath,
  plan,
  current,
  artifactRefs,
  activeClaimId,
  releaseVerifierClaimId,
  rawValues,
}) {
  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current,
    artifactRefs,
    now: retryNow,
    truncate: false,
    claimId: releaseVerifierClaimId,
    claimStaleThresholdMs,
  });
  const productionInspection = retry.inspect();
  retry.close();

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(productionInspection), true);
  assert.equal(productionInspection.claim.status, 'advanced');
  assert.equal(productionInspection.claim.activeClaimId, releaseVerifierClaimId);
  assert.equal(productionInspection.claim.activeClaimHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(productionInspection.claim.previousClaimId, activeClaimId);
  assert.equal(productionInspection.claim.previousClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(productionInspection.claim.claimExpiry.policy, 'bounded-stale-claim-advance');
  assert.equal(productionInspection.claim.claimExpiry.expired, true);
  assert.equal(productionInspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(productionInspection.claim.claimExpiry.previousClaimAgeMs, 7_000);
  assert.equal(productionInspection.claim.claimExpiry.staleThresholdMs, claimStaleThresholdMs);
  assert.equal(productionInspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(productionInspection.journal.restartReadable, true);
  assert.equal(productionInspection.journal.ownership.ownsJournal, true);
  assert.equal(productionInspection.journal.ownership.restartReadable, true);
  assert.equal(productionInspection.journal.leaseFence.restartReadable, true);
  assert.equal(productionInspection.journal.leaseFence.staleClaimRejected, true);
  assert.equal(productionInspection.journal.writerLease.claimId, releaseVerifierClaimId);
  assert.equal(
    productionInspection.journal.writerLease.claimKeyHash,
    recoveryClaimHash(releaseVerifierClaimId),
  );
  assert.deepEqual(productionInspection.journal.checked, [filePath]);
  assertNoRawValues(productionInspection, rawValues, 'RPP-0698 production retry inspection');

  return productionInspection;
}

function assertProductionRetryPreservedRows({
  afterKillJournal,
  afterProductionRetry,
  releaseVerifierClaimId,
  rawValues,
}) {
  assert.deepEqual(
    afterProductionRetry.records.slice(0, afterKillJournal.records.length),
    afterKillJournal.records,
  );
  assert.deepEqual(
    afterProductionRetry.records.slice(afterKillJournal.records.length).map((record) => record.type),
    [
      'stale-claim-advanced',
      'journal-retry-opened',
      'journal-ownership-recorded',
    ],
  );

  const retryRows = afterProductionRetry.records.slice(afterKillJournal.records.length);
  for (const row of retryRows) {
    assert.equal(row.claimId, releaseVerifierClaimId);
    assert.equal(row.claimHash, recoveryClaimHash(releaseVerifierClaimId));
  }

  assert.equal(afterProductionRetry.integrity.status, 'ok');
  assert.equal(afterProductionRetry.openState.latestOpenType, 'journal-retry-opened');
  assert.equal(afterProductionRetry.openState.state, 'retrying-expired-claim');
  assert.equal(afterProductionRetry.committedState.mutationRows, afterKillJournal.committedState.mutationRows);
  assert.equal(afterProductionRetry.committedState.completedRows, 0);
  assertHashOnlyJournalRows(afterProductionRetry.records, rawValues);
}

function assertReplayPreservedRemoteChanges({
  replay,
  retryRemote,
  plan,
  generatedCase,
  beforePlanPreservedKey,
  afterKillPreservedKey,
  preservedBeforePlanValue,
  preservedAfterKillValue,
  writeAttempts,
  rawValues,
}) {
  assert.equal(replay.status, 'replayed');
  assert.equal(replay.appliedMutations, plan.mutations.length - generatedCase.killAfterMutations);
  assert.deepEqual(
    replay.appliedTargets.map((target) => target.resourceKey),
    expectedTargetResourceKeys(generatedCase).slice(generatedCase.killAfterMutations),
  );
  assert.deepEqual(
    replay.skippedTargets.map((target) => target.resourceKey),
    expectedTargetResourceKeys(generatedCase).slice(0, generatedCase.killAfterMutations),
  );
  assert.deepEqual(
    writeAttempts,
    expectedTargetResourceKeys(generatedCase)
      .slice(generatedCase.killAfterMutations)
      .map((resourceKey) => ({ resourceKey, repairAction: 'apply-after' })),
  );

  for (const mutation of plan.mutations) {
    assert.equal(
      resourceHash(retryRemote, mutation.resource),
      digest(deserializeResourceValue(mutation.value)),
    );
  }
  assert.equal(retryRemote.files[beforePlanPreservedKey], preservedBeforePlanValue);
  assert.equal(retryRemote.files[afterKillPreservedKey], preservedAfterKillValue);
  assertNoRawValues(replay.before.journal.records, rawValues, 'RPP-0698 repair-before journal rows');
  assertNoRawValues(replay.after.journal.records, rawValues, 'RPP-0698 repair-after journal rows');
}

function assertFullyUpdatedInspection({ inspection, plan, rawValues }) {
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
  assert.equal(inspection.remoteRecoveryClassification.kind, 'new-remote');
  assert.equal(inspection.remoteRecoveryClassification.proved, true);
  assertNoRawValues(inspection, rawValues, 'RPP-0698 fully updated inspection');
}

function assertOldRemoteInspection({ inspection, plan, rawValues }) {
  assert.equal(inspection.status, 'old-remote');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.oldRemote);
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assert.deepEqual(inspection.remoteClassification, {
    state: 'old-remote',
    status: 'old-remote',
    evidence: 'hash-only-before-after-target-envelope',
    allTargetsAccountedFor: true,
  });
  assert.ok(inspection.targets.every((target) => target.state === 'old'));
  assertNoRawValues(inspection, rawValues, 'RPP-0698 old remote inspection');
}

function assertBlockedUnknownInspection({ inspection, plan, rawValues }) {
  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedTargetUnknown);
  assert.deepEqual(inspection.counts, {
    old: 0,
    new: plan.mutations.length - 1,
    blockedUnknown: 1,
  });
  assert.equal(inspection.remoteRecoveryClassification.kind, 'blocked-recovery');
  assert.equal(inspection.remoteRecoveryClassification.proved, false);
  assert.equal(inspection.targets.filter((target) => target.state === 'blocked-unknown').length, 1);
  assertNoRawValues(inspection, rawValues, 'RPP-0698 blocked unknown inspection');
}

function restartDurabilityEvidence({
  afterKillJournal,
  afterProductionRetry,
  partialInspection,
  plan,
  generatedCase,
  checkedPath,
}) {
  const preservedRows = afterProductionRetry.records.slice(0, afterKillJournal.records.length);
  const evidence = {
    source: 'RPP-0698 release-verifier restarted process-kill journal rows',
    checkedPath,
    restartReadable: true,
    afterKillRows: afterKillJournal.records.length,
    productionRows: afterProductionRetry.records.length,
    afterKillRowsPreservedAfterRetry: digest(preservedRows) === digest(afterKillJournal.records),
    rowTypes: afterKillJournal.records.map((record) => record.type),
    rowHash: digest(afterKillJournal.records),
    productionRowHash: digest(afterProductionRetry.records),
    processKillBoundary: {
      signal: 'SIGKILL',
      killAfterMutations: generatedCase.killAfterMutations,
      mutationCount: generatedCase.mutationCount,
      committedRows: afterProductionRetry.committedState.mutationRows,
      completedRows: afterProductionRetry.committedState.completedRows,
      restartReadable: afterProductionRetry.committedState.restartReadable,
    },
    committedState: {
      status: afterKillJournal.committedState.status,
      restartReadable: afterKillJournal.committedState.restartReadable,
      durableRows: afterKillJournal.committedState.durableRows,
      mutationRows: afterKillJournal.committedState.mutationRows,
      completedRows: afterKillJournal.committedState.completedRows,
      plannedTargets: afterKillJournal.committedState.targetEnvelope.plannedTargets,
      committedTargets: afterKillJournal.committedState.targetEnvelope.committedTargets,
      allTargetsCommitted: afterKillJournal.committedState.targetEnvelope.allTargetsCommitted,
    },
    partialClassification: {
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
  assert.equal(evidence.afterKillRowsPreservedAfterRetry, true);
  assert.equal(evidence.committedState.restartReadable, true);
  assert.equal(evidence.committedState.mutationRows, generatedCase.killAfterMutations);
  assert.equal(evidence.committedState.completedRows, 0);
  assert.equal(evidence.committedState.committedTargets, generatedCase.killAfterMutations);
  assert.equal(evidence.committedState.allTargetsCommitted, false);
  assert.equal(evidence.partialClassification.state, 'blocked-recovery');
  assert.equal(evidence.partialClassification.durableRows, afterKillJournal.records.length);
  return evidence;
}

function newRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0698 release-verifier fully updated retry recovery classification',
    status: 200,
    state: inspection.status,
    observedState: inspection.remoteClassification.state,
    journalState: inspection.journal.integrity.status,
    storage: 'sqlite',
    restartReadable: inspection.journal.committedState.restartReadable,
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
      rawValuesIncluded: false,
      checkedPath,
      allTargetsAccountedFor: true,
    },
  };
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0698 release-verifier old remote recovery classification',
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
      rawValuesIncluded: false,
      checkedPath,
      allTargetsAccountedFor: true,
    },
  };
}

function blockedRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0698 release-verifier blocked recovery classification',
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
      rawValuesIncluded: false,
      checkedPath,
      allTargetsAccountedFor: true,
      blockedTargets: inspection.targets
        .filter((target) => target.state === 'blocked-unknown')
        .map(publicTargetSummary),
    },
  };
}

function preservedRemoteRetryEvidence({
  beforePlanPreservedKey,
  afterKillPreservedKey,
  preservedBeforePlanValue,
  preservedAfterKillValue,
  checkedPath,
}) {
  return {
    resources: [
      {
        resourceKey: `file:${beforePlanPreservedKey}`,
        beforePlanHash: digest(preservedBeforePlanValue),
        afterRetryHash: digest(preservedBeforePlanValue),
        overwritten: false,
      },
      {
        resourceKey: `file:${afterKillPreservedKey}`,
        beforePlanHash: null,
        afterRetryHash: digest(preservedAfterKillValue),
        overwritten: false,
      },
    ],
    hashOnly: true,
    rawValuesIncluded: false,
    retryDidNotOverwritePreservedRemoteChanges: true,
    sameCheckedRecoveryPath: true,
    checkedPath,
  };
}

function buildRecoveryReleaseSummary({
  productionInspection,
  plan,
  newRemoteRecovery,
  oldRemoteRecovery,
  restartRows,
  preservedRetryEvidence,
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

  const staleClaimRetry = {
    oldRemoteRecovery,
    abandoned: {
      status: 500,
      code: 'LAB_SIMULATED_STALE_CLAIM_PROCESS_KILL',
      recovery: oldRemoteRecovery,
    },
  };

  return {
    topology: {
      sourceUrl,
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
          source: newRemoteRecovery.source,
          state: newRemoteRecovery.state,
          observedState: newRemoteRecovery.observedState,
          journalState: newRemoteRecovery.journalState,
          checkedPath,
          storage: newRemoteRecovery.storage,
          restartReadable: newRemoteRecovery.restartReadable,
          counts: newRemoteRecovery.counts,
          targetEnvelope: newRemoteRecovery.targetEnvelope,
          restartDurability: restartRows,
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
          source: 'RPP-0698 different-body conflict recovery state',
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
      staleClaimRetry,
      replayAndRetry: {
        required: checkedPath,
        observed: checkedPath,
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
        restartDurability: restartRows,
        preservedRemote: preservedRetryEvidence,
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
        applyRejected: 40,
        applyReplayed: 41,
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
  newRemoteRecovery,
  oldRemoteRecovery,
  blockedRecovery,
  releaseVerifierClaimId,
  checkedPath,
  rawValues,
}) {
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.restartDurability.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedPath);
  assert.equal(
    releaseSummary.releaseProof.replayAndRetry.preservedRemote.retryDidNotOverwritePreservedRemoteChanges,
    true,
  );
  assert.equal(proof.ok, true);
  assert.equal(proof.gate, 'GATE-2');
  assert.equal(proof.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(proof.gateStatus, 'proven');
  assert.equal(proof.sameReleaseBoundary, true);
  assert.equal(proof.sourceUrl, sourceUrl);
  assert.equal(proof.checks.ownsJournal, true);
  assert.equal(proof.checks.restartReadable, true);
  assert.equal(proof.checks.leaseOwnerIdentity, true);
  assert.equal(proof.checks.staleOwnerFencing, true);
  assert.equal(proof.checks.claimExpiryPolicy, true);
  assert.equal(proof.checks.recoveryInspectAfterRestart, true);
  assert.equal(proof.checks.sameKeyBodyReplay, true);
  assert.equal(proof.checks.sameKeyDifferentBodyConflict, true);
  assert.equal(proof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(proof.checks.sameKeyRejectedReplay, true);
  assert.equal(proof.checks.oldState, true);
  assert.equal(proof.checks.newState, true);
  assert.equal(proof.checks.blockedState, true);
  assert.equal(proof.checks.preservedRejectedRemoteEvidence, true);
  assert.equal(proof.checks.manualRecoveryAuditExport, true);
  assert.equal(proof.leaseOwnerIdentity.activeClaimId, releaseVerifierClaimId);
  assert.equal(proof.leaseOwnerIdentity.activeClaimKeyHash, recoveryClaimHash(releaseVerifierClaimId));
  assert.equal(proof.leaseOwnerIdentity.matches, true);
  assert.equal(proof.claimExpiryPolicy.proved, true);
  assert.equal(proof.claimExpiryPolicy.previousClaimAgeMs, 7_000);
  assert.equal(proof.recoveryInspectAfterRestart.proved, true);
  assert.deepEqual(proof.recoveryInspectAfterRestart.counts, newRemoteRecovery.counts);
  assert.equal(proof.partialStates.new.proved, true);
  assert.deepEqual(proof.partialStates.new.counts, newRemoteRecovery.counts);
  assert.equal(proof.partialStates.old.proved, true);
  assert.deepEqual(proof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(proof.partialStates.blocked.proved, true);
  assert.deepEqual(proof.partialStates.blocked.counts, blockedRecovery.counts);
  assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.dbBacked, true);
  assert.equal(proof.sameKeyDifferentBodyConflict.recoveryState.storage, 'sqlite');
  assert.equal(proof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(proof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(proof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(proof.sameKeyReplayAfterRejection.preservedRemoteUnchanged, true);
  assert.equal(proof.preservedRejectedRemoteEvidence.proved, true);
  assert.equal(proof.preservedRejectedRemoteEvidence.recoveryState, 'blocked-recovery');
  assert.equal(
    proof.preservedRejectedRemoteEvidence.replayAndRetry.preservedRemote
      .retryDidNotOverwritePreservedRemoteChanges,
    true,
  );
  assert.equal(proof.manualRecoveryAuditExport.proved, true);
  assert.equal(proof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawValues(releaseSummary, rawValues, 'RPP-0698 release summary');
  assertNoRawValues(proof, rawValues, 'RPP-0698 release proof');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(proof, { label: 'RPP-0698 release proof' }));
  assert.equal(plan.mutations.length, newRemoteRecovery.counts.total);
}

function releaseVerifierEvidenceFor({
  generatedCase,
  plan,
  checkedPath,
  afterProductionRetry,
  partialInspection,
  repairInspection,
  replay,
  releaseProof,
  preservedRetryEvidence,
  restartRows,
}) {
  const payload = {
    schemaVersion: 1,
    issue: 'RPP-0698',
    variant: 5,
    generatedCase: generatedCase.id,
    planId: plan.id,
    evidenceSource: 'release-verifier-process-kill-mid-mutation-set-v5',
    evidenceScope: 'local-jsonl-release-verifier-shaped',
    status: 'support_only',
    verdict: 'PROCESS_KILL_RETRY_PRESERVED_REMOTE_CHANGES_SUPPORT_ONLY',
    observedAt: fixedNow.toISOString(),
    checkedCommand,
    checkedRoute,
    sourceUrl,
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    hashOnly: true,
    checkedPathHash: digest({ checkedPath }),
    processKillBoundary: {
      signal: 'SIGKILL',
      killAfterMutations: generatedCase.killAfterMutations,
      mutationCount: generatedCase.mutationCount,
      committedRows: afterProductionRetry.committedState.mutationRows,
      completedRows: afterProductionRetry.committedState.completedRows,
      restartReadable: afterProductionRetry.committedState.restartReadable,
      journalRowsHash: digest(afterProductionRetry.records),
    },
    recoveryInspect: {
      status: partialInspection.status,
      reasonCode: partialInspection.reasonCode,
      counts: {
        ...partialInspection.counts,
        total: plan.mutations.length,
      },
      remoteClassification: partialInspection.remoteClassification,
      remoteRecoveryClassification: partialInspection.remoteRecoveryClassification,
    },
    repair: {
      status: repairInspection.status,
      canRollForward: repairInspection.canRollForward,
      appliedMutations: replay.appliedMutations,
      skippedMutations: replay.skippedTargets.length,
      retryDidNotOverwritePreservedRemoteChanges: true,
    },
    restartDurability: {
      afterKillRows: restartRows.afterKillRows,
      productionRows: restartRows.productionRows,
      afterKillRowsPreservedAfterRetry: restartRows.afterKillRowsPreservedAfterRetry,
      rowHash: restartRows.rowHash,
      productionRowHash: restartRows.productionRowHash,
    },
    preservedRemote: preservedRetryEvidence,
    releaseVerifier: {
      gate: releaseProof.gate,
      durableRecoveryJournalBoundary: releaseProof.durableRecoveryJournalBoundary,
      ok: releaseProof.ok,
      gateStatus: releaseProof.gateStatus,
      sameReleaseBoundary: releaseProof.sameReleaseBoundary,
      checks: {
        recoveryInspectAfterRestart: releaseProof.checks.recoveryInspectAfterRestart,
        oldState: releaseProof.checks.oldState,
        newState: releaseProof.checks.newState,
        blockedState: releaseProof.checks.blockedState,
        sameKeyReplayAfterRejection: releaseProof.checks.sameKeyReplayAfterRejection,
        preservedRejectedRemoteEvidence: releaseProof.checks.preservedRejectedRemoteEvidence,
        manualRecoveryAuditExport: releaseProof.checks.manualRecoveryAuditExport,
      },
      partialStates: {
        new: releaseProof.partialStates.new,
        old: releaseProof.partialStates.old,
        blocked: releaseProof.partialStates.blocked,
      },
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'support-only process-kill retry preservation proof; production release boundary still required',
    },
    plannedTargets: plan.mutations.length,
  };

  return {
    ...payload,
    evidenceHash: `sha256:${digest(payload)}`,
  };
}

function assertReleaseVerifierEvidence(evidence, {
  generatedCase,
  plan,
  rawValues,
}) {
  assert.equal(evidence.issue, 'RPP-0698');
  assert.equal(evidence.variant, 5);
  assert.equal(evidence.generatedCase, generatedCase.id);
  assert.equal(evidence.planId, plan.id);
  assert.equal(evidence.evidenceSource, 'release-verifier-process-kill-mid-mutation-set-v5');
  assert.equal(evidence.evidenceScope, 'local-jsonl-release-verifier-shaped');
  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.verdict, 'PROCESS_KILL_RETRY_PRESERVED_REMOTE_CHANGES_SUPPORT_ONLY');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseEligible, false);
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.hashOnly, true);
  assert.match(evidence.checkedPathHash, hashPattern);
  assert.equal(evidence.processKillBoundary.signal, 'SIGKILL');
  assert.equal(evidence.processKillBoundary.killAfterMutations, generatedCase.killAfterMutations);
  assert.equal(evidence.processKillBoundary.mutationCount, generatedCase.mutationCount);
  assert.equal(evidence.processKillBoundary.committedRows, generatedCase.killAfterMutations);
  assert.equal(evidence.processKillBoundary.completedRows, 0);
  assert.equal(evidence.processKillBoundary.restartReadable, true);
  assert.match(evidence.processKillBoundary.journalRowsHash, hashPattern);
  assert.equal(evidence.recoveryInspect.status, 'blocked-recovery');
  assert.equal(evidence.recoveryInspect.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedPartialRemote);
  assert.deepEqual(evidence.recoveryInspect.counts, {
    old: plan.mutations.length - generatedCase.killAfterMutations,
    new: generatedCase.killAfterMutations,
    blockedUnknown: 0,
    total: plan.mutations.length,
  });
  assert.equal(evidence.repair.status, 'partial-remote-replayable');
  assert.equal(evidence.repair.canRollForward, true);
  assert.equal(evidence.repair.retryDidNotOverwritePreservedRemoteChanges, true);
  assert.equal(evidence.preservedRemote.retryDidNotOverwritePreservedRemoteChanges, true);
  assert.equal(evidence.preservedRemote.resources.every((entry) => entry.overwritten === false), true);
  assert.equal(evidence.restartDurability.afterKillRowsPreservedAfterRetry, true);
  assert.match(evidence.restartDurability.rowHash, hashPattern);
  assert.match(evidence.restartDurability.productionRowHash, hashPattern);
  assert.equal(evidence.releaseVerifier.gate, 'GATE-2');
  assert.equal(evidence.releaseVerifier.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(evidence.releaseVerifier.ok, true);
  assert.equal(evidence.releaseVerifier.gateStatus, 'proven');
  assert.equal(evidence.releaseVerifier.checks.newState, true);
  assert.equal(evidence.releaseVerifier.checks.oldState, true);
  assert.equal(evidence.releaseVerifier.checks.blockedState, true);
  assert.deepEqual(evidence.releaseMovement, {
    allowed: false,
    gates: '0/4',
    reason: 'support-only process-kill retry preservation proof; production release boundary still required',
  });
  assert.equal(evidence.plannedTargets, plan.mutations.length);
  assert.match(evidence.evidenceHash, sha256EvidencePattern);

  const { evidenceHash, ...payload } = evidence;
  assert.equal(evidenceHash, `sha256:${digest(payload)}`);
  assertNoRawValues(evidence, rawValues, 'RPP-0698 release verifier evidence');
  assert.doesNotThrow(() =>
    assertEvidenceHasNoRawValues(evidence, { label: 'RPP-0698 release verifier evidence' }));
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function assertHashOnlyJournalRows(records, rawValues) {
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
  assertNoRawValues(records, rawValues, 'RPP-0698 journal rows');
}

function assertNoRawValues(value, rawValues, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `${label} leaked raw fixture value: ${rawValue}`,
    );
  }
}

function publicTargetSummary(target) {
  return {
    mutationId: target.mutationId,
    resourceKey: target.resourceKey,
    state: target.state,
    code: target.state === 'blocked-unknown'
      ? 'TARGET_DRIFTED_OUTSIDE_ENVELOPE'
      : target.code || null,
    beforeHash: target.beforeHash ?? null,
    afterHash: target.afterHash ?? null,
    observedHash: target.observedHash ?? null,
  };
}

test('RPP-0698 process kill mid mutation set variant 5 release verifier preserves remote changes', () => {
  for (const generatedCase of generatedProcessKillCases) {
    const filePath = tempJournalPath();
    const remoteAfterKillPath = path.join(path.dirname(filePath), 'remote-after-kill.json');
    fs.chmodSync(path.dirname(filePath), 0o700);
    const artifactRefs = artifactRefsFor(generatedCase);
    const activeClaimId = activeClaimIdFor(generatedCase);
    const releaseVerifierClaimId = releaseVerifierClaimIdFor(generatedCase);
    const {
      plan,
      remote,
      expectedPartial,
      beforePlanPreservedKey,
      afterKillPreservedKey,
      preservedBeforePlanValue,
      preservedAfterKillValue,
      rawValues,
    } = generatedSites(generatedCase);

    assertPlanPreservesRemoteOnlyResource(plan, beforePlanPreservedKey);
    assertPlanPreservesRemoteOnlyResource(plan, afterKillPreservedKey);

    const child = spawnProcessKilledWriter({
      filePath,
      remoteAfterKillPath,
      plan,
      remote,
      artifactRefs,
      activeClaimId,
      killAfterMutations: generatedCase.killAfterMutations,
    });

    assert.equal(child.error, undefined);
    assert.equal(child.signal, 'SIGKILL', child.stderr || child.stdout);
    assert.equal(child.status, null, child.stderr || child.stdout);
    assert.equal(fs.existsSync(remoteAfterKillPath), true);

    const retryRemote = JSON.parse(fs.readFileSync(remoteAfterKillPath, 'utf8'));
    assert.deepEqual(retryRemote, expectedPartial);
    retryRemote.files[afterKillPreservedKey] = preservedAfterKillValue;
    assert.equal(retryRemote.files[beforePlanPreservedKey], preservedBeforePlanValue);
    assert.equal(retryRemote.files[afterKillPreservedKey], preservedAfterKillValue);

    const afterKillJournal = readRecoveryJournal(filePath);
    assertPartialJournalAfterKill({
      journal: afterKillJournal,
      plan,
      generatedCase,
      rawValues,
    });

    const partialInspection = inspectRecoveryJournal({
      journal: afterKillJournal,
      plan,
      current: retryRemote,
    });
    assertPartialInspection({
      inspection: partialInspection,
      plan,
      generatedCase,
      rawValues,
    });

    const repairInspection = inspectRecoveryRepair({
      journal: afterKillJournal,
      plan,
      current: retryRemote,
    });
    assertPartialRepairInspection({
      repairInspection,
      plan,
      generatedCase,
      rawValues,
    });

    const productionInspection = openProductionRetry({
      filePath,
      plan,
      current: retryRemote,
      artifactRefs,
      activeClaimId,
      releaseVerifierClaimId,
      rawValues,
    });
    const afterProductionRetry = readRecoveryJournal(filePath);
    assertProductionRetryPreservedRows({
      afterKillJournal,
      afterProductionRetry,
      releaseVerifierClaimId,
      rawValues,
    });
    assert.deepEqual(productionInspection.journal.committedState, afterProductionRetry.committedState);

    const repairAfterProductionRetry = inspectRecoveryRepair({
      journal: afterProductionRetry,
      plan,
      current: retryRemote,
    });
    assertPartialRepairInspection({
      repairInspection: repairAfterProductionRetry,
      plan,
      generatedCase,
      rawValues,
    });

    const writeAttempts = [];
    const replay = replayRecoveryRepair({
      journal: afterProductionRetry,
      plan,
      current: retryRemote,
      mutateCurrent: true,
      writeResource(site, resource, value, context) {
        assert.equal(site.files[beforePlanPreservedKey], preservedBeforePlanValue);
        assert.equal(site.files[afterKillPreservedKey], preservedAfterKillValue);
        writeAttempts.push({
          resourceKey: context.mutation.resourceKey,
          repairAction: context.repairAction,
        });
        setResource(site, resource, value);
        assert.equal(site.files[beforePlanPreservedKey], preservedBeforePlanValue);
        assert.equal(site.files[afterKillPreservedKey], preservedAfterKillValue);
      },
    });

    assertReplayPreservedRemoteChanges({
      replay,
      retryRemote,
      plan,
      generatedCase,
      beforePlanPreservedKey,
      afterKillPreservedKey,
      preservedBeforePlanValue,
      preservedAfterKillValue,
      writeAttempts,
      rawValues,
    });

    const fullyUpdatedInspection = inspectRecoveryJournal({
      journal: afterProductionRetry,
      plan,
      current: retryRemote,
    });
    assertFullyUpdatedInspection({
      inspection: fullyUpdatedInspection,
      plan,
      rawValues,
    });

    const oldRemoteInspection = inspectRecoveryJournal({
      journal: afterProductionRetry,
      plan,
      current: remote,
    });
    assertOldRemoteInspection({
      inspection: oldRemoteInspection,
      plan,
      rawValues,
    });

    const driftedValue = `remote-raw-rpp-0698-${generatedCase.id}-target-release-verifier-drift`;
    const rawValuesWithDrift = [...rawValues, driftedValue];
    const driftedRemote = cloneJson(retryRemote);
    driftedRemote.files[targetFileName(generatedCase, generatedCase.mutationCount)] = driftedValue;
    const blockedUnknownInspection = inspectRecoveryJournal({
      journal: afterProductionRetry,
      plan,
      current: driftedRemote,
    });
    assertBlockedUnknownInspection({
      inspection: blockedUnknownInspection,
      plan,
      rawValues: rawValuesWithDrift,
    });

    const checkedPath = productionInspection.journal.checked[0];
    const restartRows = restartDurabilityEvidence({
      afterKillJournal,
      afterProductionRetry,
      partialInspection,
      plan,
      generatedCase,
      checkedPath,
    });
    const newRemoteRecovery = newRemoteRecoveryFromInspection({
      inspection: fullyUpdatedInspection,
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
    const preservedRetryEvidence = preservedRemoteRetryEvidence({
      beforePlanPreservedKey,
      afterKillPreservedKey,
      preservedBeforePlanValue,
      preservedAfterKillValue,
      checkedPath,
    });
    const releaseSummary = buildRecoveryReleaseSummary({
      productionInspection,
      plan,
      newRemoteRecovery,
      oldRemoteRecovery,
      restartRows,
      preservedRetryEvidence,
    });
    const releaseProof = buildDurableRecoveryJournalReleaseProof({
      releaseSummary,
      applyRevalidation: buildBlockedApplyRevalidation({ blockedRecovery }),
    });

    assertReleaseVerifierProof(releaseProof, {
      releaseSummary,
      plan,
      newRemoteRecovery,
      oldRemoteRecovery,
      blockedRecovery,
      releaseVerifierClaimId,
      checkedPath,
      rawValues: rawValuesWithDrift,
    });

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
    assertNoRawValues(mutatingRetryProof, rawValuesWithDrift, 'RPP-0698 mutating retry proof');

    const evidence = releaseVerifierEvidenceFor({
      generatedCase,
      plan,
      checkedPath,
      afterProductionRetry,
      partialInspection,
      repairInspection: repairAfterProductionRetry,
      replay,
      releaseProof,
      preservedRetryEvidence,
      restartRows,
    });
    assertReleaseVerifierEvidence(evidence, {
      generatedCase,
      plan,
      rawValues: rawValuesWithDrift,
    });
    assertNoRawValues(fs.readFileSync(filePath, 'utf8'), rawValuesWithDrift, 'RPP-0698 journal file');
  }
});
