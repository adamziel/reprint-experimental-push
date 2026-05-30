import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createPushPlan } from '../src/planner.js';
import {
  assertJournalRecordHasNoRawValues,
  readRecoveryJournal,
} from '../src/recovery-journal.js';
import {
  inspectRecoveryJournal,
  RECOVERY_INSPECT_REASON_CODES,
} from '../src/recovery-inspect.js';
import { deserializeResourceValue, setResource } from '../src/resources.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const rawPayloads = [
  'rpp-0612-before-payload-alpha',
  'rpp-0612-before-payload-bravo',
  'rpp-0612-before-payload-charlie',
  'rpp-0612-after-payload-alpha',
  'rpp-0612-after-payload-bravo',
  'rpp-0612-after-payload-charlie',
];

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpp-0612-blocked-recovery-'));
  return path.join(dir, 'recovery.jsonl');
}

function baseSite() {
  return {
    files: {
      'alpha.txt': rawPayloads[0],
      'bravo.txt': rawPayloads[1],
      'charlie.txt': rawPayloads[2],
    },
    plugins: {},
    db: {},
  };
}

function localSite() {
  return {
    files: {
      'alpha.txt': rawPayloads[3],
      'bravo.txt': rawPayloads[4],
      'charlie.txt': rawPayloads[5],
    },
    plugins: {},
    db: {},
  };
}

function planFor(base = baseSite(), local = localSite(), remote = baseSite()) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoRawPayloads(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const rawPayload of rawPayloads) {
    assert.equal(
      serialized.includes(rawPayload),
      false,
      `raw payload leaked into recovery evidence: ${rawPayload}`,
    );
  }
}

test('RPP-0612 blocked recovery classification survives process restart without raw payload leakage', () => {
  const filePath = tempJournalPath();
  const base = baseSite();
  const local = localSite();
  const remote = baseSite();
  const plan = planFor(base, local, remote);
  assert.equal(plan.mutations.length, 3);

  const childScript = `
    import { applyPlan } from ${JSON.stringify(new URL('../src/apply.js', import.meta.url).href)};
    import { createPushPlan } from ${JSON.stringify(new URL('../src/planner.js', import.meta.url).href)};
    import { openRecoveryJournal } from ${JSON.stringify(new URL('../src/recovery-journal.js', import.meta.url).href)};

    const fixedNow = new Date('2026-05-30T00:00:00.000Z');
    const filePath = process.env.RPP0612_JOURNAL_PATH;
    const base = JSON.parse(process.env.RPP0612_BASE_SITE);
    const local = JSON.parse(process.env.RPP0612_LOCAL_SITE);
    const remote = JSON.parse(process.env.RPP0612_REMOTE_SITE);
    const plan = createPushPlan({ base, local, remote, now: fixedNow });
    const durableJournal = openRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      claimId: 'rpp-0612-blocked-classification-writer',
    });

    try {
      applyPlan(remote, plan, {
        durableJournal,
        mutateRemote: true,
        failDuringCommitAtMutation: 1,
      });
      console.error('expected injected failure during commit');
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
      RPP0612_JOURNAL_PATH: filePath,
      RPP0612_BASE_SITE: JSON.stringify(base),
      RPP0612_LOCAL_SITE: JSON.stringify(local),
      RPP0612_REMOTE_SITE: JSON.stringify(remote),
    },
    encoding: 'utf8',
  });

  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);

  const persisted = readRecoveryJournal(filePath);
  const restartedCurrent = clone(remote);
  const committedMutation = plan.mutations[0];
  setResource(
    restartedCurrent,
    committedMutation.resource,
    deserializeResourceValue(committedMutation.value),
  );

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current: restartedCurrent,
  });

  assert.equal(persisted.integrity.status, 'ok');
  assert.equal(persisted.records.some((record) => record.type === 'mutation-observed'), true);
  assert.equal(persisted.records.some((record) => record.type === 'recovery-state'), true);
  assert.deepEqual(
    persisted.records.map((record) => record.sequence),
    Array.from({ length: persisted.records.length }, (_, index) => index + 1),
  );
  assert.ok(persisted.records.every((record) => record.fsync?.requested === true));
  for (const record of persisted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
  }

  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.reasonCode, RECOVERY_INSPECT_REASON_CODES.blockedPartialRemote);
  assert.match(inspection.reason, /partially updated/);
  assert.deepEqual(inspection.counts, { old: 2, new: 1, blockedUnknown: 0 });
  assert.deepEqual(inspection.classification, {
    state: 'blocked-recovery',
    reasonCode: RECOVERY_INSPECT_REASON_CODES.blockedPartialRemote,
    journalIntegrity: 'ok',
    durableRows: persisted.records.length,
    retry: 'blocked',
    targetEnvelope: {
      total: 3,
      old: 2,
      new: 1,
      blockedUnknown: 0,
    },
  });
  assert.deepEqual(
    inspection.targets.map((target) => [target.resourceKey, target.state]),
    [
      ['file:alpha.txt', 'new'],
      ['file:bravo.txt', 'old'],
      ['file:charlie.txt', 'old'],
    ],
  );

  assertNoRawPayloads(fs.readFileSync(filePath, 'utf8'));
  assertNoRawPayloads(persisted);
  assertNoRawPayloads(inspection);
});
