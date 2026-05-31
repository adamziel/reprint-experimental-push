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

const fixedNow = new Date('2026-05-31T12:00:00.000Z');
const hashPattern = /^[a-f0-9]{64}$/;
const rawPayloads = [
  'rpp-0672-base-private-alpha',
  'rpp-0672-base-private-bravo',
  'rpp-0672-base-private-charlie',
  'rpp-0672-base-private-delta',
  'rpp-0672-local-private-alpha',
  'rpp-0672-local-private-bravo',
  'rpp-0672-local-private-charlie',
  'rpp-0672-local-private-delta',
];

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0672-blocked-v4-'));
  return path.join(dir, 'recovery.jsonl');
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseSite() {
  return {
    files: {
      'rpp-0672-alpha.txt': rawPayloads[0],
      'rpp-0672-bravo.txt': rawPayloads[1],
      'rpp-0672-charlie.txt': rawPayloads[2],
      'rpp-0672-delta.txt': rawPayloads[3],
    },
    plugins: {},
    db: {},
  };
}

function localSite(base = baseSite()) {
  const site = cloneJson(base);
  site.files['rpp-0672-alpha.txt'] = rawPayloads[4];
  site.files['rpp-0672-bravo.txt'] = rawPayloads[5];
  site.files['rpp-0672-charlie.txt'] = rawPayloads[6];
  site.files['rpp-0672-delta.txt'] = rawPayloads[7];
  return site;
}

function buildScenario() {
  const base = baseSite();
  const local = localSite(base);
  const remote = cloneJson(base);
  const plan = createPushPlan({ base, local, remote, now: fixedNow });

  assert.equal(plan.status, 'ready');
  assert.equal(plan.mutations.length, 4);

  return { base, local, remote, plan };
}

function applyFirstMutations(site, plan, count) {
  for (const mutation of plan.mutations.slice(0, count)) {
    setResource(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
}

function assertNoRawPayloads(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  for (const rawPayload of rawPayloads) {
    assert.equal(
      serialized.includes(rawPayload),
      false,
      `RPP-0672 hash-only recovery evidence leaked raw payload: ${rawPayload}`,
    );
  }
}

function assertHashOnlyJournal(journal) {
  assert.equal(journal.integrity.status, 'ok');
  assert.deepEqual(
    journal.records.map((record) => record.sequence),
    Array.from({ length: journal.records.length }, (_, index) => index + 1),
  );
  assert.ok(journal.records.every((record) => record.fsync?.requested === true));
  for (const record of journal.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }
  assertNoRawPayloads(journal);
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
  assert.equal(retryRows[0].claimId, retryClaimId);
  assert.equal(retryRows[0].claimHash, recoveryClaimHash(retryClaimId));
  assert.equal(retryRows[1].claimId, retryClaimId);
  assert.equal(retryRows[1].claimHash, recoveryClaimHash(retryClaimId));
  assert.equal(retryRows[2].claimId, retryClaimId);
  assert.equal(retryRows[2].claimHash, recoveryClaimHash(retryClaimId));
}

function assertProductionInspection(inspection, { filePath }) {
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.equal(inspection.claim.status, 'advanced');
  assert.equal(inspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.ownership.restartReadable, true);
  assert.equal(inspection.journal.leaseFence.restartReadable, true);
  assert.deepEqual(inspection.journal.checked, [filePath]);
  assertNoRawPayloads(inspection);
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

    const fixedNow = new Date('2026-05-31T12:00:00.000Z');
    const filePath = process.env.RPP0672_JOURNAL_PATH;
    const base = JSON.parse(process.env.RPP0672_BASE_SITE);
    const local = JSON.parse(process.env.RPP0672_LOCAL_SITE);
    const remote = JSON.parse(process.env.RPP0672_REMOTE_SITE);
    const artifactRefs = JSON.parse(process.env.RPP0672_ARTIFACT_REFS);
    const claimStaleThresholdMs = Number(process.env.RPP0672_STALE_THRESHOLD_MS);
    const plan = createPushPlan({ base, local, remote, now: fixedNow });
    const durableJournal = openRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      claimId: process.env.RPP0672_ACTIVE_CLAIM_ID,
      claimStaleThresholdMs,
    });
    appendRecoveryClaimOpened(durableJournal, {
      plan,
      current: remote,
      claimId: process.env.RPP0672_ACTIVE_CLAIM_ID,
      staleThresholdMs: claimStaleThresholdMs,
      artifactRefs,
      reason: 'RPP-0672 generated blocked recovery writer claim opened.',
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
      RPP0672_JOURNAL_PATH: filePath,
      RPP0672_BASE_SITE: JSON.stringify(base),
      RPP0672_LOCAL_SITE: JSON.stringify(local),
      RPP0672_REMOTE_SITE: JSON.stringify(remote),
      RPP0672_ARTIFACT_REFS: JSON.stringify(artifactRefs),
      RPP0672_ACTIVE_CLAIM_ID: activeClaimId,
      RPP0672_STALE_THRESHOLD_MS: String(claimStaleThresholdMs),
    },
    encoding: 'utf8',
  });

  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
}

test('RPP-0672 blocked recovery classification variant 4 keeps journal rows durable after process restart', () => {
  const filePath = tempJournalPath();
  const { base, local, remote, plan } = buildScenario();
  const activeClaimId = 'rpp-0672-blocked-active-claim';
  const retryClaimId = 'rpp-0672-blocked-restart-readback';
  const claimStaleThresholdMs = 2_000;
  const artifactRefs = {
    releaseProof: 'artifact://rpp-0672-blocked-recovery-v4-release-proof',
    recoverySupport: 'artifact://rpp-0672-blocked-recovery-v4-support',
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
  assertHashOnlyJournal(writerRestart);
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

  assertProductionInspection(productionInspection, { filePath });

  const productionRestart = readRecoveryJournal(filePath);
  assertHashOnlyJournal(productionRestart);
  assertProductionRetryPreservedRows({
    writerRestart,
    productionRestart,
    retryClaimId,
  });

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current: partialRemote,
  });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedPartialRemote);
  assert.match(inspection.reason, /partially updated/);
  assert.deepEqual(inspection.counts, {
    old: 2,
    new: 2,
    blockedUnknown: 0,
  });
  assert.deepEqual(inspection.classification, {
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
    inspection.targets.map((target) => [target.resourceKey, target.state]),
    [
      ['file:rpp-0672-alpha.txt', 'new'],
      ['file:rpp-0672-bravo.txt', 'new'],
      ['file:rpp-0672-charlie.txt', 'old'],
      ['file:rpp-0672-delta.txt', 'old'],
    ],
  );
  for (const target of inspection.targets) {
    assert.match(target.beforeHash, hashPattern);
    assert.match(target.afterHash, hashPattern);
    assert.match(target.observedHash, hashPattern);
  }

  assert.equal(inspection.journal.records.length, productionRestart.records.length);
  assert.equal(inspection.journal.committedState.restartReadable, true);
  assert.equal(inspection.journal.committedState.targetEnvelope.committedTargets, 2);
  assert.equal(inspection.journal.committedState.targetEnvelope.allTargetsCommitted, false);
  assertNoRawPayloads(fs.readFileSync(filePath, 'utf8'));
  assertNoRawPayloads(productionInspection);
  assertNoRawPayloads(productionRestart);
  assertNoRawPayloads(inspection);
});
