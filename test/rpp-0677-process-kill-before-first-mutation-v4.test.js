import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal, RECOVERY_INSPECT_REASON_CODES } from '../src/recovery-inspect.js';
import { assertJournalRecordHasNoRawValues, readRecoveryJournal, recoveryClaimHash } from '../src/recovery-journal.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T16:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const generatedBeforeFirstMutationCases = Object.freeze([
  {
    id: 'rpp-0677-before-first-mutation-four-v4',
    mutationCount: 4,
  },
  {
    id: 'rpp-0677-before-first-mutation-six-v4',
    mutationCount: 6,
  },
]);

function tempWorkDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0677-before-first-mutation-v4-'));
  fs.chmodSync(dir, 0o700);
  return dir;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const base = { files: {}, plugins: {}, db: {} };
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[targetFileName(generatedCase, index)] =
      `base-private-rpp-0677-${generatedCase.id}-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[targetFileName(generatedCase, index)] =
      `local-private-rpp-0677-${generatedCase.id}-${index}`;
  }

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

  return {
    plan,
    remote,
    rawSiteValues: rawSiteValuesFor(base, local, remote),
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
  const values = new Set([
    'base-private-rpp-0677',
    'local-private-rpp-0677',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
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
    releaseProof: `artifact://rpp-0677/${generatedCase.id}/local-release-proof-not-production-durable`,
    recoverySupport: `artifact://rpp-0677/${generatedCase.id}/process-kill-before-first-mutation-v4`,
    durabilityScope: `artifact://rpp-0677/${generatedCase.id}/sandbox-jsonl-process-restart`,
  };
}

function claimIdFor(generatedCase) {
  return `${generatedCase.id}-claim`;
}

function spawnBeforeFirstMutationWriter({
  filePath,
  markerPath,
  plan,
  remote,
  artifactRefs,
  claimId,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const stableJsonModule = new URL('../src/stable-json.js', import.meta.url).href;
  const childScript = `
    import fs from 'node:fs';
    import { openProductionRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};
    import { digest } from ${JSON.stringify(stableJsonModule)};

    const plan = JSON.parse(process.env.RPP0677_PLAN);
    const remote = JSON.parse(process.env.RPP0677_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0677_ARTIFACT_REFS);
    const filePath = process.env.RPP0677_JOURNAL_PATH;
    const markerPath = process.env.RPP0677_MARKER_PATH;
    const writer = openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      now: new Date(process.env.RPP0677_NOW),
      truncate: true,
      claimId: process.env.RPP0677_CLAIM_ID,
    });

    try {
      applyPlan(remote, plan, {
        durableJournal: writer,
        journal: JSON.parse(process.env.RPP0677_PREVIOUS_JOURNAL),
        mutateRemote: true,
        artifactRefs,
        beforeMutation({ mutationIndex, mutation, remote: currentRemote }) {
          if (mutationIndex !== 1) {
            return;
          }
          fs.writeFileSync(markerPath, JSON.stringify({
            issue: 'RPP-0677',
            variant: 4,
            boundary: 'before-first-mutation',
            planId: plan.id,
            mutationIndex,
            mutationId: mutation.id,
            resourceKey: mutation.resourceKey,
            mutationCount: plan.mutations.length,
            remoteHashBeforeMutation: digest(currentRemote),
          }) + '\\n');
          const killGate = new Int32Array(new SharedArrayBuffer(4));
          Atomics.wait(killGate, 0, 0);
        },
      });
      fs.writeFileSync(markerPath + '.unexpected-success', 'apply unexpectedly completed before kill\\n');
      process.exit(3);
    } catch (error) {
      fs.writeFileSync(markerPath + '.unexpected-error', (error?.stack || String(error)) + '\\n');
      process.exit(2);
    }
  `;

  const child = spawn(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0677_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0677_CLAIM_ID: claimId,
      RPP0677_JOURNAL_PATH: filePath,
      RPP0677_MARKER_PATH: markerPath,
      RPP0677_NOW: fixedNow.toISOString(),
      RPP0677_PLAN: JSON.stringify(plan),
      RPP0677_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0677_REMOTE_SITE: JSON.stringify(remote),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}

function readJournalInRestartedProcess({
  filePath,
  plan,
  remote,
}) {
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const recoveryInspectModule = new URL('../src/recovery-inspect.js', import.meta.url).href;
  const stableJsonModule = new URL('../src/stable-json.js', import.meta.url).href;
  const childScript = `
    import { readRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { inspectRecoveryJournal } from ${JSON.stringify(recoveryInspectModule)};
    import { digest } from ${JSON.stringify(stableJsonModule)};

    try {
      const journal = readRecoveryJournal(process.env.RPP0677_JOURNAL_PATH);
      const plan = JSON.parse(process.env.RPP0677_PLAN);
      const current = JSON.parse(process.env.RPP0677_REMOTE_SITE);
      const inspection = inspectRecoveryJournal({ journal, plan, current });
      console.log(JSON.stringify({
        journal,
        inspection,
        rowsHash: digest(journal.records),
      }));
    } catch (error) {
      console.error(error?.stack || String(error));
      process.exit(2);
    }
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0677_JOURNAL_PATH: filePath,
      RPP0677_PLAN: JSON.stringify(plan),
      RPP0677_REMOTE_SITE: JSON.stringify(remote),
    },
    encoding: 'utf8',
  });

  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.stdout.trim().length > 0, true);
  return JSON.parse(child.stdout);
}

async function buildRestartedCrashFixture(generatedCase) {
  const workDir = tempWorkDir();
  const filePath = path.join(workDir, 'recovery.jsonl');
  const markerPath = path.join(workDir, 'before-first-mutation-marker.json');
  const { plan, remote, rawSiteValues } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);
  const claimId = claimIdFor(generatedCase);
  const logs = [];
  const child = spawnBeforeFirstMutationWriter({
    filePath,
    markerPath,
    plan,
    remote,
    artifactRefs,
    claimId,
  });
  child.stdout.on('data', (chunk) => logs.push(chunk));
  child.stderr.on('data', (chunk) => logs.push(chunk));

  try {
    const markerText = await waitForFile(markerPath, { timeoutMs: 5_000 });
    const marker = JSON.parse(markerText);
    assertCrashBoundaryMarker(marker, { plan, remote });

    const preKillJournal = readRecoveryJournal(filePath);
    assertPreMutationJournal(preKillJournal, {
      plan,
      claimId,
      artifactRefs,
      rawSiteValues,
      label: `${generatedCase.id} pre-kill journal`,
    });

    const killed = await killChildIfRunning(child, 'SIGKILL');
    assert.equal(killed.signal, 'SIGKILL');
    assert.equal(fs.existsSync(`${markerPath}.unexpected-success`), false);
    assert.equal(fs.existsSync(`${markerPath}.unexpected-error`), false);

    const afterKillJournal = readRecoveryJournal(filePath);
    assertPreMutationJournal(afterKillJournal, {
      plan,
      claimId,
      artifactRefs,
      rawSiteValues,
      label: `${generatedCase.id} after-kill journal`,
    });
    assert.deepEqual(afterKillJournal.records, preKillJournal.records);

    const restartedReadback = readJournalInRestartedProcess({
      filePath,
      plan,
      remote,
    });
    assertPreMutationJournal(restartedReadback.journal, {
      plan,
      claimId,
      artifactRefs,
      rawSiteValues,
      label: `${generatedCase.id} restarted child readback`,
    });
    assert.deepEqual(restartedReadback.journal.records, preKillJournal.records);
    assert.equal(restartedReadback.rowsHash, digest(preKillJournal.records));

    assertOldRemoteInspection(restartedReadback.inspection, { plan, rawSiteValues });

    const evidence = processKillRestartEvidenceFor({
      generatedCase,
      marker,
      preKillJournal,
      afterKillJournal,
      restartedReadback,
      plan,
    });
    assertEvidenceScope(evidence, rawSiteValues);
    assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0677 journal file');

    return {
      filePath,
      markerPath,
      marker,
      plan,
      remote,
      rawSiteValues,
      preKillJournal,
      afterKillJournal,
      restartedReadback,
      evidence,
    };
  } catch (error) {
    await killChildIfRunning(child).catch(() => {});
    throw new Error(`${error.message}\nchild output:\n${logs.join('')}`);
  }
}

function assertCrashBoundaryMarker(marker, { plan, remote }) {
  assert.equal(marker.issue, 'RPP-0677');
  assert.equal(marker.variant, 4);
  assert.equal(marker.boundary, 'before-first-mutation');
  assert.equal(marker.planId, plan.id);
  assert.equal(marker.mutationIndex, 1);
  assert.equal(marker.mutationId, plan.mutations[0].id);
  assert.equal(marker.resourceKey, plan.mutations[0].resourceKey);
  assert.equal(marker.mutationCount, plan.mutations.length);
  assert.equal(marker.remoteHashBeforeMutation, digest(remote));
  assert.match(marker.remoteHashBeforeMutation, hashPattern);
}

function assertPreMutationJournal(journal, {
  plan,
  claimId,
  artifactRefs,
  rawSiteValues,
  label,
}) {
  assert.equal(journal.integrity.status, 'ok', `${label} must be integrity-ok`);
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    Array.from({ length: journal.records.length }, (_, index) => index + 1),
    `${label} sequences must remain monotonic`,
  );
  assert.deepEqual(
    journal.records.map((record) => record.type),
    [
      'journal-opened',
      'journal-ownership-recorded',
      ...Array.from({ length: plan.mutations.length }, () => 'target-planned'),
      'recovery-claim-opened',
      'journal-retry-opened',
      'apply-staged',
      'dependencies-validated',
      'apply-committing',
    ],
    `${label} must stop before the first mutation event`,
  );
  assert.equal(recordsOfType(journal.records, 'mutation-observed').length, 0);
  assert.equal(recordsOfType(journal.records, 'journal-completed').length, 0);
  assert.equal(recordsOfType(journal.records, 'recovery-state').length, 0);
  assert.equal(recordsOfType(journal.records, 'journal-ownership-recorded').length, 1);
  assert.equal(recordsOfType(journal.records, 'target-planned').length, plan.mutations.length);
  assert.equal(journal.records.every((record) => record.fsync?.requested === true), true);

  const claimRecord = journal.records.find((record) => record.type === 'recovery-claim-opened');
  assert.ok(claimRecord);
  assert.equal(claimRecord.claimId, claimId);
  assert.equal(claimRecord.claimHash, recoveryClaimHash(claimId));
  assert.deepEqual(claimRecord.artifactRefs, artifactRefs);
  assert.match(claimRecord.observedHash, hashPattern);

  const retryOpen = recordsOfType(journal.records, 'journal-retry-opened').at(-1);
  assert.ok(retryOpen);
  assert.equal(retryOpen.state, 'retrying-old-remote');
  assert.deepEqual(retryOpen.artifactRefs, artifactRefs);

  assert.equal(journal.openState.restartReadable, true);
  assert.equal(journal.openState.openRows, 2);
  assert.equal(journal.openState.latestOpenType, 'journal-retry-opened');
  assert.equal(journal.openState.state, 'retrying-old-remote');
  assert.equal(journal.stagedState.restartReadable, true);
  assert.equal(journal.stagedState.stagedRows, 2);
  assert.equal(journal.stagedState.targetRows, plan.mutations.length);
  assert.equal(journal.stagedState.latestStagedType, 'dependencies-validated');
  assert.equal(journal.committedState.restartReadable, false);
  assert.equal(journal.committedState.status, 'missing');

  assertHashOnlyJournalRows(journal.records, rawSiteValues, label);
}

function assertHashOnlyJournalRows(records, rawSiteValues, label) {
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
        assert.match(record[field], hashPattern, `${label} ${field} must be SHA-256-shaped`);
      }
    }
  }
  assertNoRawSiteValues(records, rawSiteValues, label);
}

function assertOldRemoteInspection(inspection, { plan, rawSiteValues }) {
  assert.equal(inspection.status, 'old-remote');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.oldRemote);
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assert.equal(inspection.journal.openState.restartReadable, true);
  assert.equal(inspection.journal.stagedState.restartReadable, true);
  assert.equal(inspection.journal.committedState.restartReadable, false);
  assert.equal(inspection.targets.length, plan.mutations.length);
  for (const target of inspection.targets) {
    assert.equal(target.state, 'old');
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    assert.match(target.observedHash, hashPattern);
    assert.equal(target.observedHash, target.beforeHash);
    assert.notEqual(target.beforeHash, target.afterHash);
  }
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0677 old-remote restart inspection');
}

function processKillRestartEvidenceFor({
  generatedCase,
  marker,
  preKillJournal,
  afterKillJournal,
  restartedReadback,
  plan,
}) {
  const rowsBeforeKillHash = digest(preKillJournal.records);
  const rowsAfterKillHash = digest(afterKillJournal.records);
  const rowsAfterRestartHash = restartedReadback.rowsHash;

  return {
    issue: 'RPP-0677',
    variant: 4,
    source: 'sandbox-child-sigkill-restarted-child-readback',
    processKillBoundary: {
      signal: 'SIGKILL',
      name: marker.boundary,
      mutationIndex: marker.mutationIndex,
      mutationCount: marker.mutationCount,
      mutationId: marker.mutationId,
      resourceKey: marker.resourceKey,
      markerHash: digest(marker),
      remoteHashBeforeMutation: marker.remoteHashBeforeMutation,
      mutationObservedRows: recordsOfType(restartedReadback.journal.records, 'mutation-observed').length,
      completedRows: recordsOfType(restartedReadback.journal.records, 'journal-completed').length,
    },
    durableRestartReadback: {
      proved: rowsBeforeKillHash === rowsAfterKillHash
        && rowsBeforeKillHash === rowsAfterRestartHash
        && restartedReadback.journal.integrity.status === 'ok',
      storage: restartedReadback.journal.storage || 'filesystem-jsonl',
      processBoundary: 'writer-sigkill-then-reader-process',
      durableRows: restartedReadback.journal.records.length,
      rowsBeforeKillHash,
      rowsAfterKillHash,
      rowsAfterRestartHash,
      openStateRestartReadable: restartedReadback.journal.openState.restartReadable,
      stagedStateRestartReadable: restartedReadback.journal.stagedState.restartReadable,
      committedStateRestartReadable: restartedReadback.journal.committedState.restartReadable,
      inspectionStatus: restartedReadback.inspection.status,
      counts: {
        ...restartedReadback.inspection.counts,
        total: plan.mutations.length,
      },
    },
    targetEnvelope: {
      total: plan.mutations.length,
      allTargetsOld: restartedReadback.inspection.targets.every((target) => target.state === 'old'),
      targetsHash: digest(restartedReadback.inspection.targets.map((target) => ({
        mutationId: target.mutationId,
        resourceKey: target.resourceKey,
        state: target.state,
        beforeHash: target.beforeHash,
        afterHash: target.afterHash,
        observedHash: target.observedHash,
      }))),
    },
    productionBackedDurableJournalProof: {
      proved: false,
      reasonCode: 'LOCAL_SANDBOX_ONLY',
      requiredBoundary: 'live-production-backed-durable-journal',
    },
    releasePosture: 'NO-GO',
    fixtureId: generatedCase.id,
  };
}

function assertEvidenceScope(evidence, rawSiteValues) {
  assert.equal(evidence.issue, 'RPP-0677');
  assert.equal(evidence.variant, 4);
  assert.equal(evidence.processKillBoundary.signal, 'SIGKILL');
  assert.equal(evidence.processKillBoundary.name, 'before-first-mutation');
  assert.equal(evidence.processKillBoundary.mutationIndex, 1);
  assert.equal(evidence.processKillBoundary.mutationObservedRows, 0);
  assert.equal(evidence.processKillBoundary.completedRows, 0);
  assert.equal(evidence.durableRestartReadback.proved, true);
  assert.equal(evidence.durableRestartReadback.processBoundary, 'writer-sigkill-then-reader-process');
  assert.equal(evidence.durableRestartReadback.openStateRestartReadable, true);
  assert.equal(evidence.durableRestartReadback.stagedStateRestartReadable, true);
  assert.equal(evidence.durableRestartReadback.committedStateRestartReadable, false);
  assert.equal(evidence.durableRestartReadback.inspectionStatus, 'old-remote');
  assert.equal(evidence.targetEnvelope.allTargetsOld, true);
  assert.equal(evidence.productionBackedDurableJournalProof.proved, false);
  assert.equal(evidence.productionBackedDurableJournalProof.reasonCode, 'LOCAL_SANDBOX_ONLY');
  assert.equal(evidence.releasePosture, 'NO-GO');
  for (const field of [
    evidence.processKillBoundary.markerHash,
    evidence.processKillBoundary.remoteHashBeforeMutation,
    evidence.durableRestartReadback.rowsBeforeKillHash,
    evidence.durableRestartReadback.rowsAfterKillHash,
    evidence.durableRestartReadback.rowsAfterRestartHash,
    evidence.targetEnvelope.targetsHash,
  ]) {
    assert.match(field, hashPattern);
  }
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0677 evidence summary');
}

function recordsOfType(records, type) {
  return records.filter((record) => record.type === type);
}

function assertNoRawSiteValues(value, rawSiteValues, label) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawValue of rawSiteValues) {
    assert.equal(
      serialized.includes(rawValue),
      false,
      `${label} leaked raw site value: ${rawValue}`,
    );
  }
}

function waitForFile(filePath, { timeoutMs = 5_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(filePath)) {
        resolve(fs.readFileSync(filePath, 'utf8'));
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${filePath}`));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

function waitForChildExit(child, { timeoutMs = 5_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }

    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error(`Timed out waiting for child process ${child.pid} to exit`));
    }, timeoutMs);

    function onExit(code, signal) {
      clearTimeout(timer);
      resolve({ code, signal });
    }

    child.once('exit', onExit);
  });
}

async function killChildIfRunning(child, signal = 'SIGKILL') {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return { code: child?.exitCode ?? null, signal: child?.signalCode ?? null };
  }
  child.kill(signal);
  return waitForChildExit(child, { timeoutMs: 5_000 });
}

test('RPP-0677 process kill before first mutation keeps journal rows durable after restarted readback variant 4', { timeout: 30_000 }, async () => {
  for (const generatedCase of generatedBeforeFirstMutationCases) {
    await buildRestartedCrashFixture(generatedCase);
  }
});
