import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createPushPlan } from '../src/planner.js';
import {
  assertJournalRecordHasNoRawValues,
  readRecoveryJournal,
  recoveryClaimHash,
} from '../src/recovery-journal.js';
import {
  inspectRecoveryJournal,
  RECOVERY_INSPECT_REASON_CODES,
} from '../src/recovery-inspect.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-31T13:00:00.000Z');
const proofMovementNow = new Date('2026-05-31T13:05:00.000Z');
const proofExpiresAt = new Date('2026-05-31T13:15:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;

const generatedBeforeFirstMutationCases = Object.freeze([
  {
    id: 'rpp-0657-before-first-mutation-three-v3',
    mutationCount: 3,
  },
  {
    id: 'rpp-0657-before-first-mutation-five-v3',
    mutationCount: 5,
  },
]);

function tempWorkDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0657-before-first-mutation-v3-'));
  fs.chmodSync(dir, 0o700);
  return dir;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function generatedSites(generatedCase) {
  const base = { files: {}, plugins: {}, db: {} };
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    base.files[`${generatedCase.id}-target-${index}.txt`] =
      `base-private-rpp-0657-${generatedCase.id}-${index}`;
  }

  const local = cloneJson(base);
  const remote = cloneJson(base);
  for (let index = 1; index <= generatedCase.mutationCount; index++) {
    local.files[`${generatedCase.id}-target-${index}.txt`] =
      `local-private-rpp-0657-${generatedCase.id}-${index}`;
  }

  const plan = createPushPlan({
    base,
    local,
    remote,
    now: fixedNow,
  });
  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, generatedCase.mutationCount);

  return {
    plan,
    remote,
    rawSiteValues: rawSiteValuesFor(base, local, remote),
  };
}

function rawSiteValuesFor(...sites) {
  const values = new Set([
    'base-private-rpp-0657',
    'local-private-rpp-0657',
    'outside-envelope-private-rpp-0657',
  ]);
  for (const site of sites) {
    for (const value of Object.values(site.files || {})) {
      values.add(value);
    }
  }
  return [...values];
}

function artifactRefsFor(generatedCase) {
  return {
    recoverySupport: `artifact://rpp-0657/${generatedCase.id}/local-process-kill-before-first-mutation-v3`,
    crashBoundary: `artifact://rpp-0657/${generatedCase.id}/hash-only-crash-boundary`,
    durabilityScope: `artifact://rpp-0657/${generatedCase.id}/sandbox-file-backed-only`,
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
    import {
      appendRecoveryClaimOpened,
      openRecoveryJournal,
    } from ${JSON.stringify(recoveryJournalModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};
    import { digest } from ${JSON.stringify(stableJsonModule)};

    const fixedNow = new Date('2026-05-31T13:00:00.000Z');
    const filePath = process.env.RPP0657_JOURNAL_PATH;
    const markerPath = process.env.RPP0657_MARKER_PATH;
    const plan = JSON.parse(process.env.RPP0657_PLAN);
    const remote = JSON.parse(process.env.RPP0657_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0657_ARTIFACT_REFS);
    const claimId = process.env.RPP0657_CLAIM_ID;
    const durableJournal = openRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      claimId,
    });
    appendRecoveryClaimOpened(durableJournal, {
      plan,
      current: remote,
      claimId,
      artifactRefs,
      reason: 'RPP-0657 generated before-first-mutation crash-boundary claim opened.',
    });
    durableJournal.claimOpened = true;

    try {
      applyPlan(remote, plan, {
        durableJournal,
        journalArtifactRefs: artifactRefs,
        mutateRemote: true,
        beforeMutation({ mutationIndex, mutation, remote: currentRemote }) {
          if (mutationIndex !== 1) {
            return;
          }
          const marker = {
            issue: 'RPP-0657',
            variant: 3,
            boundary: 'before-first-mutation',
            planId: plan.id,
            mutationIndex,
            mutationId: mutation.id,
            resourceKey: mutation.resourceKey,
            mutationCount: plan.mutations.length,
            remoteHashBeforeMutation: digest(currentRemote),
          };
          fs.writeFileSync(markerPath, JSON.stringify(marker) + '\\n');
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
      RPP0657_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0657_CLAIM_ID: claimId,
      RPP0657_JOURNAL_PATH: filePath,
      RPP0657_MARKER_PATH: markerPath,
      RPP0657_PLAN: JSON.stringify(plan),
      RPP0657_REMOTE_SITE: JSON.stringify(remote),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}

async function buildRestartedCrashFixture(generatedCase) {
  const workDir = tempWorkDir();
  const filePath = path.join(workDir, 'recovery.jsonl');
  const markerPath = path.join(workDir, 'before-first-mutation-marker.json');
  const {
    plan,
    remote,
    rawSiteValues,
  } = generatedSites(generatedCase);
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
      rawSiteValues,
      label: `${generatedCase.id} pre-kill journal`,
    });

    const killed = await killChildIfRunning(child, 'SIGKILL');
    assert.equal(killed.signal, 'SIGKILL');
    assert.equal(fs.existsSync(`${markerPath}.unexpected-success`), false);
    assert.equal(fs.existsSync(`${markerPath}.unexpected-error`), false);

    const restarted = readRecoveryJournal(filePath);
    assertPreMutationJournal(restarted, {
      plan,
      claimId,
      rawSiteValues,
      label: `${generatedCase.id} restarted journal`,
    });
    assert.deepEqual(restarted.records, preKillJournal.records);
    assert.equal(restarted.openState.restartReadable, true);
    assert.equal(restarted.stagedState.restartReadable, true);
    assert.equal(restarted.committedState.restartReadable, false);
    assert.equal(restarted.committedState.status, 'missing');

    const inspection = inspectRecoveryJournal({
      journal: restarted,
      plan,
      current: remote,
    });
    assertOldRemoteInspection(inspection, { plan, rawSiteValues });

    const evidence = crashBoundaryEvidenceFor({
      generatedCase,
      marker,
      journal: restarted,
      inspection,
      plan,
    });
    const movement = recoveryProofMovementForCrashBoundary({
      evidence,
      plan,
      expectedJournalRowsHash: digest(restarted.records),
      expectedBoundaryMarkerHash: digest(marker),
      now: proofMovementNow,
    });

    assert.equal(movement.ok, true);
    assert.equal(movement.moved, true);
    assert.equal(movement.reasonCode, 'CRASH_BOUNDARY_ACCEPTED');
    assert.equal(movement.mutationAdvancement.allowed, false);
    assert.equal(movement.localRecoverySupport.proved, true);
    assert.equal(movement.localRecoverySupport.durableRows, restarted.records.length);
    assert.equal(movement.localRecoverySupport.state, 'old-remote');
    assert.equal(movement.productionBackedDurableJournalProof.proved, false);
    assert.equal(movement.releasePosture, 'NO-GO');
    assert.match(movement.proofHash, hashPattern);
    assertNoRawSiteValues(evidence, rawSiteValues, `${generatedCase.id} crash-boundary evidence`);
    assertNoRawSiteValues(movement, rawSiteValues, `${generatedCase.id} proof movement`);

    return {
      filePath,
      markerPath,
      marker,
      plan,
      remote,
      rawSiteValues,
      restarted,
      inspection,
      evidence,
      movement,
    };
  } catch (error) {
    await killChildIfRunning(child).catch(() => {});
    throw new Error(`${error.message}\nchild output:\n${logs.join('')}`);
  }
}

function assertCrashBoundaryMarker(marker, { plan, remote }) {
  assert.equal(marker.issue, 'RPP-0657');
  assert.equal(marker.variant, 3);
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
      'recovery-claim-opened',
      'journal-opened',
      ...Array.from({ length: plan.mutations.length }, () => 'target-planned'),
      'apply-staged',
      'dependencies-validated',
      'apply-committing',
    ],
    `${label} must stop before the first mutation event`,
  );
  assert.equal(countRecords(journal.records, 'mutation-observed'), 0);
  assert.equal(countRecords(journal.records, 'journal-completed'), 0);
  assert.equal(countRecords(journal.records, 'recovery-state'), 0);
  assert.ok(journal.records.every((record) => record.fsync?.requested === true));

  const claimRecord = journal.records.find((record) => record.type === 'recovery-claim-opened');
  assert.ok(claimRecord);
  assert.equal(claimRecord.claimId, claimId);
  assert.equal(claimRecord.claimHash, recoveryClaimHash(claimId));
  assert.match(claimRecord.observedHash, hashPattern);

  for (const record of journal.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
    for (const field of ['observedHash', 'beforeHash', 'afterHash', 'claimHash']) {
      if (record[field] !== undefined && record[field] !== null) {
        assert.match(record[field], hashPattern, `${label} ${field} must be SHA-256-shaped`);
      }
    }
  }
  assertNoRawSiteValues(journal, rawSiteValues, label);
}

function assertOldRemoteInspection(inspection, { plan, rawSiteValues }) {
  assert.equal(inspection.status, 'old-remote');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.oldRemote);
  assert.deepEqual(inspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  assert.deepEqual(inspection.classification, {
    state: 'old-remote',
    reasonCode: RECOVERY_INSPECT_REASON_CODES.oldRemote,
    journalIntegrity: 'ok',
    durableRows: inspection.journal.records.length,
    retry: 'retry-after-revalidation',
    targetEnvelope: {
      total: plan.mutations.length,
      old: plan.mutations.length,
      new: 0,
      blockedUnknown: 0,
    },
  });
  assert.equal(inspection.targets.length, plan.mutations.length);
  for (const target of inspection.targets) {
    assert.equal(target.state, 'old');
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    assert.match(target.observedHash, hashPattern);
    assert.equal(target.observedHash, target.beforeHash);
    assert.notEqual(target.beforeHash, target.afterHash);
  }
  assertNoRawSiteValues(inspection, rawSiteValues, 'RPP-0657 old-remote inspection');
}

function crashBoundaryEvidenceFor({
  generatedCase,
  marker,
  journal,
  inspection,
  plan,
}) {
  const payload = {
    schemaVersion: 1,
    kind: 'process-kill-before-first-mutation-crash-boundary',
    issue: 'RPP-0657',
    variant: 3,
    fixtureId: generatedCase.id,
    hashOnly: true,
    rawValuesIncluded: false,
    planId: plan.id,
    expiresAt: proofExpiresAt.toISOString(),
    boundary: {
      name: marker.boundary,
      mutationIndex: marker.mutationIndex,
      mutationId: marker.mutationId,
      resourceKey: marker.resourceKey,
      mutationCount: marker.mutationCount,
      remoteHashBeforeMutation: marker.remoteHashBeforeMutation,
      markerHash: digest(marker),
    },
    journal: {
      storage: 'filesystem-jsonl',
      integrityStatus: journal.integrity.status,
      rowsHash: digest(journal.records),
      durableRows: journal.records.length,
      openRows: journal.openState.openRows,
      stagedRows: journal.stagedState.stagedRows,
      applyCommittingRows: countRecords(journal.records, 'apply-committing'),
      mutationObservedRows: countRecords(journal.records, 'mutation-observed'),
      completedRows: countRecords(journal.records, 'journal-completed'),
      recoveryStateRows: countRecords(journal.records, 'recovery-state'),
      preMutationEventsHash: digest(journal.records.map((record) => ({
        sequence: record.sequence,
        type: record.type,
      }))),
    },
    recovery: {
      status: inspection.status,
      reasonCode: inspection.reasonCode,
      restartReadable: journal.openState.restartReadable === true
        && journal.stagedState.restartReadable === true,
      counts: {
        ...inspection.counts,
        total: plan.mutations.length,
      },
    },
    targetEnvelope: {
      total: plan.mutations.length,
      old: inspection.counts.old,
      new: inspection.counts.new,
      blockedUnknown: inspection.counts.blockedUnknown,
      allTargetsAccountedFor: inspection.targets.length === plan.mutations.length,
      targets: inspection.targets.map((target) => ({
        mutationId: target.mutationId,
        resourceKey: target.resourceKey,
        state: target.state,
        beforeHash: target.beforeHash,
        afterHash: target.afterHash,
        observedHash: target.observedHash,
      })),
    },
  };

  return {
    ...payload,
    evidenceHash: digest(payload),
  };
}

function withRecomputedEvidenceHash(evidence) {
  const { evidenceHash, ...payload } = evidence;
  return {
    ...payload,
    evidenceHash: digest(payload),
  };
}

function recoveryProofMovementForCrashBoundary({
  evidence,
  plan,
  expectedJournalRowsHash,
  expectedBoundaryMarkerHash,
  now,
}) {
  const blocked = (reasonCode) => ({
    ok: false,
    moved: false,
    reasonCode,
    releasePosture: 'NO-GO',
    mutationAdvancement: {
      allowed: false,
      reason: 'Crash-boundary evidence did not prove a durable before-first-mutation restart state.',
    },
    localRecoverySupport: {
      proved: false,
    },
    productionBackedDurableJournalProof: {
      proved: false,
      reasonCode: 'LOCAL_SANDBOX_ONLY',
    },
  });

  if (!evidence) {
    return blocked('CRASH_BOUNDARY_EVIDENCE_MISSING');
  }
  if (!crashBoundaryEvidenceShapeMatches(evidence)) {
    return blocked('CRASH_BOUNDARY_EVIDENCE_MALFORMED');
  }
  if (evidence.planId !== plan.id || Date.parse(evidence.expiresAt) <= now.getTime()) {
    return blocked('CRASH_BOUNDARY_EVIDENCE_STALE');
  }
  if (
    evidence.journal.rowsHash !== expectedJournalRowsHash
    || evidence.boundary.markerHash !== expectedBoundaryMarkerHash
  ) {
    return blocked('CRASH_BOUNDARY_EVIDENCE_DRIFTED');
  }

  const { evidenceHash, ...payload } = evidence;
  if (evidenceHash !== digest(payload)) {
    return blocked('CRASH_BOUNDARY_EVIDENCE_DRIFTED');
  }
  if (!crashBoundaryEvidenceProvesOldRemoteRestart(evidence, plan)) {
    return blocked('CRASH_BOUNDARY_EVIDENCE_DRIFTED');
  }

  return {
    ok: true,
    moved: true,
    reasonCode: 'CRASH_BOUNDARY_ACCEPTED',
    releasePosture: 'NO-GO',
    proofHash: digest({
      planId: plan.id,
      evidenceHash,
      journalRowsHash: expectedJournalRowsHash,
      markerHash: expectedBoundaryMarkerHash,
    }),
    mutationAdvancement: {
      allowed: false,
      reason: 'Restart proof is old-remote only; mutation advancement still requires a fresh checked apply revalidation.',
      mutationObservedRows: evidence.journal.mutationObservedRows,
      completedRows: evidence.journal.completedRows,
    },
    localRecoverySupport: {
      proved: true,
      storage: evidence.journal.storage,
      durableRows: evidence.journal.durableRows,
      state: evidence.recovery.status,
      restartReadable: evidence.recovery.restartReadable,
      crashBoundary: evidence.boundary.name,
    },
    productionBackedDurableJournalProof: {
      proved: false,
      reasonCode: 'LOCAL_SANDBOX_ONLY',
      requiredBoundary: 'live-production-backed-durable-journal',
    },
  };
}

function crashBoundaryEvidenceShapeMatches(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return false;
  }
  if (
    evidence.schemaVersion !== 1
    || evidence.kind !== 'process-kill-before-first-mutation-crash-boundary'
    || evidence.issue !== 'RPP-0657'
    || evidence.variant !== 3
    || evidence.hashOnly !== true
    || evidence.rawValuesIncluded !== false
    || typeof evidence.planId !== 'string'
    || Number.isNaN(Date.parse(evidence.expiresAt))
    || !hashPattern.test(evidence.evidenceHash || '')
    || !hashPattern.test(evidence.boundary?.remoteHashBeforeMutation || '')
    || !hashPattern.test(evidence.boundary?.markerHash || '')
    || !hashPattern.test(evidence.journal?.rowsHash || '')
    || !hashPattern.test(evidence.journal?.preMutationEventsHash || '')
  ) {
    return false;
  }

  const targets = evidence.targetEnvelope?.targets;
  if (!Array.isArray(targets) || targets.length !== evidence.targetEnvelope?.total) {
    return false;
  }

  return targets.every((target) => (
    typeof target.mutationId === 'string'
      && typeof target.resourceKey === 'string'
      && typeof target.state === 'string'
      && hashPattern.test(target.beforeHash || '')
      && hashPattern.test(target.afterHash || '')
      && hashPattern.test(target.observedHash || '')
  ));
}

function crashBoundaryEvidenceProvesOldRemoteRestart(evidence, plan) {
  const counts = evidence.recovery?.counts || {};
  return evidence.boundary?.name === 'before-first-mutation'
    && evidence.boundary?.mutationIndex === 1
    && evidence.boundary?.mutationCount === plan.mutations.length
    && evidence.journal?.storage === 'filesystem-jsonl'
    && evidence.journal?.integrityStatus === 'ok'
    && evidence.journal?.durableRows === plan.mutations.length + 5
    && evidence.journal?.openRows === 1
    && evidence.journal?.stagedRows === 2
    && evidence.journal?.applyCommittingRows === 1
    && evidence.journal?.mutationObservedRows === 0
    && evidence.journal?.completedRows === 0
    && evidence.journal?.recoveryStateRows === 0
    && evidence.recovery?.status === 'old-remote'
    && evidence.recovery?.reasonCode === RECOVERY_INSPECT_REASON_CODES.oldRemote
    && evidence.recovery?.restartReadable === true
    && counts.old === plan.mutations.length
    && counts.new === 0
    && counts.blockedUnknown === 0
    && counts.total === plan.mutations.length
    && evidence.targetEnvelope?.total === plan.mutations.length
    && evidence.targetEnvelope?.old === plan.mutations.length
    && evidence.targetEnvelope?.new === 0
    && evidence.targetEnvelope?.blockedUnknown === 0
    && evidence.targetEnvelope?.allTargetsAccountedFor === true
    && evidence.targetEnvelope.targets.every((target) => (
      target.state === 'old'
        && target.observedHash === target.beforeHash
        && target.beforeHash !== target.afterHash
    ));
}

function countRecords(records, type) {
  return records.filter((record) => record.type === type).length;
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

test('RPP-0657 generated process kill before first mutation preserves durable rows after restart variant 3', { timeout: 30_000 }, async () => {
  for (const generatedCase of generatedBeforeFirstMutationCases) {
    await buildRestartedCrashFixture(generatedCase);
  }
});

test('RPP-0657 missing malformed stale drifted or corrupt crash-boundary evidence refuses proof movement variant 3', { timeout: 30_000 }, async () => {
  const fixture = await buildRestartedCrashFixture(generatedBeforeFirstMutationCases[0]);
  const {
    filePath,
    plan,
    remote,
    rawSiteValues,
    restarted,
    evidence,
    marker,
  } = fixture;
  const expectedJournalRowsHash = digest(restarted.records);
  const expectedBoundaryMarkerHash = digest(marker);
  const accepted = recoveryProofMovementForCrashBoundary({
    evidence,
    plan,
    expectedJournalRowsHash,
    expectedBoundaryMarkerHash,
    now: proofMovementNow,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.moved, true);

  const malformedEvidence = {
    ...evidence,
    targetEnvelope: {
      ...evidence.targetEnvelope,
      targets: evidence.targetEnvelope.targets.map((target, index) => (
        index === 0
          ? { ...target, observedHash: 'not-a-sha256-hash' }
          : target
      )),
    },
  };
  const expiredEvidence = withRecomputedEvidenceHash({
    ...evidence,
    expiresAt: new Date(proofMovementNow.getTime() - 1_000).toISOString(),
  });
  const stalePlanEvidence = withRecomputedEvidenceHash({
    ...evidence,
    planId: `${plan.id}-superseded`,
  });
  const driftedRowsEvidence = withRecomputedEvidenceHash({
    ...evidence,
    journal: {
      ...evidence.journal,
      rowsHash: 'f'.repeat(64),
    },
  });
  const driftedBoundaryEvidence = withRecomputedEvidenceHash({
    ...evidence,
    boundary: {
      ...evidence.boundary,
      markerHash: 'e'.repeat(64),
    },
  });
  const driftedStateEvidence = withRecomputedEvidenceHash({
    ...evidence,
    recovery: {
      ...evidence.recovery,
      status: 'fully-updated-remote',
      counts: {
        old: 0,
        new: plan.mutations.length,
        blockedUnknown: 0,
        total: plan.mutations.length,
      },
    },
    targetEnvelope: {
      ...evidence.targetEnvelope,
      old: 0,
      new: plan.mutations.length,
      targets: evidence.targetEnvelope.targets.map((target) => ({
        ...target,
        state: 'new',
        observedHash: target.afterHash,
      })),
    },
  });

  const corruptPath = path.join(path.dirname(filePath), 'corrupt-recovery.jsonl');
  fs.writeFileSync(corruptPath, fs.readFileSync(filePath, 'utf8').replace(/\n$/, ''));
  const corruptReadback = readRecoveryJournal(corruptPath);
  assert.equal(corruptReadback.integrity.status, 'blocked');
  assert.equal(
    corruptReadback.integrity.errors.some((error) => error.code === 'JOURNAL_TRUNCATED'),
    true,
  );
  const corruptInspection = inspectRecoveryJournal({
    journal: corruptReadback,
    plan,
    current: remote,
  });
  assert.equal(corruptInspection.status, 'blocked-recovery');
  assert.equal(corruptInspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedJournalIntegrity);
  const corruptEvidence = withRecomputedEvidenceHash({
    ...evidence,
    journal: {
      ...evidence.journal,
      integrityStatus: corruptReadback.integrity.status,
      rowsHash: digest(corruptReadback.records),
      durableRows: 0,
    },
    recovery: {
      ...evidence.recovery,
      status: corruptInspection.status,
      reasonCode: corruptInspection.reasonCode,
      restartReadable: false,
      counts: {
        ...corruptInspection.counts,
        total: plan.mutations.length,
      },
    },
  });

  const rejectionCases = [
    {
      label: 'missing',
      evidence: null,
      reasonCode: 'CRASH_BOUNDARY_EVIDENCE_MISSING',
    },
    {
      label: 'malformed',
      evidence: malformedEvidence,
      reasonCode: 'CRASH_BOUNDARY_EVIDENCE_MALFORMED',
    },
    {
      label: 'expired stale',
      evidence: expiredEvidence,
      reasonCode: 'CRASH_BOUNDARY_EVIDENCE_STALE',
    },
    {
      label: 'superseded plan',
      evidence: stalePlanEvidence,
      reasonCode: 'CRASH_BOUNDARY_EVIDENCE_STALE',
    },
    {
      label: 'drifted journal rows',
      evidence: driftedRowsEvidence,
      reasonCode: 'CRASH_BOUNDARY_EVIDENCE_DRIFTED',
    },
    {
      label: 'drifted boundary marker',
      evidence: driftedBoundaryEvidence,
      reasonCode: 'CRASH_BOUNDARY_EVIDENCE_DRIFTED',
    },
    {
      label: 'drifted recovery state',
      evidence: driftedStateEvidence,
      reasonCode: 'CRASH_BOUNDARY_EVIDENCE_DRIFTED',
    },
    {
      label: 'corrupt journal readback',
      evidence: corruptEvidence,
      reasonCode: 'CRASH_BOUNDARY_EVIDENCE_DRIFTED',
    },
  ];

  for (const rejectionCase of rejectionCases) {
    const movement = recoveryProofMovementForCrashBoundary({
      evidence: rejectionCase.evidence,
      plan,
      expectedJournalRowsHash,
      expectedBoundaryMarkerHash,
      now: proofMovementNow,
    });
    assert.equal(movement.ok, false, rejectionCase.label);
    assert.equal(movement.moved, false, rejectionCase.label);
    assert.equal(movement.reasonCode, rejectionCase.reasonCode, rejectionCase.label);
    assert.equal(movement.mutationAdvancement.allowed, false, rejectionCase.label);
    assert.equal(movement.localRecoverySupport.proved, false, rejectionCase.label);
    assert.equal(movement.productionBackedDurableJournalProof.proved, false, rejectionCase.label);
    assert.equal(movement.releasePosture, 'NO-GO', rejectionCase.label);
    assertNoRawSiteValues(movement, rawSiteValues, `RPP-0657 ${rejectionCase.label} movement`);
  }

  assertNoRawSiteValues(evidence, rawSiteValues, 'RPP-0657 accepted crash-boundary evidence');
  assertNoRawSiteValues(malformedEvidence, rawSiteValues, 'RPP-0657 malformed crash-boundary evidence');
  assertNoRawSiteValues(expiredEvidence, rawSiteValues, 'RPP-0657 stale crash-boundary evidence');
  assertNoRawSiteValues(stalePlanEvidence, rawSiteValues, 'RPP-0657 stale-plan crash-boundary evidence');
  assertNoRawSiteValues(driftedRowsEvidence, rawSiteValues, 'RPP-0657 drifted-rows crash-boundary evidence');
  assertNoRawSiteValues(driftedBoundaryEvidence, rawSiteValues, 'RPP-0657 drifted-boundary crash-boundary evidence');
  assertNoRawSiteValues(driftedStateEvidence, rawSiteValues, 'RPP-0657 drifted-state crash-boundary evidence');
  assertNoRawSiteValues(corruptEvidence, rawSiteValues, 'RPP-0657 corrupt crash-boundary evidence');
});
