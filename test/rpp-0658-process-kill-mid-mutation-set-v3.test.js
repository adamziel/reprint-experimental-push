import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

const fixedNow = new Date('2026-05-31T11:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const generatedProcessKillCases = Object.freeze([
  {
    id: 'rpp-0658-mid-set-four-v3',
    mutationCount: 4,
    killAfterMutations: 2,
  },
  {
    id: 'rpp-0658-mid-set-six-v3',
    mutationCount: 6,
    killAfterMutations: 3,
  },
]);

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0658-mid-mutation-set-v3-'));
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
        `base-raw-rpp-0658-${generatedCase.id}-preserved-before-plan`,
      [afterKillPreservedKey]:
        `base-raw-rpp-0658-${generatedCase.id}-preserved-after-kill`,
    },
    plugins: {},
    db: {},
  };

  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[targetFileName(generatedCase, index)] =
      `base-raw-rpp-0658-${generatedCase.id}-target-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[targetFileName(generatedCase, index)] =
      `local-raw-rpp-0658-${generatedCase.id}-target-${index}`;
  }
  remote.files[beforePlanPreservedKey] =
    `remote-raw-rpp-0658-${generatedCase.id}-preserved-before-plan`;

  const preservedAfterKillValue =
    `remote-raw-rpp-0658-${generatedCase.id}-preserved-after-kill`;
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
    releaseProof: `artifact://rpp-0658/${generatedCase.id}/local-release-proof-not-production-durable`,
    recoverySupport: `artifact://rpp-0658/${generatedCase.id}/process-kill-mid-mutation-set-v3`,
    durabilityScope: `artifact://rpp-0658/${generatedCase.id}/sandbox-jsonl-only`,
  };
}

function claimIdFor(generatedCase) {
  return `${generatedCase.id}-claim`;
}

function spawnProcessKilledWriter({
  filePath,
  remoteAfterKillPath,
  plan,
  remote,
  artifactRefs,
  claimId,
  killAfterMutations,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const childScript = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { openProductionRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};

    const plan = JSON.parse(process.env.RPP0658_PLAN);
    const remote = JSON.parse(process.env.RPP0658_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0658_ARTIFACT_REFS);
    const killAfterMutations = Number(process.env.RPP0658_KILL_AFTER_MUTATIONS);
    const filePath = process.env.RPP0658_JOURNAL_PATH;
    const remoteAfterKillPath = process.env.RPP0658_REMOTE_AFTER_KILL_PATH;

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
      now: new Date(process.env.RPP0658_NOW),
      truncate: true,
      claimId: process.env.RPP0658_CLAIM_ID,
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
      journal: JSON.parse(process.env.RPP0658_PREVIOUS_JOURNAL),
      mutateRemote: true,
      artifactRefs,
    });
    console.error('expected SIGKILL after mutation-observed row');
    process.exit(4);
  `;

  return spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0658_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0658_CLAIM_ID: claimId,
      RPP0658_JOURNAL_PATH: filePath,
      RPP0658_KILL_AFTER_MUTATIONS: String(killAfterMutations),
      RPP0658_NOW: fixedNow.toISOString(),
      RPP0658_PLAN: JSON.stringify(plan),
      RPP0658_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0658_REMOTE_AFTER_KILL_PATH: remoteAfterKillPath,
      RPP0658_REMOTE_SITE: JSON.stringify(remote),
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
  assert.equal(recordsOfType(journal.records, 'mutation-observed').length, generatedCase.killAfterMutations);
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
  assertNoRawValues(inspection, rawValues, 'RPP-0658 partial inspection');
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
  assertNoRawValues(repairInspection.journal.records, rawValues, 'RPP-0658 repair inspection rows');
}

function openProductionRetry({
  filePath,
  plan,
  current,
  artifactRefs,
  claimId,
  rawValues,
}) {
  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 1_000),
    truncate: false,
    claimId,
  });
  const productionInspection = retry.inspect();
  retry.close();

  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(productionInspection), true);
  assert.equal(productionInspection.claim.activeClaimId, claimId);
  assert.equal(productionInspection.claim.activeClaimHash, recoveryClaimHash(claimId));
  assert.equal(productionInspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(productionInspection.journal.restartReadable, true);
  assert.equal(productionInspection.journal.committedState.restartReadable, true);
  assertNoRawValues(productionInspection, rawValues, 'RPP-0658 production retry inspection');

  return productionInspection;
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
  assertNoRawValues(replay.before.journal.records, rawValues, 'RPP-0658 repair-before journal rows');
  assertNoRawValues(replay.after.journal.records, rawValues, 'RPP-0658 repair-after journal rows');
}

function processKillEvidenceSummary({
  generatedCase,
  afterProductionRetry,
  partialInspection,
  repairInspection,
  replay,
}) {
  return {
    issue: 'RPP-0658',
    variant: 3,
    processKillBoundary: {
      signal: 'SIGKILL',
      killAfterMutations: generatedCase.killAfterMutations,
      mutationCount: generatedCase.mutationCount,
      committedRows: afterProductionRetry.committedState.mutationRows,
      completedRows: afterProductionRetry.committedState.completedRows,
      restartReadable: afterProductionRetry.committedState.restartReadable,
      journalRowsHash: digest(afterProductionRetry.records),
    },
    retryPreservation: {
      inspectionStatus: partialInspection.status,
      repairStatus: repairInspection.status,
      replayStatus: replay.status,
      appliedMutations: replay.appliedMutations,
      skippedMutations: replay.skippedTargets.length,
      preservedRemoteChanges: true,
    },
    releasePosture: 'LOCAL_SANDBOX_ONLY',
  };
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function assertHashOnlyJournalRows(records, rawValues) {
  for (const record of records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
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
  assertNoRawValues(records, rawValues, 'RPP-0658 journal rows');
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

test('RPP-0658 generated process kill mid mutation set variant 3 retry preserves remote changes', () => {
  for (const generatedCase of generatedProcessKillCases) {
    const filePath = tempJournalPath();
    const remoteAfterKillPath = path.join(path.dirname(filePath), 'remote-after-kill.json');
    fs.chmodSync(path.dirname(filePath), 0o700);
    const artifactRefs = artifactRefsFor(generatedCase);
    const claimId = claimIdFor(generatedCase);
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
      claimId,
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

    const productionRetryInspection = openProductionRetry({
      filePath,
      plan,
      current: retryRemote,
      artifactRefs,
      claimId,
      rawValues,
    });
    const afterProductionRetry = readRecoveryJournal(filePath);
    assert.equal(afterProductionRetry.records.length, afterKillJournal.records.length + 1);
    assert.equal(afterProductionRetry.integrity.status, 'ok');
    assert.equal(afterProductionRetry.openState.latestOpenType, 'journal-retry-opened');
    assert.equal(afterProductionRetry.openState.state, 'retrying-active-claim');
    assert.equal(afterProductionRetry.committedState.mutationRows, generatedCase.killAfterMutations);
    assert.equal(afterProductionRetry.committedState.completedRows, 0);
    assert.deepEqual(productionRetryInspection.journal.committedState, afterProductionRetry.committedState);
    assertHashOnlyJournalRows(afterProductionRetry.records, rawValues);

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

    const evidence = processKillEvidenceSummary({
      generatedCase,
      afterProductionRetry,
      partialInspection,
      repairInspection: repairAfterProductionRetry,
      replay,
    });
    assert.equal(evidence.retryPreservation.preservedRemoteChanges, true);
    assert.match(evidence.processKillBoundary.journalRowsHash, hashPattern);
    assertNoRawValues(evidence, rawValues, 'RPP-0658 evidence summary');
    assertNoRawValues(fs.readFileSync(filePath, 'utf8'), rawValues, 'RPP-0658 journal file');
  }
});
