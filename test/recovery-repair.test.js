import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue } from '../src/resources.js';
import {
  openPlanRecoveryJournal,
  openRecoveryJournal,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
import {
  inspectRecoveryRepair,
  markRecoveryJournalRepaired,
  recoveryRepairJournalHasRepairedMarker,
  replayRecoveryRepair,
  RecoveryRepairError,
} from '../src/recovery-repair.js';

const fixedNow = new Date('2026-05-28T00:00:00.000Z');

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-recovery-repair-'));
  return path.join(dir, 'recovery.jsonl');
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 4; index++) {
    files[`file-${index}.txt`] = `base-content-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite() {
  const site = baseSite();
  for (let index = 1; index <= 4; index++) {
    site.files[`file-${index}.txt`] = `local-content-${index}`;
  }
  return site;
}

function planFor(base = baseSite(), local = localSite(), remote = baseSite()) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setResourceForTest(site, resource, value) {
  if (resource.type === 'file') {
    site.files ||= {};
    site.files[resource.path] = value?.type === 'file' ? value.content : value;
    return;
  }
  throw new Error(`Unexpected test resource type: ${resource.type}`);
}

function applyFirstMutations(site, plan, count) {
  for (const mutation of plan.mutations.slice(0, count)) {
    setResourceForTest(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
}

function openTargetJournal(filePath, plan, current) {
  const journal = openPlanRecoveryJournal({ filePath, plan, current, now: fixedNow });
  journal.close();
}

test('repair report names exact old, new, and unknown targets', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  openTargetJournal(filePath, plan, remote);

  applyFirstMutations(current, plan, 1);
  current.files['file-3.txt'] = 'operator-edited-drift';

  const report = inspectRecoveryRepair({ journalPath: filePath, plan, current });

  assert.equal(report.status, 'blocked-operator-decision-required');
  assert.deepEqual(report.counts, { old: 2, new: 1, unknown: 1, total: 4 });
  assert.deepEqual(
    report.alreadyUpdatedTargets.map((target) => target.resourceKey),
    ['file:file-1.txt'],
  );
  assert.deepEqual(
    report.rollForwardTargets.map((target) => target.resourceKey),
    ['file:file-2.txt', 'file:file-4.txt'],
  );
  assert.deepEqual(
    report.unknownTargets.map((target) => ({
      resourceKey: target.resourceKey,
      code: target.code,
      hasBefore: typeof target.beforeHash === 'string',
      hasAfter: typeof target.afterHash === 'string',
      hasObserved: typeof target.observedHash === 'string',
    })),
    [
      {
        resourceKey: 'file:file-3.txt',
        code: 'TARGET_DRIFTED_OUTSIDE_ENVELOPE',
        hasBefore: true,
        hasAfter: true,
        hasObserved: true,
      },
    ],
  );
  assert.equal(report.requiresOperatorDecision, true);
});

test('drifted repair replay fails closed until an operator decision names exact target hashes', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  openTargetJournal(filePath, plan, remote);
  current.files['file-2.txt'] = 'unexpected-live-edit';

  assert.throws(
    () => replayRecoveryRepair({ journalPath: filePath, plan, current }),
    (error) => {
      assert.ok(error instanceof RecoveryRepairError);
      assert.equal(error.code, 'RECOVERY_REPAIR_OPERATOR_DECISION_REQUIRED');
      assert.deepEqual(
        error.details.driftedTargets.map((target) => target.resourceKey),
        ['file:file-2.txt'],
      );
      assert.equal(error.details.driftedTargets[0].code, 'TARGET_DRIFTED_OUTSIDE_ENVELOPE');
      return true;
    },
  );

  const drifted = inspectRecoveryRepair({ journalPath: filePath, plan, current }).driftedTargets[0];
  assert.throws(
    () => replayRecoveryRepair({
      journalPath: filePath,
      plan,
      current,
      operatorDecision: {
        operator: 'release-manager',
        reason: 'accept inspected drift and replay after value',
        targets: [
          {
            action: 'apply-after',
            mutationId: drifted.mutationId,
            resourceKey: drifted.resourceKey,
            beforeHash: drifted.beforeHash,
            afterHash: drifted.afterHash,
            observedHash: 'stale-observed-hash',
          },
        ],
      },
    }),
    (error) => {
      assert.equal(error.code, 'RECOVERY_REPAIR_OPERATOR_DECISION_INVALID');
      assert.equal(error.details.mismatched.length, 1);
      return true;
    },
  );
});

test('incomplete target envelope cannot be marked repaired even when current matches local after state', () => {
  const filePath = tempJournalPath();
  const plan = planFor();
  const current = localSite();
  const journal = openRecoveryJournal(filePath, { truncate: true, now: fixedNow });
  journal.appendEvent('journal-opened', {
    planId: plan.id,
    state: 'opened',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {},
  });
  journal.close();

  assert.throws(
    () => markRecoveryJournalRepaired({ journalPath: filePath, plan, current, now: fixedNow }),
    (error) => {
      assert.ok(error instanceof RecoveryRepairError);
      assert.equal(error.code, 'RECOVERY_REPAIR_INCOMPLETE_JOURNAL');
      assert.equal(error.details.incompleteJournalTargets.length, 4);
      assert.deepEqual(
        error.details.incompleteJournalTargets.map((target) => target.code),
        [
          'missing-journal-record',
          'missing-journal-record',
          'missing-journal-record',
          'missing-journal-record',
        ],
      );
      return true;
    },
  );

  assert.equal(recoveryRepairJournalHasRepairedMarker(filePath), false);
  assert.equal(readRecoveryJournal(filePath).records.some((record) => record.type === 'journal-repaired'), false);
});

test('repair replay mutates only old targets and leaves already-updated targets untouched', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  openTargetJournal(filePath, plan, remote);
  applyFirstMutations(current, plan, 2);

  const writes = [];
  const result = replayRecoveryRepair({
    journalPath: filePath,
    plan,
    current,
    writeResource(site, resource, value, context) {
      writes.push({
        resourceKey: context.target.resourceKey,
        mutationId: context.mutation.id,
        repairAction: context.repairAction,
      });
      setResourceForTest(site, resource, value);
    },
  });

  assert.deepEqual(
    writes.map((write) => write.resourceKey),
    ['file:file-3.txt', 'file:file-4.txt'],
  );
  assert.deepEqual(
    result.skippedTargets.map((target) => target.resourceKey),
    ['file:file-1.txt', 'file:file-2.txt'],
  );
  assert.equal(result.appliedMutations, 2);
  assert.deepEqual(result.after.counts, { old: 0, new: 4, unknown: 0, total: 4 });
  assert.deepEqual(result.site.files, localSite().files);
  assert.notDeepEqual(current.files, localSite().files);
});

test('fully replayed repair can append a repaired marker with exact target counts', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  openTargetJournal(filePath, plan, remote);
  applyFirstMutations(current, plan, 1);

  const replayed = replayRecoveryRepair({ journalPath: filePath, plan, current });
  const repaired = markRecoveryJournalRepaired({
    journalPath: filePath,
    plan,
    current: replayed.site,
    artifactRefs: { recoveryRepair: 'artifact://repair-replay-1' },
    now: fixedNow,
    repairId: 'repair-01',
  });

  assert.equal(repaired.status, 'repaired');
  assert.equal(repaired.record.type, 'journal-repaired');
  assert.equal(repaired.record.repairId, 'repair-01');
  assert.deepEqual(repaired.record.counts, { old: 0, new: 4, unknown: 0, total: 4 });
  assert.equal(repaired.record.repairedTargets.length, 4);
  assert.equal(repaired.record.artifactRefs.recoveryRepair, 'artifact://repair-replay-1');
  assert.equal(recoveryRepairJournalHasRepairedMarker(filePath), true);
});
