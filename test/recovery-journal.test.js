import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  appendJournalCompleted,
  appendRecoveryClaimOpened,
  appendMutationObserved,
  assertJournalRecordHasNoRawValues,
  checkedDurableJournalBoundarySatisfied,
  productionRecoveryJournalInspectionSurfaceIsPresent,
  recoveryClaimHash,
  RecoveryJournalClaimStaleError,
  consumeProductionRecoveryJournal,
  migrateRecoveryJournalSchema,
  migrateSqliteRecoveryJournalTableSchema,
  openProductionRecoveryJournal,
  openPlanRecoveryJournal,
  openRecoveryJournal,
  readRecoveryJournal,
  readRecoveryJournalPage,
  readRecoveryJournalPaged,
  readSqliteRecoveryJournalTable,
} from '../src/recovery-journal.js';
import { inspectRecoveryJournal } from '../src/recovery-inspect.js';
import {
  inspectRecoveryRepair,
  replayRecoveryRepair,
} from '../src/recovery-repair.js';
import { createPushPlan } from '../src/planner.js';
import { deserializeResourceValue, resourceHash, setResource } from '../src/resources.js';
import { digest } from '../src/stable-json.js';
import { buildDurableRecoveryJournalReleaseProof } from '../scripts/playground/production-shaped-live-release-verify-lib.js';

const fixedNow = new Date('2026-05-24T00:00:00.000Z');
let DatabaseSync = null;

try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

function tempJournalPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-recovery-journal-'));
  return path.join(dir, 'recovery.jsonl');
}

function tempSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprint-recovery-journal-sqlite-'));
  return path.join(dir, 'recovery.sqlite');
}

function baseSite() {
  const files = {};
  for (let index = 1; index <= 8; index++) {
    files[`file-${index}.txt`] = `base-private-content-${index}`;
  }
  return { files, plugins: {}, db: {} };
}

function localSite() {
  const site = baseSite();
  for (let index = 1; index <= 8; index++) {
    site.files[`file-${index}.txt`] = `local-private-content-${index}`;
  }
  return site;
}

function planFor(base = baseSite(), local = localSite(), remote = baseSite()) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyFirstMutations(site, plan, count) {
  for (const mutation of plan.mutations.slice(0, count)) {
    setResource(site, mutation.resource, deserializeResourceValue(mutation.value));
  }
}

function withoutSchemaVersion(record) {
  const { schemaVersion, ...rest } = record;
  return rest;
}

function writeLegacyJournalWithoutSchemaVersion(filePath, records) {
  const legacyRecords = records.map(withoutSchemaVersion);
  fs.writeFileSync(
    filePath,
    `${legacyRecords.map((record) => JSON.stringify(record)).join('\n')}\n`,
  );
  return legacyRecords;
}

function writeLegacySqliteJournalTable(database, records, tableName = 'recovery_journal') {
  database.exec(`CREATE TABLE ${tableName} (
    sequence INTEGER PRIMARY KEY,
    record_json TEXT NOT NULL
  )`);
  const insert = database.prepare(`INSERT INTO ${tableName} (sequence, record_json) VALUES (?, ?)`);
  const legacyRecords = records.map(withoutSchemaVersion);
  for (const record of legacyRecords) {
    insert.run(record.sequence, JSON.stringify(record));
  }
  return legacyRecords;
}

function buildRecoveryReleaseSummary({ inspection, plan, mutationEvents, oldRemoteRecovery = null }) {
  const latestEvents = [
    { sequence: 1, event: 'idempotency-opened' },
    { sequence: 2, event: 'apply-started' },
    ...Array.from({ length: mutationEvents }, (_, index) => ({
      sequence: 3 + index,
      event: 'mutation-applied',
    })),
    { sequence: 3 + mutationEvents, event: 'apply-committed' },
    { sequence: 4 + mutationEvents, event: 'apply-replayed' },
    { sequence: 5 + mutationEvents, event: 'idempotency-key-conflict' },
  ];
  return {
    topology: {
      sourceUrl: 'http://127.0.0.1:8080',
    },
    boundary: {
      verdict: 'LIVE_RELEASE_BOUNDARY_OK',
    },
    durableJournal: {
      proof: inspection,
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
        },
        targetSnapshotUnchanged: true,
      },
      dbJournal: {
        mutationApplied: mutationEvents,
        eventCounts: {
          'idempotency-key-conflict': 1,
        },
        latestEvents,
      },
      staleClaimRetry: {
        ...(oldRemoteRecovery ? { oldRemoteRecovery } : {}),
        abandoned: {
          status: 500,
          code: 'LAB_SIMULATED_STALE_CLAIM_ALL_OLD',
          ...(oldRemoteRecovery ? { recovery: oldRemoteRecovery } : {}),
        },
      },
      replayAndRetry: {
        required: '/snapshot',
        observed: '/snapshot',
        retryAttempts: 2,
        verdict: 'PRESERVED_REMOTE_RETRY_PROVEN',
      },
    },
  };
}

function buildBlockedApplyRevalidation() {
  return {
    apply: {
      status: 412,
      code: 'PRECONDITION_FAILED',
    },
    recoveryInspect: {
      recovery: {
        state: 'blocked-recovery',
        counts: {
          old: 1,
          new: 0,
          blockedUnknown: 1,
          total: 2,
        },
      },
    },
  };
}

test('file-backed journal opens or creates a missing JSONL file', () => {
  const filePath = tempJournalPath();
  const journal = openRecoveryJournal(filePath, { now: fixedNow });

  journal.appendEvent('journal-opened', {
    planId: 'plan-create-test',
    state: 'opened',
    observedHash: 'snapshot-hash-only',
    artifactRefs: {},
  });
  journal.close();

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.deepEqual(restarted.records.map((record) => record.sequence), [1]);
});

test('file-backed journal open state survives process restart readback', () => {
  const filePath = tempJournalPath();
  fs.chmodSync(path.dirname(filePath), 0o700);
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const plannerModule = new URL('../src/planner.js', import.meta.url).href;
  const childScript = `
    import { openPlanRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { createPushPlan } from ${JSON.stringify(plannerModule)};

    const fixedNow = new Date('2026-05-24T00:00:00.000Z');

    function baseSite() {
      const files = {};
      for (let index = 1; index <= 8; index++) {
        files[\`file-\${index}.txt\`] = \`base-private-content-\${index}\`;
      }
      return { files, plugins: {}, db: {} };
    }

    function localSite() {
      const site = baseSite();
      for (let index = 1; index <= 8; index++) {
        site.files[\`file-\${index}.txt\`] = \`local-private-content-\${index}\`;
      }
      return site;
    }

    const filePath = process.env.RPP0607_JOURNAL_PATH;
    const remote = baseSite();
    const plan = createPushPlan({ base: baseSite(), local: localSite(), remote, now: fixedNow });
    openPlanRecoveryJournal({
      filePath,
      plan,
      current: remote,
      now: fixedNow,
      artifactRefs: { openState: 'artifact://rpp-0607-open-state' },
    });
    process.exit(0);
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0607_JOURNAL_PATH: filePath,
    },
    encoding: 'utf8',
  });

  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.openState.status, 'opened');
  assert.equal(restarted.openState.phase, 'open');
  assert.equal(restarted.openState.restartReadable, true);
  assert.equal(restarted.openState.durableRows, plan.mutations.length + 1);
  assert.equal(restarted.openState.records, plan.mutations.length + 1);
  assert.equal(restarted.openState.openRows, 1);
  assert.equal(restarted.openState.firstOpenSequence, 1);
  assert.equal(restarted.openState.latestOpenSequence, 1);
  assert.equal(restarted.openState.latestOpenType, 'journal-opened');
  assert.equal(restarted.openState.planId, plan.id);
  assert.equal(restarted.openState.state, 'opened');
  assert.match(restarted.openState.observedHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(restarted.openState.artifactRefs, {
    openState: 'artifact://rpp-0607-open-state',
  });
  assert.deepEqual(restarted.openState.fsync, {
    requested: true,
    strategy: 'after-append',
  });
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    Array.from({ length: plan.mutations.length + 1 }, (_, index) => index + 1),
  );
  assert.equal(
    restarted.records.filter((record) => record.type === 'target-planned').length,
    plan.mutations.length,
  );
  assert.ok(restarted.records.every((record) => record.fsync.requested === true));

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current: remote,
  });
  assert.equal(inspection.status, 'old-remote');
  assert.equal(inspection.journal.openState.restartReadable, true);
});

test('file-backed journal staged state survives restart and retry preserves remote-only changes', () => {
  const filePath = tempJournalPath();
  fs.chmodSync(path.dirname(filePath), 0o700);
  const base = baseSite();
  const local = clone(base);
  const remote = clone(base);
  const plannedLocalContent = 'local-private-content-rpp-0608';
  const preservedBeforePlan = 'remote-preserved-private-content-rpp-0608-before-plan';
  const preservedAfterCrash = 'remote-preserved-private-content-rpp-0608-after-crash';
  local.files['file-1.txt'] = plannedLocalContent;
  remote.files['file-8.txt'] = preservedBeforePlan;
  const plan = planFor(base, local, remote);
  const expectedStaged = clone(remote);
  applyFirstMutations(expectedStaged, plan, plan.mutations.length);
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const plannerModule = new URL('../src/planner.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const childScript = `
    import { openRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { createPushPlan } from ${JSON.stringify(plannerModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};

    const fixedNow = new Date('2026-05-24T00:00:00.000Z');
    const filePath = process.env.RPP0608_JOURNAL_PATH;
    const base = JSON.parse(process.env.RPP0608_BASE_SITE);
    const local = JSON.parse(process.env.RPP0608_LOCAL_SITE);
    const remote = JSON.parse(process.env.RPP0608_REMOTE_SITE);
    const plan = createPushPlan({ base, local, remote, now: fixedNow });
    const durableJournal = openRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      claimId: 'rpp-0608-staged-state-first-writer',
    });

    try {
      applyPlan(remote, plan, {
        durableJournal,
        failAfterStaging: true,
        mutateRemote: true,
      });
      console.error('expected injected staging failure');
      process.exit(3);
    } catch (error) {
      if (error?.code !== 'INJECTED_FAILURE_AFTER_STAGING') {
        console.error(error?.stack || String(error));
        process.exit(2);
      }
      process.exit(0);
    }
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0608_JOURNAL_PATH: filePath,
      RPP0608_BASE_SITE: JSON.stringify(base),
      RPP0608_LOCAL_SITE: JSON.stringify(local),
      RPP0608_REMOTE_SITE: JSON.stringify(remote),
    },
    encoding: 'utf8',
  });

  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.stagedState.status, 'staged');
  assert.equal(restarted.stagedState.phase, 'staged');
  assert.equal(restarted.stagedState.restartReadable, true);
  assert.equal(restarted.stagedState.records, restarted.records.length);
  assert.equal(restarted.stagedState.durableRows, restarted.records.length);
  assert.equal(restarted.stagedState.stagedRows, 1);
  assert.equal(restarted.stagedState.targetRows, plan.mutations.length);
  assert.equal(restarted.stagedState.targetEnvelope.plannedTargets, plan.mutations.length);
  assert.equal(restarted.stagedState.targetEnvelope.allTargetsHaveHashes, true);
  assert.equal(restarted.stagedState.latestStagedType, 'apply-staged');
  assert.equal(restarted.stagedState.planId, plan.id);
  assert.equal(restarted.stagedState.state, 'staged');
  assert.equal(restarted.stagedState.observedHash, digest(remote));
  assert.equal(restarted.stagedState.stagedHash, digest(expectedStaged));
  assert.deepEqual(restarted.stagedState.fsync, {
    requested: true,
    strategy: 'after-append',
  });
  assert.deepEqual(
    restarted.records.map((record) => record.type),
    [
      'recovery-claim-opened',
      'journal-opened',
      'target-planned',
      'apply-staged',
      'recovery-state',
    ],
  );

  const retryRemote = clone(remote);
  retryRemote.files['file-7.txt'] = preservedAfterCrash;
  const restartInspection = inspectRecoveryJournal({ journal: restarted, plan, current: retryRemote });
  const repairInspection = inspectRecoveryRepair({ journalPath: filePath, plan, current: retryRemote });
  const retry = replayRecoveryRepair({
    journalPath: filePath,
    plan,
    current: retryRemote,
    mutateCurrent: true,
  });

  assert.equal(restartInspection.status, 'old-remote');
  assert.equal(restartInspection.journal.stagedState.restartReadable, true);
  assert.equal(repairInspection.status, 'old-remote-replayable');
  assert.equal(repairInspection.journal.stagedState.restartReadable, true);
  assert.equal(retry.status, 'replayed');
  assert.equal(retry.appliedMutations, plan.mutations.length);
  assert.equal(retryRemote.files['file-1.txt'], plannedLocalContent);
  assert.equal(retryRemote.files['file-8.txt'], preservedBeforePlan);
  assert.equal(retryRemote.files['file-7.txt'], preservedAfterCrash);
  assert.equal(
    fs.readFileSync(filePath, 'utf8').includes(plannedLocalContent),
    false,
  );
  assert.equal(
    fs.readFileSync(filePath, 'utf8').includes(preservedBeforePlan),
    false,
  );
  assert.equal(
    fs.readFileSync(filePath, 'utf8').includes(preservedAfterCrash),
    false,
  );
  assert.ok(restarted.records.every((record) => record.fsync.requested === true));
});

test('file-backed journal committed state survives restart and exposes lease owner identity', () => {
  const filePath = tempJournalPath();
  fs.chmodSync(path.dirname(filePath), 0o700);
  const base = baseSite();
  const local = clone(base);
  const remote = clone(base);
  const claimId = 'rpp-0609-committed-state-writer';
  local.files['file-1.txt'] = 'local-private-content-rpp-0609-committed-one';
  local.files['file-2.txt'] = 'local-private-content-rpp-0609-committed-two';
  const plan = planFor(base, local, remote);
  const expectedCommitted = clone(remote);
  applyFirstMutations(expectedCommitted, plan, 1);
  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const plannerModule = new URL('../src/planner.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const childScript = `
    import { openRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { createPushPlan } from ${JSON.stringify(plannerModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};

    const fixedNow = new Date('2026-05-24T00:00:00.000Z');
    const filePath = process.env.RPP0609_JOURNAL_PATH;
    const base = JSON.parse(process.env.RPP0609_BASE_SITE);
    const local = JSON.parse(process.env.RPP0609_LOCAL_SITE);
    const remote = JSON.parse(process.env.RPP0609_REMOTE_SITE);
    const plan = createPushPlan({ base, local, remote, now: fixedNow });
    const durableJournal = openRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      claimId: ${JSON.stringify(claimId)},
    });

    try {
      applyPlan(remote, plan, {
        durableJournal,
        failDuringCommitAtMutation: 1,
        mutateRemote: true,
      });
      console.error('expected injected commit failure');
      process.exit(3);
    } catch (error) {
      if (error?.code !== 'INJECTED_FAILURE_DURING_COMMIT') {
        console.error(error?.stack || String(error));
        process.exit(2);
      }
      process.exit(0);
    }
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0609_JOURNAL_PATH: filePath,
      RPP0609_BASE_SITE: JSON.stringify(base),
      RPP0609_LOCAL_SITE: JSON.stringify(local),
      RPP0609_REMOTE_SITE: JSON.stringify(remote),
    },
    encoding: 'utf8',
  });

  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);

  const restarted = readRecoveryJournal(filePath);
  const mutationRecord = restarted.records.find((record) => record.type === 'mutation-observed');
  assert.ok(mutationRecord);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.committedState.status, 'committed');
  assert.equal(restarted.committedState.phase, 'applied');
  assert.equal(restarted.committedState.restartReadable, true);
  assert.equal(restarted.committedState.records, restarted.records.length);
  assert.equal(restarted.committedState.durableRows, restarted.records.length);
  assert.equal(restarted.committedState.committedRows, 1);
  assert.equal(restarted.committedState.mutationRows, 1);
  assert.equal(restarted.committedState.completedRows, 0);
  assert.equal(restarted.committedState.targetRows, plan.mutations.length);
  assert.equal(restarted.committedState.committedTargetRows, 1);
  assert.equal(restarted.committedState.latestCommittedType, 'mutation-observed');
  assert.equal(restarted.committedState.latestCommittedSequence, mutationRecord.sequence);
  assert.equal(restarted.committedState.latestMutationSequence, mutationRecord.sequence);
  assert.equal(restarted.committedState.latestCompletedSequence, null);
  assert.equal(restarted.committedState.planId, plan.id);
  assert.equal(restarted.committedState.state, 'applied');
  assert.equal(restarted.committedState.observedHash, mutationRecord.observedHash);
  assert.equal(restarted.committedState.latestMutation.mutationId, plan.mutations[0].id);
  assert.equal(restarted.committedState.latestMutation.resourceKey, plan.mutations[0].resourceKey);
  assert.equal(restarted.committedState.latestMutation.afterHash, resourceHash(expectedCommitted, plan.mutations[0].resource));
  assert.equal(restarted.committedState.latestMutation.observedHash, restarted.committedState.latestMutation.afterHash);
  assert.deepEqual(restarted.committedState.targetEnvelope, {
    plannedTargets: plan.mutations.length,
    committedTargets: 1,
    allCommittedTargetsHaveHashes: true,
    allTargetsCommitted: false,
  });
  assert.deepEqual(restarted.committedState.leaseOwner, {
    visible: true,
    claimId,
    claimHash: recoveryClaimHash(claimId),
    claimKeyHash: recoveryClaimHash(claimId),
    sequence: mutationRecord.sequence,
    eventType: 'mutation-observed',
  });
  assert.deepEqual(restarted.committedState.fsync, {
    requested: true,
    strategy: 'after-append',
  });

  const restartInspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: expectedCommitted,
  });
  assert.equal(restartInspection.status, 'blocked-recovery');
  assert.match(restartInspection.reason, /partially updated/);
  assert.equal(restartInspection.counts.new, 1);
  assert.equal(restartInspection.counts.old, plan.mutations.length - 1);
  assert.equal(restartInspection.journal.committedState.leaseOwner.claimId, claimId);
  assert.equal(restartInspection.journal.committedState.leaseOwner.claimKeyHash, recoveryClaimHash(claimId));
  assert.ok(restarted.records.every((record) => record.fsync.requested === true));
});

test('file-backed journal process kill mid mutation set retry preserves remote-only changes', () => {
  const filePath = tempJournalPath();
  const remoteAfterKillPath = path.join(path.dirname(filePath), 'remote-after-kill.json');
  fs.chmodSync(path.dirname(filePath), 0o700);
  const base = baseSite();
  const local = clone(base);
  const remote = clone(base);
  const plannedContents = {
    'file-1.txt': 'local-private-content-rpp-0638-planned-one',
    'file-2.txt': 'local-private-content-rpp-0638-planned-two',
    'file-3.txt': 'local-private-content-rpp-0638-planned-three',
    'file-4.txt': 'local-private-content-rpp-0638-planned-four',
  };
  const preservedBeforePlan = 'remote-preserved-private-content-rpp-0638-before-plan';
  const preservedAfterKill = 'remote-preserved-private-content-rpp-0638-after-kill';
  for (const [fileName, content] of Object.entries(plannedContents)) {
    local.files[fileName] = content;
  }
  remote.files['file-8.txt'] = preservedBeforePlan;
  const plan = planFor(base, local, remote);
  const expectedPartial = clone(remote);
  applyFirstMutations(expectedPartial, plan, 2);

  assert.deepEqual(
    plan.mutations.map((mutation) => mutation.resourceKey),
    ['file:file-1.txt', 'file:file-2.txt', 'file:file-3.txt', 'file:file-4.txt'],
  );

  const recoveryJournalModule = new URL('../src/recovery-journal.js', import.meta.url).href;
  const plannerModule = new URL('../src/planner.js', import.meta.url).href;
  const applyModule = new URL('../src/apply.js', import.meta.url).href;
  const childScript = `
    import fs from 'node:fs';
    import path from 'node:path';
    import { openRecoveryJournal } from ${JSON.stringify(recoveryJournalModule)};
    import { createPushPlan } from ${JSON.stringify(plannerModule)};
    import { applyPlan } from ${JSON.stringify(applyModule)};

    const fixedNow = new Date('2026-05-24T00:00:00.000Z');
    const filePath = process.env.RPP0638_JOURNAL_PATH;
    const remoteAfterKillPath = process.env.RPP0638_REMOTE_AFTER_KILL_PATH;
    const base = JSON.parse(process.env.RPP0638_BASE_SITE);
    const local = JSON.parse(process.env.RPP0638_LOCAL_SITE);
    const remote = JSON.parse(process.env.RPP0638_REMOTE_SITE);
    const plan = createPushPlan({ base, local, remote, now: fixedNow });

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

    const writer = openRecoveryJournal(filePath, {
      truncate: true,
      now: fixedNow,
      claimId: 'rpp-0638-process-kill-mid-set',
    });
    let observedMutations = 0;
    const durableJournal = {
      filePath: writer.filePath,
      claimFenced: writer.claimFenced,
      claimHash: writer.claimHash,
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
          if (observedMutations === 2) {
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
      mutateRemote: true,
    });
    console.error('expected SIGKILL after the second mutation-observed row');
    process.exit(4);
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    env: {
      ...process.env,
      RPP0638_JOURNAL_PATH: filePath,
      RPP0638_REMOTE_AFTER_KILL_PATH: remoteAfterKillPath,
      RPP0638_BASE_SITE: JSON.stringify(base),
      RPP0638_LOCAL_SITE: JSON.stringify(local),
      RPP0638_REMOTE_SITE: JSON.stringify(remote),
    },
    encoding: 'utf8',
  });

  assert.equal(child.error, undefined);
  assert.equal(child.signal, 'SIGKILL', child.stderr || child.stdout);
  assert.equal(child.status, null, child.stderr || child.stdout);
  assert.equal(fs.existsSync(remoteAfterKillPath), true);

  const remoteAfterKill = JSON.parse(fs.readFileSync(remoteAfterKillPath, 'utf8'));
  assert.deepEqual(remoteAfterKill, expectedPartial);
  remoteAfterKill.files['file-7.txt'] = preservedAfterKill;

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.committedState.status, 'committed');
  assert.equal(restarted.committedState.restartReadable, true);
  assert.equal(restarted.committedState.mutationRows, 2);
  assert.equal(restarted.committedState.completedRows, 0);
  assert.equal(restarted.records.some((record) => record.type === 'journal-completed'), false);
  assert.equal(restarted.records.every((record) => record.fsync.requested === true), true);

  const restartInspection = inspectRecoveryJournal({ journal: restarted, plan, current: remoteAfterKill });
  const repairInspection = inspectRecoveryRepair({ journalPath: filePath, plan, current: remoteAfterKill });
  const writeAttempts = [];
  const retry = replayRecoveryRepair({
    journalPath: filePath,
    plan,
    current: remoteAfterKill,
    mutateCurrent: true,
    writeResource(site, resource, value, context) {
      writeAttempts.push({
        resourceKey: context.mutation.resourceKey,
        repairAction: context.repairAction,
      });
      setResource(site, resource, value);
    },
  });

  assert.equal(restartInspection.status, 'blocked-recovery');
  assert.deepEqual(restartInspection.counts, { old: 2, new: 2, blockedUnknown: 0 });
  assert.equal(restartInspection.journal.committedState.restartReadable, true);
  assert.equal(repairInspection.status, 'partial-remote-replayable');
  assert.equal(repairInspection.canRollForward, true);
  assert.equal(retry.status, 'replayed');
  assert.equal(retry.appliedMutations, 2);
  assert.deepEqual(
    retry.appliedTargets.map((target) => target.resourceKey),
    ['file:file-3.txt', 'file:file-4.txt'],
  );
  assert.deepEqual(
    retry.skippedTargets.map((target) => target.resourceKey),
    ['file:file-1.txt', 'file:file-2.txt'],
  );
  assert.deepEqual(writeAttempts, [
    { resourceKey: 'file:file-3.txt', repairAction: 'apply-after' },
    { resourceKey: 'file:file-4.txt', repairAction: 'apply-after' },
  ]);
  assert.equal(remoteAfterKill.files['file-1.txt'], plannedContents['file-1.txt']);
  assert.equal(remoteAfterKill.files['file-2.txt'], plannedContents['file-2.txt']);
  assert.equal(remoteAfterKill.files['file-3.txt'], plannedContents['file-3.txt']);
  assert.equal(remoteAfterKill.files['file-4.txt'], plannedContents['file-4.txt']);
  assert.equal(remoteAfterKill.files['file-7.txt'], preservedAfterKill);
  assert.equal(remoteAfterKill.files['file-8.txt'], preservedBeforePlan);

  const journalText = fs.readFileSync(filePath, 'utf8');
  for (const rawValue of [
    ...Object.values(plannedContents),
    preservedBeforePlan,
    preservedAfterKill,
  ]) {
    assert.equal(journalText.includes(rawValue), false);
  }
});

test('file-backed journal schema migration preserves rows and remains restart-readable', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });
  journal.close();

  const currentRows = readRecoveryJournal(filePath).records;
  const legacyRows = writeLegacyJournalWithoutSchemaVersion(filePath, currentRows);
  const legacyRead = readRecoveryJournal(filePath);

  assert.equal(legacyRead.integrity.status, 'blocked');
  assert.equal(
    legacyRead.integrity.errors.some((error) => error.code === 'JOURNAL_SCHEMA_UNSUPPORTED'),
    true,
  );

  const migration = migrateRecoveryJournalSchema(filePath);

  assert.deepEqual(migration.recordSchemaVersions, [1]);
  assert.equal(migration.schemaVersion, 1);
  assert.equal(migration.migrated, true);
  assert.equal(migration.records, legacyRows.length);
  assert.equal(migration.migratedRecords, legacyRows.length);
  assert.equal(migration.preservedRows, true);
  assert.equal(migration.restartReadable, true);
  assert.equal(migration.integrity.status, 'ok');

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    Array.from({ length: legacyRows.length }, (_, index) => index + 1),
  );
  assert.ok(restarted.records.every((record) => record.schemaVersion === 1));
  assert.deepEqual(restarted.records.map(withoutSchemaVersion), legacyRows);

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current: remote,
  });
  assert.equal(inspection.status, 'old-remote');
  assert.deepEqual(inspection.counts, { old: 8, new: 0, blockedUnknown: 0 });
});

test('SQLite-backed journal table schema migration preserves rows and remains restart-readable', {
  skip: DatabaseSync === null ? 'node:sqlite is unavailable in this Node.js runtime' : false,
}, () => {
  const sqlitePath = tempSqlitePath();
  const seedFilePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const seedJournal = openPlanRecoveryJournal({
    filePath: seedFilePath,
    plan,
    current: remote,
    now: fixedNow,
  });
  seedJournal.close();

  const currentRows = readRecoveryJournal(seedFilePath).records;
  let database = new DatabaseSync(sqlitePath);
  const legacyRows = writeLegacySqliteJournalTable(database, currentRows);
  const legacyRead = readSqliteRecoveryJournalTable(database);

  assert.equal(legacyRead.integrity.status, 'blocked');
  assert.equal(legacyRead.schemaVersionColumnPresent, false);
  assert.equal(
    legacyRead.integrity.errors.some((error) => error.code === 'JOURNAL_TABLE_SCHEMA_VERSION_MISSING'),
    true,
  );
  assert.equal(
    legacyRead.integrity.errors.some((error) => error.code === 'JOURNAL_SCHEMA_UNSUPPORTED'),
    true,
  );

  const migration = migrateSqliteRecoveryJournalTableSchema(database);

  assert.equal(migration.storage, 'sqlite');
  assert.equal(migration.tableName, 'recovery_journal');
  assert.equal(migration.schemaVersion, 1);
  assert.equal(migration.tableSchemaVersion, 1);
  assert.deepEqual(migration.tableSchemaVersions, [1]);
  assert.deepEqual(migration.recordSchemaVersions, [1]);
  assert.equal(migration.migrated, true);
  assert.equal(migration.schemaVersionColumnAdded, true);
  assert.equal(migration.records, legacyRows.length);
  assert.equal(migration.migratedRecords, legacyRows.length);
  assert.equal(migration.updatedTableRows, legacyRows.length);
  assert.equal(migration.preservedRows, true);
  assert.equal(migration.restartReadable, true);
  assert.equal(migration.integrity.status, 'ok');

  database.close();
  database = new DatabaseSync(sqlitePath);
  const restarted = readSqliteRecoveryJournalTable(database);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.schemaVersionColumnPresent, true);
  assert.deepEqual(restarted.tableSchemaVersions, [1]);
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    Array.from({ length: legacyRows.length }, (_, index) => index + 1),
  );
  assert.ok(restarted.records.every((record) => record.schemaVersion === 1));
  assert.deepEqual(restarted.records.map(withoutSchemaVersion), legacyRows);

  const tableRows = database
    .prepare('SELECT sequence, schema_version, record_json FROM recovery_journal ORDER BY sequence ASC')
    .all();
  assert.equal(tableRows.length, legacyRows.length);
  assert.ok(tableRows.every((row) => row.schema_version === 1));
  assert.ok(tableRows.every((row) => JSON.parse(row.record_json).schemaVersion === 1));

  const inspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: remote,
  });
  assert.equal(inspection.status, 'old-remote');
  assert.deepEqual(inspection.counts, { old: 8, new: 0, blockedUnknown: 0 });

  database
    .prepare('UPDATE recovery_journal SET schema_version = ? WHERE sequence = ?')
    .run(2, 1);
  const unsupported = readSqliteRecoveryJournalTable(database);
  assert.equal(unsupported.integrity.status, 'blocked');
  assert.equal(
    unsupported.integrity.errors.some((error) => error.code === 'JOURNAL_TABLE_SCHEMA_UNSUPPORTED'),
    true,
  );
  database.close();
});

test('file-backed journal appends monotonic sequences and reads after restart', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });
  const current = clone(remote);
  applyFirstMutations(current, plan, 1);

  appendMutationObserved(journal, {
    plan,
    mutation: plan.mutations[0],
    current,
    state: 'applied',
  });
  journal.close();

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.deepEqual(
    restarted.records.map((record) => record.sequence),
    Array.from({ length: 10 }, (_, index) => index + 1),
  );
  assert.ok(restarted.records.every((record) => record.fsync.requested));
});

test('file-backed journal supports paged restart readback without losing classification', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });
  applyFirstMutations(current, plan, plan.mutations.length);
  appendJournalCompleted(journal, { plan, current });
  journal.close();

  const firstPage = readRecoveryJournalPage(filePath, { offset: 0, limit: 3 });
  assert.equal(firstPage.integrity.status, 'ok');
  assert.equal(firstPage.records.length, 3);
  assert.equal(firstPage.page.totalRecords, 10);
  assert.equal(firstPage.page.nextOffset, 3);
  assert.equal(firstPage.page.hasMore, true);

  const paged = readRecoveryJournalPaged(filePath, { pageSize: 4 });
  assert.equal(paged.integrity.status, 'ok');
  assert.equal(paged.records.length, 10);
  assert.equal(paged.page.mode, 'paged-readback');
  assert.equal(paged.page.pages, 3);
  assert.deepEqual(paged.records.map((record) => record.sequence), Array.from({ length: 10 }, (_, index) => index + 1));

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    journalPageSize: 4,
    plan,
    current,
  });
  assert.equal(inspection.status, 'fully-updated-remote');
  assert.equal(inspection.journal.page.mode, 'paged-readback');
  assert.equal(inspection.journal.page.pages, 3);
});

test('file-backed journal records hashes and metadata without raw values', () => {
  const filePath = tempJournalPath();
  const plan = planFor();
  const journal = openPlanRecoveryJournal({
    filePath,
    plan,
    current: baseSite(),
    now: fixedNow,
    artifactRefs: { dryRun: 'artifact://dry-run-1' },
  });
  journal.close();

  const text = fs.readFileSync(filePath, 'utf8');
  assert.equal(text.includes('base-private-content'), false);
  assert.equal(text.includes('local-private-content'), false);

  const restarted = readRecoveryJournal(filePath);
  for (const record of restarted.records) {
    assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(record));
    assert.equal(Object.hasOwn(record, 'beforeValue'), false);
    assert.equal(Object.hasOwn(record, 'afterValue'), false);
    assert.equal(Object.hasOwn(record, 'value'), false);
  }
});

test('restart inspection classifies fail-before mutation journal as old remote', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });
  journal.close();

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current: remote,
  });

  assert.equal(inspection.status, 'old-remote');
  assert.deepEqual(inspection.counts, { old: 8, new: 0, blockedUnknown: 0 });
  assert.ok(inspection.targets.every((target) => target.state === 'old'));
});

test('restart inspection classifies fail-after-2 as blocked recovery with two new and six old', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });

  applyFirstMutations(current, plan, 2);
  for (const mutation of plan.mutations.slice(0, 2)) {
    appendMutationObserved(journal, { plan, mutation, current, state: 'applied' });
  }
  journal.close();

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current,
  });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 6, new: 2, blockedUnknown: 0 });
});

test('file-backed journal refuses completion when apply is incomplete', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });

  applyFirstMutations(current, plan, 2);
  assert.throws(
    () => appendJournalCompleted(journal, { plan, current }),
    (error) => {
      assert.equal(error.code, 'RECOVERY_JOURNAL_INCOMPLETE_APPLY');
      assert.equal(error.details.planId, plan.id);
      assert.equal(error.details.incompleteTargets.length, 6);
      assert.equal(error.details.incompleteTargets[0].resourceKey, 'file:file-3.txt');
      return true;
    },
  );
  journal.close();

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.records.some((record) => record.type === 'journal-completed'), false);

  const inspection = inspectRecoveryJournal({ journalPath: filePath, plan, current });
  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 6, new: 2, blockedUnknown: 0 });
});

test('restart inspection treats completed replay as fully updated no-op state', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });

  applyFirstMutations(current, plan, plan.mutations.length);
  appendJournalCompleted(journal, { plan, current });
  journal.close();

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current,
  });

  assert.equal(inspection.status, 'fully-updated-remote');
  assert.deepEqual(inspection.counts, { old: 0, new: 8, blockedUnknown: 0 });
});

test('restart inspection blocks when current state drifts outside before and after hashes', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = clone(remote);
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });
  journal.close();
  current.files['file-3.txt'] = 'unexpected-remote-edit';

  const inspection = inspectRecoveryJournal({
    journalPath: filePath,
    plan,
    current,
  });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.equal(inspection.counts.blockedUnknown, 1);
  assert.equal(
    inspection.targets.find((target) => target.resourceKey === 'file:file-3.txt').state,
    'blocked-unknown',
  );
});

test('restart inspection blocks missing target records instead of treating updated remote as success', () => {
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

  const inspection = inspectRecoveryJournal({ journalPath: filePath, plan, current });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 0, new: 0, blockedUnknown: 8 });
});

test('restart inspection blocks corrupt or truncated journal records', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const current = localSite();
  const journal = openPlanRecoveryJournal({ filePath, plan, current: remote, now: fixedNow });
  journal.close();
  fs.appendFileSync(filePath, '{"schemaVersion":1');

  const inspection = inspectRecoveryJournal({ journalPath: filePath, plan, current });

  assert.equal(inspection.status, 'blocked-recovery');
  assert.deepEqual(inspection.counts, { old: 0, new: 0, blockedUnknown: 8 });
  assert.equal(inspection.journal.integrity.status, 'blocked');
});

test('file-backed journal fences out stale claims on restart', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const activeClaimId = 'active-journal-claim';
  const staleClaimId = 'stale-journal-claim';

  const journal = openRecoveryJournal(filePath, { now: fixedNow, claimId: activeClaimId });
  appendRecoveryClaimOpened(journal, {
    plan,
    current: remote,
    claimId: activeClaimId,
  });
  journal.close();

  const reopened = openRecoveryJournal(filePath, {
    claimId: staleClaimId,
    now: fixedNow,
  });

  assert.throws(
    () =>
      reopened.appendEvent('journal-opened', {
        planId: plan.id,
        state: 'opened',
        observedHash: 'snapshot-hash-only',
        artifactRefs: {},
      }),
    (error) => {
      assert.ok(error instanceof RecoveryJournalClaimStaleError);
      assert.equal(error.details.staleClaimId, staleClaimId);
      assert.equal(error.details.staleClaimHash, recoveryClaimHash(staleClaimId));
      assert.equal(error.details.activeClaimId, activeClaimId);
      assert.equal(error.details.activeClaimHash, recoveryClaimHash(activeClaimId));
      assert.equal(error.details.activeClaimType, 'recovery-claim-opened');
      return true;
    },
  );

  reopened.close();
});

test('production recovery journal wrapper writes a restart-readable claim-fenced journal', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-1',
    },
    now: fixedNow,
    claimId: 'production-claim-01',
  });

  const inspection = journal.inspect();
  assert.equal(journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(journal.ownsJournal, true);
  assert.equal(journal.restartReadable, true);
  assert.equal(journal.claimId, 'production-claim-01');
  assert.deepEqual(journal.artifactRefs, {
    releaseProof: 'artifact://release-proof-1',
  });
  assert.equal(inspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(inspection.journal.ownsJournal, true);
  assert.equal(inspection.journal.claimId, 'production-claim-01');
  assert.equal(inspection.journal.claimHash, recoveryClaimHash('production-claim-01'));
  assert.equal(inspection.journal.consumed, false);
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.schemaVersion, 1);
  assert.equal(inspection.leaseFence.staleClaimRejected, false);

  journal.close();

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.records[0].type, 'journal-opened');
  assert.equal(restarted.records[0].artifactRefs.releaseProof, 'artifact://release-proof-1');
  assert.equal(restarted.records.filter((record) => record.type === 'recovery-claim-opened').length, 1);
  assert.equal(restarted.records.at(-1).type, 'recovery-claim-opened');
  assert.equal(restarted.records.at(-1).claimHash.length, 64);

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-2',
      },
      now: fixedNow,
      truncate: false,
      claimId: 'production-claim-02',
    }),
    RecoveryJournalClaimStaleError,
  );
});

test('production recovery journal claim expiry advances stale ownership and release proof stays on the same path', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const artifactRefs = {
    releaseProof: 'artifact://release-proof-claim-expiry',
  };
  const staleThresholdMs = 1_000;
  const activeClaimId = 'production-claim-expiry-active';
  const retryClaimId = 'production-claim-expiry-retry';
  const initial = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId: activeClaimId,
    claimStaleThresholdMs: staleThresholdMs,
  });
  initial.close();

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs,
      now: new Date(fixedNow.getTime() + 500),
      truncate: false,
      claimId: retryClaimId,
      claimStaleThresholdMs: staleThresholdMs,
    }),
    (error) => {
      assert.ok(error instanceof RecoveryJournalClaimStaleError);
      assert.equal(error.details.activeClaimId, activeClaimId);
      assert.equal(error.details.claimExpired, false);
      assert.equal(error.details.activeClaimAgeMs, 500);
      return true;
    },
  );

  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: new Date(fixedNow.getTime() + 5_000),
    truncate: false,
    claimId: retryClaimId,
    claimStaleThresholdMs: staleThresholdMs,
  });
  const inspection = retry.inspect();
  retry.close();

  const restarted = readRecoveryJournal(filePath);
  const advancedRecord = restarted.records.find((record) => record.type === 'stale-claim-advanced');
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(
    restarted.records.filter((record) => record.type === 'stale-claim-rejected').length,
    1,
  );
  assert.ok(advancedRecord);
  assert.equal(advancedRecord.previousClaimId, activeClaimId);
  assert.equal(advancedRecord.claimId, retryClaimId);
  assert.equal(advancedRecord.previousClaimAgeMs, 5_000);
  assert.equal(advancedRecord.staleThresholdMs, staleThresholdMs);
  assert.equal(advancedRecord.claimExpired, true);
  assert.equal(advancedRecord.previousClaimExpiresAt, '2026-05-24T00:00:01.000Z');

  assert.equal(inspection.claim.activeClaimId, retryClaimId);
  assert.equal(inspection.claim.previousClaimId, activeClaimId);
  assert.equal(inspection.claim.staleClaimRejected, true);
  assert.equal(inspection.claim.claimExpiry.expired, true);
  assert.equal(inspection.claim.claimExpiry.previousClaimExpired, true);
  assert.equal(inspection.claim.claimExpiry.staleThresholdMs, staleThresholdMs);
  assert.equal(inspection.journal.claimExpiry, inspection.claim.claimExpiry);
  assert.equal(inspection.journal.writerLease.claimHash, recoveryClaimHash(retryClaimId));
  assert.equal(inspection.journal.writerLease.claimKeyHash, recoveryClaimHash(retryClaimId));
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);

  const oldRemoteInspection = inspectRecoveryJournal({
    journal: restarted,
    plan,
    current: remote,
  });
  assert.equal(oldRemoteInspection.status, 'old-remote');
  assert.deepEqual(oldRemoteInspection.counts, {
    old: plan.mutations.length,
    new: 0,
    blockedUnknown: 0,
  });
  const oldRemoteRecovery = {
    source: 'production recovery journal restart inspection before mutation',
    status: 200,
    state: oldRemoteInspection.status,
    counts: {
      ...oldRemoteInspection.counts,
      total: plan.mutations.length,
    },
  };

  const releaseProof = buildDurableRecoveryJournalReleaseProof({
    releaseSummary: buildRecoveryReleaseSummary({
      inspection,
      plan,
      mutationEvents: plan.mutations.length,
      oldRemoteRecovery,
    }),
    applyRevalidation: buildBlockedApplyRevalidation(),
  });

  assert.equal(releaseProof.ok, true);
  assert.equal(releaseProof.gate, 'GATE-2');
  assert.equal(releaseProof.gateStatus, 'proven');
  assert.equal(releaseProof.sameReleaseBoundary, true);
  assert.equal(releaseProof.checks.claimExpiryPolicy, true);
  assert.equal(releaseProof.checks.oldState, true);
  assert.equal(releaseProof.partialStates.old.proved, true);
  assert.equal(releaseProof.partialStates.old.state, 'old-remote');
  assert.deepEqual(releaseProof.partialStates.old.counts, oldRemoteRecovery.counts);
  assert.equal(releaseProof.claimExpiryPolicy.proved, true);
  assert.equal(releaseProof.claimExpiryPolicy.previousClaimAgeMs, 5_000);
});

test('production recovery journal ownership record is durable after restart', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'production-ownership-claim-01';
  const artifactRefs = {
    releaseProof: 'artifact://release-proof-ownership',
  };
  const expectedOwnership = {
    ownsJournal: true,
    restartReadable: true,
    productionAdapter: 'filesystem-compare-rename',
    supportedSurface: 'claim-fenced-restart-readable',
  };

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId,
  });
  const initialInspection = journal.inspect();
  journal.close();

  assert.deepEqual(initialInspection.journal.ownership, expectedOwnership);
  assert.equal(initialInspection.journal.ownershipRecord.sequence, 2);
  assert.equal(initialInspection.journal.ownershipRecord.restartReadable, true);
  assert.deepEqual(initialInspection.journal.ownershipRecord.ownership, expectedOwnership);

  const restarted = readRecoveryJournal(filePath);
  const ownershipRecords = restarted.records.filter(
    (record) => record.type === 'journal-ownership-recorded',
  );

  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(ownershipRecords.length, 1);
  assert.equal(ownershipRecords[0].sequence, 2);
  assert.equal(ownershipRecords[0].planId, plan.id);
  assert.equal(ownershipRecords[0].state, 'owned');
  assert.match(ownershipRecords[0].journalIdentityHash, /^[a-f0-9]{64}$/);
  assert.equal(ownershipRecords[0].claimId, claimId);
  assert.equal(ownershipRecords[0].claimHash, recoveryClaimHash(claimId));
  assert.deepEqual(ownershipRecords[0].artifactRefs, artifactRefs);
  assert.deepEqual(ownershipRecords[0].ownership, expectedOwnership);
  assert.deepEqual(ownershipRecords[0].storageGuard, {
    boundary: 'filesystem-compare-rename',
    operation: 'append',
    outcome: 'ownership-recorded',
  });
  assert.equal(ownershipRecords[0].fsync.requested, true);
  assert.equal(ownershipRecords[0].fsync.strategy, 'after-append');
  assert.equal(JSON.stringify(ownershipRecords[0]).includes(filePath), false);
  assert.doesNotThrow(() => assertJournalRecordHasNoRawValues(ownershipRecords[0]));

  const retry = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    truncate: false,
    claimId,
  });
  const retryInspection = retry.inspect();
  retry.close();

  assert.equal(retryInspection.journal.ownershipRecord.sequence, 2);
  assert.deepEqual(retryInspection.journal.ownershipRecord.ownership, expectedOwnership);
  assert.equal(retryInspection.journal.ownershipRecord.claimId, claimId);
  assert.equal(
    retryInspection.journal.ownershipRecord.claimHash,
    recoveryClaimHash(claimId),
  );

  const afterRetry = readRecoveryJournal(filePath);
  assert.equal(afterRetry.integrity.status, 'ok');
  assert.equal(
    afterRetry.records.filter((record) => record.type === 'journal-ownership-recorded').length,
    1,
  );
  assert.ok(afterRetry.records.some((record) => record.type === 'journal-retry-opened'));
});

test('production recovery journal same-claim retry is append-only and preserves target envelope', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'production-claim-retry-01';
  const artifactRefs = {
    releaseProof: 'artifact://release-proof-retry',
  };

  const firstOpen = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId,
  });
  firstOpen.close();

  const retryOpen = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    truncate: false,
    claimId,
  });
  retryOpen.close();

  const restarted = readRecoveryJournal(filePath);
  assert.equal(restarted.integrity.status, 'ok');
  assert.equal(restarted.records.filter((record) => record.type === 'target-planned').length, plan.mutations.length);
  assert.equal(restarted.records.filter((record) => record.type === 'recovery-claim-opened').length, 1);

  const retryRecord = restarted.records.find((record) => record.type === 'journal-retry-opened');
  assert.ok(retryRecord);
  assert.equal(retryRecord.claimId, claimId);
  assert.equal(retryRecord.claimHash, recoveryClaimHash(claimId));

  const inspection = inspectRecoveryJournal({ journalPath: filePath, plan, current: remote });
  assert.equal(inspection.status, 'old-remote');
});

test('production recovery journal same-claim retry rejects target envelope drift', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const driftedPlan = clone(plan);
  driftedPlan.mutations[0].localHash = 'f'.repeat(64);
  const claimId = 'production-claim-retry-02';
  const artifactRefs = {
    releaseProof: 'artifact://release-proof-retry-drift',
  };

  const firstOpen = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs,
    now: fixedNow,
    claimId,
  });
  firstOpen.close();

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan: driftedPlan,
      current: remote,
      artifactRefs,
      now: fixedNow,
      truncate: false,
      claimId,
    }),
    (error) => {
      assert.equal(error.code, 'RECOVERY_JOURNAL_TARGET_ENVELOPE_MISMATCH');
      assert.equal(error.details.issues[0].code, 'TARGET_PLANNED_AFTER_HASH_MISMATCH');
      return true;
    },
  );
});

test('checked release path consumes the production recovery journal inspection surface', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const activeClaimId = 'production-claim-consumer-01';

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-1',
    },
    claimId: activeClaimId,
  });
  journal.close();

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-stale',
      },
      truncate: false,
      claimId: 'production-claim-consumer-stale',
    }),
    RecoveryJournalClaimStaleError,
  );

  const inspection = consumeProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-1',
    },
    claimId: activeClaimId,
  });

  assert.equal(inspection.journal.productionAdapter, 'openProductionRecoveryJournal');
  assert.equal(inspection.journal.ownsJournal, true);
  assert.equal(inspection.journal.claimId, activeClaimId);
  assert.equal(inspection.journal.claimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.journal.consumed, true);
  assert.equal(inspection.journal.consumedClaimId, activeClaimId);
  assert.equal(inspection.journal.consumedClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.journal.restartReadable, true);
  assert.equal(inspection.journal.staleClaimRejected, true);
  assert.equal(productionRecoveryJournalInspectionSurfaceIsPresent(inspection), true);
  assert.deepEqual(inspection.journal.ownership, {
    ownsJournal: true,
    restartReadable: true,
    productionAdapter: 'filesystem-compare-rename',
    supportedSurface: 'claim-fenced-restart-readable',
  });
  assert.deepEqual(inspection.journal.storageGuard, {
    boundary: 'filesystem-compare-rename',
    operation: 'update',
    outcome: 'applied',
  });
  assert.equal(inspection.journal.claim?.status, 'advanced');
  assert.equal(inspection.journal.claim?.activeClaimId, activeClaimId);
  assert.equal(inspection.journal.claim?.activeClaimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.journal.claim?.type, 'recovery-claim-opened');
  assert.equal(inspection.journal.writerLease?.strategy, 'claim-fenced-single-writer');
  assert.equal(inspection.journal.writerLease?.claimId, activeClaimId);
  assert.equal(inspection.journal.writerLease?.claimHash, recoveryClaimHash(activeClaimId));
  assert.equal(inspection.journal.writerLease?.claimKeyUnique, true);
  assert.equal(inspection.journal.writerLease?.fsyncEvidence, true);
  assert.equal(inspection.journal.writerLease?.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.journal.writerLease?.monotonicSequence, true);
  assert.equal(inspection.journal.writerLease?.restartReadable, true);
  assert.equal(inspection.journal.writerLease?.staleClaimRejected, true);
  assert.equal(inspection.journal.leaseFence?.boundary, 'filesystem-compare-rename');
  assert.equal(inspection.journal.leaseFence?.claimKeyUnique, true);
  assert.equal(inspection.journal.leaseFence?.fsyncEvidence, true);
  assert.equal(inspection.journal.leaseFence?.monotonicSequence, true);
  assert.equal(inspection.journal.leaseFence?.restartReadable, true);
  assert.equal(inspection.journal.leaseFence?.staleClaimRejected, true);
  assert.equal(inspection.journal.leaseFence?.writerLease?.claimId, activeClaimId);
  assert.equal(
    inspection.journal.leaseFence?.writerLease?.claimHash,
    recoveryClaimHash(activeClaimId),
  );
  assert.deepEqual(inspection.claim, inspection.journal.claim);
  assert.deepEqual(inspection.leaseFence, inspection.journal.leaseFence);
  assert.equal(inspection.leaseFence.storageGuard, 'filesystem-compare-rename');
  assert.equal(inspection.leaseFence.staleClaimRejected, true);
});

test('production recovery journal wrapper rejects reopened plan ids that drift from the active claim evidence', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const originalPlan = planFor(baseSite(), localSite(), remote);
  const driftedPlan = {
    ...clone(originalPlan),
    id: `${originalPlan.id}-drifted`,
  };
  const claimId = 'production-claim-plan-id-01';

  const journal = openProductionRecoveryJournal({
    filePath,
    plan: originalPlan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-plan-id',
    },
    now: fixedNow,
    claimId,
  });
  journal.close();

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan: driftedPlan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-plan-id',
      },
      now: fixedNow,
      truncate: false,
      claimId,
    }),
    /openProductionRecoveryJournal\(\) requires plan\.id to match the persisted active claim evidence when reopening a claim-fenced production recovery journal\./,
  );
});

test('production recovery journal wrapper rejects restart when the persisted active-claim plan id is missing', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'production-claim-plan-id-02';

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-plan-id-missing',
    },
    now: fixedNow,
    claimId,
  });
  journal.close();

  const persisted = readRecoveryJournal(filePath);
  const claimRecord = persisted.records.find(
    (record) => record.type === 'recovery-claim-opened' && record.claimId === claimId,
  );
  assert.ok(claimRecord);
  delete claimRecord.planId;
  fs.writeFileSync(
    filePath,
    `${persisted.records.map((record) => JSON.stringify(record)).join('\n')}\n`,
  );

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-plan-id-missing',
      },
      now: fixedNow,
      truncate: false,
      claimId,
    }),
    /openProductionRecoveryJournal\(\) requires plan\.id to match the persisted active claim evidence when reopening a claim-fenced production recovery journal\./,
  );
});

test('production recovery journal wrapper rejects hidden open options', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);

  assert.throws(
    () => openProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-1',
      },
      claimId: 'production-claim-01',
      claim: {
        id: 'shadow-claim',
      },
    }),
    /openProductionRecoveryJournal\(\) received unsupported option keys: claim/,
  );

  assert.equal(fs.existsSync(filePath), false);
});

test('production recovery journal consumer rejects hidden open options', () => {
  const filePath = tempJournalPath();
  const remote = baseSite();
  const plan = planFor(baseSite(), localSite(), remote);
  const claimId = 'production-claim-consumer-01';

  const journal = openProductionRecoveryJournal({
    filePath,
    plan,
    current: remote,
    artifactRefs: {
      releaseProof: 'artifact://release-proof-1',
    },
    claimId,
  });
  journal.close();

  assert.throws(
    () => consumeProductionRecoveryJournal({
      filePath,
      plan,
      current: remote,
      artifactRefs: {
        releaseProof: 'artifact://release-proof-1',
      },
      claimId,
      truncate: false,
    }),
    /consumeProductionRecoveryJournal\(\) received unsupported option keys: truncate/,
  );
});

test('checked durable journal boundary stays closed until stale-claim rejection is proven on the lease fence', () => {
  const activeClaimId = 'retry-claim-id-02';
  const previousClaimId = 'retry-claim-id-01';
  const activeClaimKeyHash = 'a'.repeat(64);
  const previousClaimKeyHash = 'b'.repeat(64);
  const baseContract = {
    scope: 'checked live production-shaped journal surface; not local Playground fixture only',
    latestRows: [
      {
        sequence: 20,
        event: 'stale-claim-rejected',
        claimId: activeClaimId,
      },
      {
        sequence: 18,
        event: 'stale-claim-abandoned',
        claimId: previousClaimId,
      },
    ],
    claim: {
      status: 'stale-claim-rejected',
      activeClaimId,
      activeClaimKeyHash,
      activeClaimSequence: 20,
      activeClaimEvent: 'stale-claim-rejected',
      idempotencyKeyHash: 'idempotency-hash-01',
      requestHash: 'request-hash-01',
      staleClaimRejected: true,
      previousClaimId,
      previousClaimKeyHash,
      previousClaimSequence: 11,
      previousClaimEvent: 'idempotency-opened',
      previousStartedSequence: null,
      abandonedSequence: 18,
      abandonedEvent: 'stale-claim-abandoned',
    },
    storageGuard: {
      boundary: 'wpdb-single-statement-cas',
      operation: 'update',
      outcome: 'applied',
    },
    ownership: {
      ownsJournal: true,
      restartReadable: true,
      productionAdapter: 'wpdb-single-statement-cas',
      supportedSurface: 'claim-fenced-restart-readable',
    },
    writerLease: {
      strategy: 'claim-fenced-single-writer',
      claimId: activeClaimId,
      claimKeyHash: activeClaimKeyHash,
      claimKeyUnique: true,
      fsyncEvidence: true,
      storageGuard: 'wpdb-single-statement-cas',
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: true,
    },
    leaseFence: {
      boundary: 'wpdb-single-statement-cas',
      storageGuard: 'wpdb-single-statement-cas',
      fsyncEvidence: true,
      claimKeyUnique: true,
      monotonicSequence: true,
      restartReadable: true,
      staleClaimRejected: false,
      writerLease: {
        strategy: 'claim-fenced-single-writer',
        claimId: activeClaimId,
        claimKeyHash: activeClaimKeyHash,
        claimKeyUnique: true,
        fsyncEvidence: true,
        storageGuard: 'wpdb-single-statement-cas',
        monotonicSequence: true,
        restartReadable: true,
        staleClaimRejected: true,
      },
    },
  };

  assert.equal(checkedDurableJournalBoundarySatisfied(baseContract), false);
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    true,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        previousClaimId: null,
        previousClaimKeyHash: null,
        previousClaimSequence: null,
        previousClaimEvent: null,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        staleClaimRejected: false,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        status: 'active',
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        activeClaimEvent: 'idempotency-opened',
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      claim: {
        ...baseContract.claim,
        activeClaimId: '',
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  const inheritedClaimMarkers = {
    ...baseContract,
    claim: Object.assign(
      Object.create({
        activeClaimId: baseContract.claim.activeClaimId,
        activeClaimKeyHash: baseContract.claim.activeClaimKeyHash,
        activeClaimSequence: baseContract.claim.activeClaimSequence,
        activeClaimEvent: baseContract.claim.activeClaimEvent,
      }),
      baseContract.claim,
    ),
    leaseFence: {
      ...baseContract.leaseFence,
      staleClaimRejected: true,
    },
  };
  delete inheritedClaimMarkers.claim.activeClaimId;
  delete inheritedClaimMarkers.claim.activeClaimKeyHash;
  delete inheritedClaimMarkers.claim.activeClaimSequence;
  delete inheritedClaimMarkers.claim.activeClaimEvent;
  assert.equal(
    checkedDurableJournalBoundarySatisfied(inheritedClaimMarkers),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      writerLease: {
        ...baseContract.writerLease,
        claimId: 'unexpected-claim-id',
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      writerLease: {
        ...baseContract.writerLease,
        claimKeyHash: 'unexpected-claim-key-hash',
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          claimId: 'unexpected-claim-id',
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          claimKeyHash: 'unexpected-claim-key-hash',
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      writerLease: {
        ...baseContract.writerLease,
        fsyncEvidence: false,
      },
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        writerLease: {
          ...baseContract.leaseFence.writerLease,
          storageGuard: 'filesystem-compare-rename',
        },
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      scope: 'checked live production-shaped recovery journal surface; not local Playground fixture only',
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
        storageGuard: undefined,
      },
    }),
    false,
  );
  assert.equal(
    checkedDurableJournalBoundarySatisfied({
      ...baseContract,
      scope: 'checked live production-shaped recovery journal surface; not local Playground fixture only',
      storageGuard: undefined,
      leaseFence: {
        ...baseContract.leaseFence,
        staleClaimRejected: true,
      },
    }),
    true,
  );
});
