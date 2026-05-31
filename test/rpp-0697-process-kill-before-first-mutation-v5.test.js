import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertEvidenceHasNoRawValues } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { inspectRecoveryJournal, RECOVERY_INSPECT_REASON_CODES } from '../src/recovery-inspect.js';
import {
  assertJournalRecordHasNoRawValues,
  openProductionRecoveryJournal,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  readRecoveryJournal,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import { deserializeResourceValue, resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-31T17:00:00.000Z');
const retryNow = new Date(fixedNow.getTime() + 7_000);
const claimStaleThresholdMs = 2_000;
const sourceUrl = 'http://127.0.0.1:8080';
const checkedCommand = 'timeout 300s npm run verify:release';
const checkedRoute = '/wp-json/reprint/v1/push/recovery/inspect';
const hashPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;

const generatedBeforeFirstMutationCases = Object.freeze([
  {
    id: 'rpp-0697-before-first-mutation-five-v5',
    mutationCount: 5,
  },
  {
    id: 'rpp-0697-before-first-mutation-seven-v5',
    mutationCount: 7,
  },
]);

function tempWorkDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0697-before-first-mutation-v5-'));
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
      `base-private-rpp-0697-${generatedCase.id}-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[targetFileName(generatedCase, index)] =
      `local-private-rpp-0697-${generatedCase.id}-${index}`;
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
    'base-private-rpp-0697',
    'local-private-rpp-0697',
    'outside-envelope-private-rpp-0697',
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
    releaseProof: `artifact://rpp-0697/${generatedCase.id}/local-release-verifier-shaped-proof`,
    recoverySupport: `artifact://rpp-0697/${generatedCase.id}/process-kill-before-first-mutation-v5`,
    durabilityScope: `artifact://rpp-0697/${generatedCase.id}/sandbox-jsonl-process-restart`,
  };
}

function claimIdFor(generatedCase, suffix) {
  return `${generatedCase.id}-${suffix}-claim`;
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

    const plan = JSON.parse(process.env.RPP0697_PLAN);
    const remote = JSON.parse(process.env.RPP0697_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0697_ARTIFACT_REFS);
    const filePath = process.env.RPP0697_JOURNAL_PATH;
    const markerPath = process.env.RPP0697_MARKER_PATH;
    const writer = openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      now: new Date(process.env.RPP0697_NOW),
      truncate: true,
      claimId: process.env.RPP0697_CLAIM_ID,
      claimStaleThresholdMs: Number(process.env.RPP0697_CLAIM_STALE_THRESHOLD_MS),
    });

    try {
      applyPlan(remote, plan, {
        durableJournal: writer,
        journal: JSON.parse(process.env.RPP0697_PREVIOUS_JOURNAL),
        mutateRemote: true,
        artifactRefs,
        beforeMutation({ mutationIndex, mutation, remote: currentRemote }) {
          if (mutationIndex !== 1) {
            return;
          }
          fs.writeFileSync(markerPath, JSON.stringify({
            issue: 'RPP-0697',
            variant: 5,
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
      RPP0697_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0697_CLAIM_ID: claimId,
      RPP0697_CLAIM_STALE_THRESHOLD_MS: String(claimStaleThresholdMs),
      RPP0697_JOURNAL_PATH: filePath,
      RPP0697_MARKER_PATH: markerPath,
      RPP0697_NOW: fixedNow.toISOString(),
      RPP0697_PLAN: JSON.stringify(plan),
      RPP0697_PREVIOUS_JOURNAL: JSON.stringify(oldRemoteJournalForPlan(remote, plan)),
      RPP0697_REMOTE_SITE: JSON.stringify(remote),
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
      const journal = readRecoveryJournal(process.env.RPP0697_JOURNAL_PATH);
      const plan = JSON.parse(process.env.RPP0697_PLAN);
      const current = JSON.parse(process.env.RPP0697_REMOTE_SITE);
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
      RPP0697_JOURNAL_PATH: filePath,
      RPP0697_PLAN: JSON.stringify(plan),
      RPP0697_REMOTE_SITE: JSON.stringify(remote),
    },
    encoding: 'utf8',
  });

  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.equal(child.stdout.trim().length > 0, true);
  return JSON.parse(child.stdout);
}

function openReleaseVerifierRetry({
  filePath,
  plan,
  remote,
  artifactRefs,
  retryClaimId,
}) {
  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: retryNow,
    truncate: false,
    claimId: retryClaimId,
    claimStaleThresholdMs,
  });

  try {
    return retry.inspect();
  } finally {
    retry.close();
  }
}

async function buildRestartedCrashFixture(generatedCase) {
  const workDir = tempWorkDir();
  const filePath = path.join(workDir, 'recovery.jsonl');
  const markerPath = path.join(workDir, 'before-first-mutation-marker.json');
  const { plan, remote, rawSiteValues } = generatedSites(generatedCase);
  const artifactRefs = artifactRefsFor(generatedCase);
  const activeClaimId = claimIdFor(generatedCase, 'active-writer');
  const retryClaimId = claimIdFor(generatedCase, 'release-verifier-retry');
  const logs = [];
  const child = spawnBeforeFirstMutationWriter({
    filePath,
    markerPath,
    plan,
    remote,
    artifactRefs,
    claimId: activeClaimId,
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
      claimId: activeClaimId,
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
      claimId: activeClaimId,
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
      claimId: activeClaimId,
      artifactRefs,
      rawSiteValues,
      label: `${generatedCase.id} restarted child readback`,
    });
    assert.deepEqual(restartedReadback.journal.records, preKillJournal.records);
    assert.equal(restartedReadback.rowsHash, digest(preKillJournal.records));
    assertOldRemoteInspection(restartedReadback.inspection, { plan, rawSiteValues });

    const productionInspection = openReleaseVerifierRetry({
      filePath,
      plan,
      remote,
      artifactRefs,
      retryClaimId,
    });
    assertProductionRetryInspection(productionInspection, {
      filePath,
      activeClaimId,
      retryClaimId,
      rawSiteValues,
    });

    const productionRestart = readRecoveryJournal(filePath);
    assertProductionRetryPreservedRows({
      preKillJournal,
      productionRestart,
      retryClaimId,
      rawSiteValues,
    });

    const releaseRestartReadback = readJournalInRestartedProcess({
      filePath,
      plan,
      remote,
    });
    assert.deepEqual(releaseRestartReadback.journal.records, productionRestart.records);
    assertOldRemoteInspection(releaseRestartReadback.inspection, { plan, rawSiteValues });

    const checkedPath = productionInspection.journal.checked[0];
    const restartDurability = restartDurabilityEvidenceFor({
      marker,
      preKillJournal,
      afterKillJournal,
      restartedReadback,
      productionRestart,
      releaseRestartReadback,
      plan,
      checkedPath,
    });
    const oldRemoteRecovery = oldRemoteRecoveryFromInspection({
      inspection: releaseRestartReadback.inspection,
      plan,
      checkedPath,
    });
    const releaseSummary = buildRecoveryReleaseSummary({
      productionInspection,
      plan,
      oldRemoteRecovery,
      restartDurability,
    });
    const releaseProof = buildDurableRecoveryJournalReleaseProof({
      releaseSummary,
      applyRevalidation: buildBlockedApplyRevalidation(plan),
    });
    assertReleaseVerifierProof(releaseProof, {
      releaseSummary,
      plan,
      oldRemoteRecovery,
      restartDurability,
      retryClaimId,
      checkedPath,
      rawSiteValues,
    });

    const evidence = releaseVerifierEvidenceFor({
      generatedCase,
      marker,
      plan,
      restartDurability,
      oldRemoteRecovery,
      releaseProof,
      checkedPath,
    });
    assertReleaseVerifierEvidence(evidence, {
      generatedCase,
      plan,
      rawSiteValues,
    });

    assertNoRawSiteValues(fs.readFileSync(filePath, 'utf8'), rawSiteValues, 'RPP-0697 journal file');
    assertNoRawSiteValues(releaseSummary, rawSiteValues, 'RPP-0697 release summary');
    assertNoRawSiteValues(releaseProof, rawSiteValues, 'RPP-0697 release proof');
    assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0697 evidence summary');
    assert.doesNotThrow(() =>
      assertEvidenceHasNoRawValues(releaseProof, { label: 'RPP-0697 release proof' }));
    assert.doesNotThrow(() =>
      assertEvidenceHasNoRawValues(evidence, { label: 'RPP-0697 release verifier evidence' }));

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
      productionInspection,
      productionRestart,
      releaseRestartReadback,
      restartDurability,
      oldRemoteRecovery,
      releaseSummary,
      releaseProof,
      evidence,
    };
  } catch (error) {
    await killChildIfRunning(child).catch(() => {});
    throw new Error(`${error.message}\nchild output:\n${logs.join('')}`);
  }
}

function assertCrashBoundaryMarker(marker, { plan, remote }) {
  assert.equal(marker.issue, 'RPP-0697');
  assert.equal(marker.variant, 5);
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
  assert.equal(claimRecord.staleThresholdMs, claimStaleThresholdMs);
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

function assertProductionRetryInspection(inspection, {
  filePath,
  activeClaimId,
  retryClaimId,
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
  assert.equal(inspection.journal.ownership.ownsJournal, true);
  assert.equal(inspection.journal.ownership.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.staleClaimRejected, true);
  assert.equal(inspection.journal.writerLease.claimId, retryClaimId);
  assert.equal(inspection.journal.writerLease.claimKeyHash, recoveryClaimHash(retryClaimId));
  assert.equal(inspection.journal.leaseFence.writerLease.claimId, retryClaimId);
  assert.equal(
    inspection.journal.leaseFence.writerLease.claimKeyHash,
    recoveryClaimHash(retryClaimId),
  );
  assert.deepEqual(inspection.journal.checked, [filePath]);
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0697 release-verifier retry inspection');
}

function assertProductionRetryPreservedRows({
  preKillJournal,
  productionRestart,
  retryClaimId,
  rawSiteValues,
}) {
  assert.equal(productionRestart.integrity.status, 'ok');
  assert.deepEqual(
    productionRestart.records.slice(0, preKillJournal.records.length),
    preKillJournal.records,
  );
  assert.deepEqual(
    productionRestart.records.slice(preKillJournal.records.length).map((record) => record.type),
    [
      'stale-claim-advanced',
      'journal-retry-opened',
      'journal-ownership-recorded',
    ],
  );

  const retryRows = productionRestart.records.slice(preKillJournal.records.length);
  for (const row of retryRows) {
    assert.equal(row.claimId, retryClaimId);
    assert.equal(row.claimHash, recoveryClaimHash(retryClaimId));
  }

  assert.equal(productionRestart.openState.restartReadable, true);
  assert.equal(productionRestart.openState.openRows, 3);
  assert.equal(productionRestart.stagedState.restartReadable, true);
  assert.equal(productionRestart.committedState.restartReadable, false);
  assert.equal(recordsOfType(productionRestart.records, 'mutation-observed').length, 0);
  assert.equal(recordsOfType(productionRestart.records, 'journal-completed').length, 0);
  assert.equal(recordsOfType(productionRestart.records, 'recovery-state').length, 0);
  assertHashOnlyJournalRows(productionRestart.records, rawSiteValues, 'RPP-0697 production retry journal');
}

function assertOldRemoteInspection(inspection, { plan, rawSiteValues }) {
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
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0697 old-remote restart inspection');
}

function restartDurabilityEvidenceFor({
  marker,
  preKillJournal,
  afterKillJournal,
  restartedReadback,
  productionRestart,
  releaseRestartReadback,
  plan,
  checkedPath,
}) {
  const rowsBeforeKillHash = digest(preKillJournal.records);
  const rowsAfterKillHash = digest(afterKillJournal.records);
  const rowsAfterRestartHash = restartedReadback.rowsHash;
  const productionRowsHash = digest(productionRestart.records);
  const releaseReadbackRowsHash = releaseRestartReadback.rowsHash;

  const evidence = {
    source: 'RPP-0697 release-verifier process-kill restart durability',
    checkedPath,
    checkedPathHash: digest({ checkedPath }),
    writerSignal: 'SIGKILL',
    boundary: {
      name: marker.boundary,
      mutationIndex: marker.mutationIndex,
      mutationId: marker.mutationId,
      resourceKey: marker.resourceKey,
      mutationCount: marker.mutationCount,
      remoteHashBeforeMutation: marker.remoteHashBeforeMutation,
      markerHash: digest(marker),
    },
    preMutationReadback: {
      proved: rowsBeforeKillHash === rowsAfterKillHash
        && rowsBeforeKillHash === rowsAfterRestartHash
        && restartedReadback.journal.integrity.status === 'ok',
      durableRows: restartedReadback.journal.records.length,
      rowsBeforeKillHash,
      rowsAfterKillHash,
      rowsAfterRestartHash,
      openStateRestartReadable: restartedReadback.journal.openState.restartReadable,
      stagedStateRestartReadable: restartedReadback.journal.stagedState.restartReadable,
      committedStateRestartReadable: restartedReadback.journal.committedState.restartReadable,
      mutationObservedRows: recordsOfType(restartedReadback.journal.records, 'mutation-observed').length,
      completedRows: recordsOfType(restartedReadback.journal.records, 'journal-completed').length,
      recoveryStateRows: recordsOfType(restartedReadback.journal.records, 'recovery-state').length,
    },
    releaseVerifierRetryReadback: {
      rowsPreservedAfterRetry: digest(
        productionRestart.records.slice(0, preKillJournal.records.length),
      ) === rowsBeforeKillHash,
      productionRowsHash,
      releaseReadbackRowsHash,
      productionRows: productionRestart.records.length,
      releaseReadbackRows: releaseRestartReadback.journal.records.length,
      openRows: productionRestart.openState.openRows,
      latestOpenType: productionRestart.openState.latestOpenType,
      inspectionStatus: releaseRestartReadback.inspection.status,
      counts: {
        ...releaseRestartReadback.inspection.counts,
        total: plan.mutations.length,
      },
    },
  };

  assert.equal(evidence.preMutationReadback.proved, true);
  assert.equal(evidence.preMutationReadback.mutationObservedRows, 0);
  assert.equal(evidence.preMutationReadback.completedRows, 0);
  assert.equal(evidence.releaseVerifierRetryReadback.rowsPreservedAfterRetry, true);
  assert.equal(evidence.releaseVerifierRetryReadback.releaseReadbackRowsHash, productionRowsHash);
  for (const value of [
    evidence.checkedPathHash,
    evidence.boundary.remoteHashBeforeMutation,
    evidence.boundary.markerHash,
    evidence.preMutationReadback.rowsBeforeKillHash,
    evidence.preMutationReadback.rowsAfterKillHash,
    evidence.preMutationReadback.rowsAfterRestartHash,
    evidence.releaseVerifierRetryReadback.productionRowsHash,
    evidence.releaseVerifierRetryReadback.releaseReadbackRowsHash,
  ]) {
    assert.match(value, hashPattern);
  }

  return evidence;
}

function oldRemoteRecoveryFromInspection({ inspection, plan, checkedPath }) {
  return {
    source: 'RPP-0697 before-first-mutation restarted journal readback',
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
  plan,
  oldRemoteRecovery,
  restartDurability,
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
          state: 'fully-updated-remote',
          journalState: 'ok',
          checkedPath,
          restartDurability,
          counts: {
            old: 0,
            new: mutationEvents,
            blockedUnknown: 0,
            total: mutationEvents,
          },
          journal: {
            restartReadable: true,
            openState: productionInspection.journal.openState,
            stagedState: productionInspection.journal.stagedState,
            records: productionInspection.journal.records,
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
          source: 'RPP-0697 different-body conflict recovery state',
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
        restartDurability: {
          rowHash: restartDurability.preMutationReadback.rowsAfterRestartHash,
          productionRowHash: restartDurability.releaseVerifierRetryReadback.productionRowsHash,
          rowsPreservedAfterRetry:
            restartDurability.releaseVerifierRetryReadback.rowsPreservedAfterRetry,
        },
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
        applyRejected: 30,
        applyReplayed: 31,
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
  oldRemoteRecovery,
  restartDurability,
  retryClaimId,
  checkedPath,
  rawSiteValues,
}) {
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.restartDurability.checkedPath, checkedPath);
  assert.equal(releaseSummary.releaseProof.recoveryInspect.recovery.restartDurability.preMutationReadback.proved, true);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.required, checkedPath);
  assert.equal(releaseSummary.releaseProof.replayAndRetry.observed, checkedPath);
  assert.equal(
    releaseSummary.releaseProof.replayAndRetry.restartDurability.rowHash,
    restartDurability.preMutationReadback.rowsAfterRestartHash,
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
  assert.equal(proof.checks.oldState, true);
  assert.equal(proof.checks.newState, true);
  assert.equal(proof.checks.blockedState, true);
  assert.equal(proof.checks.sameKeyReplayAfterRejection, true);
  assert.equal(proof.checks.preservedRejectedRemoteEvidence, true);
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
  assert.equal(proof.partialStates.blocked.proved, true);
  assert.equal(proof.sameKeyReplayAfterRejection.sameCheckedRecoveryPath, true);
  assert.equal(proof.sameKeyReplayAfterRejection.applyStatus, 412);
  assert.equal(proof.sameKeyReplayAfterRejection.applyApplied, 0);
  assert.equal(proof.sameKeyReplayAfterRejection.mutationAppliedBeforeFailure, 0);
  assert.equal(proof.sameKeyReplayAfterRejection.applyCommitted, false);
  assert.equal(proof.preservedRejectedRemoteEvidence.proved, true);
  assert.equal(proof.manualRecoveryAuditExport.proved, true);
  assert.equal(proof.manualRecoveryAuditExport.kind, 'manual-recovery-audit-export');
  assert.equal(proof.manualRecoveryAuditExport.sameReleaseBoundary, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.hashOnly, true);
  assert.equal(proof.manualRecoveryAuditExport.targetEnvelope.rawValuesIncluded, false);
  assertNoRawSiteValues(proof, rawSiteValues, 'RPP-0697 release verifier proof');
  assertNoRawSiteValues(releaseSummary, rawSiteValues, 'RPP-0697 release verifier summary');
  assert.equal(plan.mutations.length > 0, true);
}

function releaseVerifierEvidenceFor({
  generatedCase,
  marker,
  plan,
  restartDurability,
  oldRemoteRecovery,
  releaseProof,
  checkedPath,
}) {
  const payload = {
    schemaVersion: 1,
    issue: 'RPP-0697',
    variant: 5,
    generatedCase: generatedCase.id,
    planId: plan.id,
    evidenceSource: 'release-verifier-process-kill-before-first-mutation-v5',
    evidenceScope: 'local-jsonl-process-restart-release-verifier',
    status: 'support_only',
    verdict: 'PROCESS_KILL_BEFORE_FIRST_MUTATION_RESTART_DURABLE_SUPPORT_ONLY',
    observedAt: fixedNow.toISOString(),
    checkedCommand,
    checkedRoute,
    sourceUrl,
    productionBacked: false,
    releaseEligible: false,
    releaseGate: 'NO-GO',
    rawValuesIncluded: false,
    hashOnly: true,
    storage: 'filesystem-jsonl',
    checkedPathHash: digest({ checkedPath }),
    processKillBoundary: {
      signal: 'SIGKILL',
      name: marker.boundary,
      mutationIndex: marker.mutationIndex,
      mutationCount: marker.mutationCount,
      mutationId: marker.mutationId,
      resourceKey: marker.resourceKey,
      markerHash: restartDurability.boundary.markerHash,
      remoteHashBeforeMutation: marker.remoteHashBeforeMutation,
      mutationObservedRows: restartDurability.preMutationReadback.mutationObservedRows,
      completedRows: restartDurability.preMutationReadback.completedRows,
      recoveryStateRows: restartDurability.preMutationReadback.recoveryStateRows,
    },
    restartDurability: {
      proved: restartDurability.preMutationReadback.proved,
      writerRowsPreservedAfterRetry:
        restartDurability.releaseVerifierRetryReadback.rowsPreservedAfterRetry,
      durableRows: restartDurability.preMutationReadback.durableRows,
      releaseVerifierRows: restartDurability.releaseVerifierRetryReadback.productionRows,
      rowsBeforeKillHash: restartDurability.preMutationReadback.rowsBeforeKillHash,
      rowsAfterKillHash: restartDurability.preMutationReadback.rowsAfterKillHash,
      rowsAfterRestartHash: restartDurability.preMutationReadback.rowsAfterRestartHash,
      releaseVerifierRowsHash:
        restartDurability.releaseVerifierRetryReadback.releaseReadbackRowsHash,
      openStateRestartReadable:
        restartDurability.preMutationReadback.openStateRestartReadable,
      stagedStateRestartReadable:
        restartDurability.preMutationReadback.stagedStateRestartReadable,
      committedStateRestartReadable:
        restartDurability.preMutationReadback.committedStateRestartReadable,
    },
    recoveryInspect: {
      status: oldRemoteRecovery.state,
      counts: oldRemoteRecovery.counts,
      targetEnvelope: oldRemoteRecovery.targetEnvelope,
    },
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
        old: releaseProof.partialStates.old,
        new: releaseProof.partialStates.new,
        blocked: releaseProof.partialStates.blocked,
      },
    },
    productionBackedDurableJournalProof: {
      proved: false,
      reasonCode: 'LOCAL_SANDBOX_ONLY',
      requiredBoundary: 'live-production-backed-durable-journal',
    },
    releaseMovement: {
      allowed: false,
      gates: '0/4',
      reason: 'support-only process-kill before-first-mutation restart proof; production release boundary still required',
    },
    releasePosture: 'NO-GO',
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
  rawSiteValues,
}) {
  assert.equal(evidence.issue, 'RPP-0697');
  assert.equal(evidence.variant, 5);
  assert.equal(evidence.generatedCase, generatedCase.id);
  assert.equal(evidence.evidenceSource, 'release-verifier-process-kill-before-first-mutation-v5');
  assert.equal(evidence.evidenceScope, 'local-jsonl-process-restart-release-verifier');
  assert.equal(evidence.status, 'support_only');
  assert.equal(evidence.verdict, 'PROCESS_KILL_BEFORE_FIRST_MUTATION_RESTART_DURABLE_SUPPORT_ONLY');
  assert.equal(evidence.productionBacked, false);
  assert.equal(evidence.releaseEligible, false);
  assert.equal(evidence.releaseGate, 'NO-GO');
  assert.equal(evidence.rawValuesIncluded, false);
  assert.equal(evidence.hashOnly, true);
  assert.equal(evidence.storage, 'filesystem-jsonl');
  assert.match(evidence.checkedPathHash, hashPattern);
  assert.equal(evidence.processKillBoundary.signal, 'SIGKILL');
  assert.equal(evidence.processKillBoundary.name, 'before-first-mutation');
  assert.equal(evidence.processKillBoundary.mutationIndex, 1);
  assert.equal(evidence.processKillBoundary.mutationObservedRows, 0);
  assert.equal(evidence.processKillBoundary.completedRows, 0);
  assert.equal(evidence.processKillBoundary.recoveryStateRows, 0);
  assert.equal(evidence.restartDurability.proved, true);
  assert.equal(evidence.restartDurability.writerRowsPreservedAfterRetry, true);
  assert.equal(evidence.restartDurability.openStateRestartReadable, true);
  assert.equal(evidence.restartDurability.stagedStateRestartReadable, true);
  assert.equal(evidence.restartDurability.committedStateRestartReadable, false);
  assert.equal(evidence.recoveryInspect.status, 'old-remote');
  assert.deepEqual(evidence.recoveryInspect.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
    total: plan.mutations.length,
  });
  assert.equal(evidence.recoveryInspect.targetEnvelope.hashOnly, true);
  assert.equal(evidence.releaseVerifier.gate, 'GATE-2');
  assert.equal(evidence.releaseVerifier.durableRecoveryJournalBoundary, 'release-verifier');
  assert.equal(evidence.releaseVerifier.ok, true);
  assert.equal(evidence.releaseVerifier.gateStatus, 'proven');
  assert.equal(evidence.releaseVerifier.sameReleaseBoundary, true);
  assert.equal(evidence.releaseVerifier.checks.recoveryInspectAfterRestart, true);
  assert.equal(evidence.releaseVerifier.checks.oldState, true);
  assert.equal(evidence.releaseVerifier.checks.newState, true);
  assert.equal(evidence.releaseVerifier.checks.blockedState, true);
  assert.equal(evidence.releaseVerifier.checks.sameKeyReplayAfterRejection, true);
  assert.equal(evidence.releaseVerifier.checks.preservedRejectedRemoteEvidence, true);
  assert.equal(evidence.releaseVerifier.checks.manualRecoveryAuditExport, true);
  assert.equal(evidence.releaseVerifier.partialStates.old.proved, true);
  assert.equal(evidence.productionBackedDurableJournalProof.proved, false);
  assert.equal(evidence.productionBackedDurableJournalProof.reasonCode, 'LOCAL_SANDBOX_ONLY');
  assert.deepEqual(evidence.releaseMovement, {
    allowed: false,
    gates: '0/4',
    reason: 'support-only process-kill before-first-mutation restart proof; production release boundary still required',
  });
  assert.equal(evidence.releasePosture, 'NO-GO');
  assert.equal(evidence.plannedTargets, plan.mutations.length);
  for (const field of [
    evidence.checkedPathHash,
    evidence.processKillBoundary.markerHash,
    evidence.processKillBoundary.remoteHashBeforeMutation,
    evidence.restartDurability.rowsBeforeKillHash,
    evidence.restartDurability.rowsAfterKillHash,
    evidence.restartDurability.rowsAfterRestartHash,
    evidence.restartDurability.releaseVerifierRowsHash,
  ]) {
    assert.match(field, hashPattern);
  }
  assert.match(evidence.evidenceHash, sha256EvidencePattern);

  const { evidenceHash, ...payload } = evidence;
  assert.equal(evidenceHash, `sha256:${digest(payload)}`);
  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0697 release verifier evidence');
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

test('RPP-0697 process kill before first mutation preserves durable rows through release verifier variant 5', { timeout: 30_000 }, async () => {
  for (const generatedCase of generatedBeforeFirstMutationCases) {
    await buildRestartedCrashFixture(generatedCase);
  }
});
