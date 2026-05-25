#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyPlan } from '../../src/apply.js';
import { createPushPlan } from '../../src/planner.js';
import { setResource } from '../../src/resources.js';
import { digest } from '../../src/stable-json.js';
import {
  appendJournalCompleted,
  appendMutationObserved,
  openPlanRecoveryJournal,
  readRecoveryJournal,
} from '../../src/recovery-journal.js';
import { inspectRecoveryJournal } from '../../src/recovery-inspect.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inspectModulePath = path.join(repoRoot, 'src/recovery-inspect.js');
const fixedNow = new Date('2026-05-24T00:00:00.000Z');
const tmpRoot = path.join(repoRoot, '.tmp');
fs.mkdirSync(tmpRoot, { recursive: true });

const workDir = fs.mkdtempSync(path.join(tmpRoot, 'recovery-file-journal-'));
const fixture = buildFixture();
const plan = createPushPlan({
  base: fixture.base,
  local: fixture.local,
  remote: fixture.base,
  now: fixedNow,
});

assert.equal(plan.status, 'ready');
assert.equal(plan.mutations.length, 8, 'restart smoke fixture must keep eight target mutations');

const fixturePaths = writeFixtureSnapshots(workDir, fixture, plan);
const summary = {
  workDir: path.relative(repoRoot, workDir),
  fixtures: Object.fromEntries(
    Object.entries(fixturePaths).map(([name, filePath]) => [name, path.relative(repoRoot, filePath)]),
  ),
  plan: {
    id: plan.id,
    mutations: plan.mutations.length,
    planHash: digest(plan),
  },
  scenarios: {},
};

summary.scenarios.failBeforeMutation = await scenarioFailBeforeMutation();
summary.scenarios.failAfter2 = await scenarioFailAfter2();
summary.scenarios.retryAfterPartial = summary.scenarios.failAfter2.retry;
summary.scenarios.completedReplay = await scenarioCompletedReplay();
summary.scenarios.drift = await scenarioDrift();
summary.journal = assertJournalFiles();
summary.leaseFence = {
  storageGuard: 'filesystem-compare-rename',
  fsyncEvidence: true,
  monotonicSequence: true,
};

console.log(JSON.stringify(summary, null, 2));

async function scenarioFailBeforeMutation() {
  const journalPath = path.join(workDir, 'fail-before-mutation.journal.jsonl');
  const remote = clone(fixture.base);
  const before = digest(remote);
  const journal = openPlanRecoveryJournal({
    filePath: journalPath,
    plan,
    current: remote,
    now: fixedNow,
  });

  const failure = captureApply(() => applyPlan(remote, plan, { failBeforeMutation: true }));
  journal.close();

  assert.notEqual(failure.ok, true, 'fail-before-mutation must fail');
  assert.equal(digest(remote), before, 'fail-before-mutation must not mutate remote');

  const restarted = await inspectRestarted({
    name: 'inspect fail-before-mutation',
    remote,
    journalPath,
  });
  assertRecoveryCounts(restarted, {
    state: 'old-remote',
    old: 8,
    new: 0,
    blockedUnknown: 0,
  });

  return {
    journal: path.relative(repoRoot, journalPath),
    failureCode: failure.code,
    recovery: recoveryCounts(restarted),
  };
}

async function scenarioFailAfter2() {
  const journalPath = path.join(workDir, 'fail-after-2.journal.jsonl');
  const remote = clone(fixture.base);
  const journal = openPlanRecoveryJournal({
    filePath: journalPath,
    plan,
    current: remote,
    now: fixedNow,
  });

  const failure = captureApply(() =>
    applyPlan(remote, plan, { mutateRemote: true, failDuringCommitAtMutation: 2 }));
  for (const mutation of plan.mutations.slice(0, 2)) {
    appendMutationObserved(journal, {
      plan,
      mutation,
      current: remote,
      state: 'applied',
    });
  }
  journal.close();

  assert.notEqual(failure.ok, true, 'fail-after-2 must fail');
  const restarted = await inspectRestarted({
    name: 'inspect fail-after-2',
    remote,
    journalPath,
  });
  assertRecoveryCounts(restarted, {
    state: 'blocked-recovery',
    old: 6,
    new: 2,
    blockedUnknown: 0,
  });

  const beforeRetry = digest(remote);
  const retry = captureApply(() => applyPlan(remote, plan));
  assert.notEqual(retry.ok, true, 'retry after partial state must refuse');
  assert.equal(digest(remote), beforeRetry, 'retry after partial state must not mutate remote');

  const retryInspect = await inspectRestarted({
    name: 'inspect after refused retry',
    remote,
    journalPath,
  });
  assertRecoveryCounts(retryInspect, {
    state: 'blocked-recovery',
    old: 6,
    new: 2,
    blockedUnknown: 0,
  });

  return {
    journal: path.relative(repoRoot, journalPath),
    failureCode: failure.code,
    recovery: recoveryCounts(restarted),
    retry: {
      code: retry.code,
      recovery: recoveryCounts(retryInspect),
    },
  };
}

async function scenarioCompletedReplay() {
  const journalPath = path.join(workDir, 'completed-replay.journal.jsonl');
  const remote = clone(fixture.base);
  const journal = openPlanRecoveryJournal({
    filePath: journalPath,
    plan,
    current: remote,
    now: fixedNow,
  });
  const result = applyPlan(remote, plan, { mutateRemote: true });
  appendJournalCompleted(journal, {
    plan,
    current: remote,
  });
  journal.close();

  const applied = normalizedAppliedMutations(result);
  assert.equal(applied, 8, 'initial completed apply should apply all fixture mutations');

  const replay = applyPlan(remote, plan, { journal: result.journal });
  const replayApplied = normalizedAppliedMutations(replay);
  assert.equal(replayApplied, 0, 'completed replay must not apply additional mutations');

  const restarted = await inspectRestarted({
    name: 'inspect completed journal replay',
    remote,
    journalPath,
  });
  const replayRecovery = normalizeRecovery(restarted);
  assert.ok(
    ['fully-updated-remote', 'already-committed'].includes(replayRecovery.state),
    `completed replay must report fully updated or already committed, got ${replayRecovery.state}`,
  );

  return {
    journal: path.relative(repoRoot, journalPath),
    initialApplied: applied,
    replayApplied,
    state: replayRecovery.state,
  };
}

async function scenarioDrift() {
  const journalPath = path.join(workDir, 'drift.journal.jsonl');
  const remote = clone(fixture.base);
  const journal = openPlanRecoveryJournal({
    filePath: journalPath,
    plan,
    current: remote,
    now: fixedNow,
  });
  applyPlan(remote, plan, { mutateRemote: true });
  appendJournalCompleted(journal, {
    plan,
    current: remote,
  });
  journal.close();

  setResource(remote, plan.mutations[0].resource, { type: 'file', content: 'DRIFTED OUTSIDE JOURNAL ENVELOPE' });
  const restarted = await inspectRestarted({
    name: 'inspect drift',
    remote,
    journalPath,
  });
  assert.equal(normalizeRecovery(restarted).state, 'blocked-recovery');
  assert.ok(
    normalizeRecovery(restarted).counts.blockedUnknown > 0,
    'drift outside before/after hashes must report blockedUnknown > 0',
  );

  return {
    journal: path.relative(repoRoot, journalPath),
    recovery: recoveryCounts(restarted),
  };
}

function captureApply(fn) {
  try {
    const result = fn();
    return {
      ok: result?.ok ?? true,
      code: result?.code || null,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      code: error.code || error.cause?.code || error.details?.code || error.name,
      error,
      recovery: error.details?.recovery || error.recovery,
    };
  }
}

async function inspectRestarted({ name, remote, journalPath }) {
  const mod = await import(`${pathToFileURL(inspectModulePath).href}?restart=${name}-${Date.now()}`);
  const inspect = mod.inspectRecoveryJournal || inspectRecoveryJournal;
  assert.equal(typeof inspect, 'function', `${name}: restarted inspect export missing`);

  const result = inspect({
    plan,
    current: remote,
    journal: readRecoveryJournal(journalPath),
  });
  normalizeRecovery(result);
  return result;
}

function assertRecoveryCounts(result, expected) {
  const recovery = normalizeRecovery(result);
  assert.equal(recovery.state, expected.state);
  assert.equal(recovery.counts.old, expected.old);
  assert.equal(recovery.counts.new, expected.new);
  assert.equal(recovery.counts.blockedUnknown, expected.blockedUnknown);
  assert.equal(recovery.counts.total, plan.mutations.length);
}

function normalizeRecovery(result) {
  const recovery = result?.recovery || result?.recoveryState || result;
  const state = recovery?.state || recovery?.status;
  const targets = recovery?.targets || recovery?.targetStates || [];
  const counts = recovery?.counts
    ? { ...recovery.counts, total: recovery.counts.total ?? targets.length }
    : countTargets(targets);

  assert.ok(state, 'recovery state/status missing');
  assert.equal(typeof counts.old, 'number', 'recovery old count missing');
  assert.equal(typeof counts.new, 'number', 'recovery new count missing');
  assert.equal(typeof counts.blockedUnknown, 'number', 'recovery blockedUnknown count missing');
  assert.equal(counts.total, plan.mutations.length, 'recovery total count mismatch');

  return {
    state,
    counts,
    targets,
  };
}

function countTargets(targets) {
  const counts = {
    old: 0,
    new: 0,
    blockedUnknown: 0,
    total: targets.length,
  };

  for (const target of targets) {
    const classification = target.classification || target.state || target.status;
    if (classification === 'old') {
      counts.old += 1;
    } else if (classification === 'new') {
      counts.new += 1;
    } else if (classification === 'blocked-unknown' || classification === 'blockedUnknown') {
      counts.blockedUnknown += 1;
    }
  }

  return counts;
}

function normalizedAppliedMutations(result) {
  if (typeof result?.appliedMutations === 'number') {
    return result.appliedMutations;
  }
  if (typeof result?.applied === 'number') {
    return result.applied;
  }
  if (Array.isArray(result?.appliedMutationIds)) {
    return result.appliedMutationIds.length;
  }
  return 0;
}

function recoveryCounts(result) {
  const recovery = normalizeRecovery(result);
  return {
    state: recovery.state,
    old: recovery.counts.old,
    new: recovery.counts.new,
    blockedUnknown: recovery.counts.blockedUnknown,
    total: recovery.counts.total,
  };
}

function assertJournalFiles() {
  const journalFiles = fs.readdirSync(workDir)
    .filter((name) => name.endsWith('.journal.jsonl'))
    .map((name) => path.join(workDir, name))
    .sort();
  assert.ok(journalFiles.length >= 4, 'expected isolated JSONL journal files');

  const checked = [];
  for (const journalFile of journalFiles) {
    const entries = readRecoveryJournal(journalFile).records;
    assert.ok(entries.length > 0, `${path.basename(journalFile)} must contain events`);
    assertMonotonicSequence(entries, journalFile);
    assertFsyncEvidence(entries, journalFile);
    assertNoRawFixtureData(entries, journalFile);
    checked.push({
      file: path.relative(repoRoot, journalFile),
      entries: entries.length,
    });
  }

  return { checked };
}

function assertMonotonicSequence(entries, journalFile) {
  let previous = 0;
  for (const entry of entries) {
    assert.equal(typeof entry.sequence, 'number', `${path.basename(journalFile)} entry missing numeric sequence`);
    assert.ok(entry.sequence > previous, `${path.basename(journalFile)} sequence must be monotonic`);
    previous = entry.sequence;
  }
}

function assertFsyncEvidence(entries, journalFile) {
  for (const entry of entries) {
    assert.ok(
      hasFsyncEvidence(entry),
      `${path.basename(journalFile)} sequence ${entry.sequence ?? '?'} missing fsync evidence`,
    );
  }
}

function hasFsyncEvidence(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/fsync/i.test(key) && child) {
      return true;
    }
    if (child && typeof child === 'object' && hasFsyncEvidence(child)) {
      return true;
    }
  }
  return false;
}

function assertNoRawFixtureData(entries, journalFile) {
  const forbiddenKeys = new Set([
    'value',
    'content',
    'payload',
    'post_content',
    'option_value',
    'meta_value',
  ]);
  const forbiddenStrings = [
    'LOCAL_INDEX_SECRET_VALUE',
    'LOCAL_STYLE_SECRET_VALUE',
    'LOCAL_PLUGIN_SECRET_VALUE',
    'LOCAL_BLOGNAME_SECRET_VALUE',
    'LOCAL_FORMS_SECRET_VALUE',
    'LOCAL_POST_CONTENT_SECRET_VALUE',
    'LOCAL_META_SECRET_VALUE',
    'LOCAL_SITEURL_SECRET_VALUE',
  ];

  walk(entries, (key, value) => {
    assert.ok(!forbiddenKeys.has(key), `${path.basename(journalFile)} leaked raw key ${key}`);
    if (typeof value === 'string') {
      for (const forbidden of forbiddenStrings) {
        assert.ok(
          !value.includes(forbidden),
          `${path.basename(journalFile)} leaked raw fixture string ${forbidden}`,
        );
      }
    }
  });
}

function writeFixtureSnapshots(dir, { base, local }, readyPlan) {
  const files = {
    base: path.join(dir, 'base.snapshot.json'),
    local: path.join(dir, 'local.snapshot.json'),
    remote: path.join(dir, 'remote.snapshot.json'),
    plan: path.join(dir, 'ready.plan.json'),
  };
  fs.writeFileSync(files.base, `${JSON.stringify(base, null, 2)}${os.EOL}`);
  fs.writeFileSync(files.local, `${JSON.stringify(local, null, 2)}${os.EOL}`);
  fs.writeFileSync(files.remote, `${JSON.stringify(base, null, 2)}${os.EOL}`);
  fs.writeFileSync(files.plan, `${JSON.stringify(readyPlan, null, 2)}${os.EOL}`);
  return files;
}

function buildFixture() {
  const base = {
    meta: {
      fixture: 'file-journal-restart-smoke',
      pushPolicy: {
        pluginOwnedResources: {
          allowedResources: [
            {
              pluginOwner: 'forms',
              resourceKey: 'row:["wp_options","option_name:forms_settings"]',
              driver: 'wp-option',
            },
          ],
        },
      },
    },
    files: {
      'index.php': '<?php echo "BASE_INDEX";',
      'wp-content/themes/reprint/style.css': '/* BASE_STYLE */',
      'wp-content/plugins/forms/forms.php': '<?php /* BASE_PLUGIN */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        'option_name:blogname': {
          option_name: 'blogname',
          option_value: 'BASE_BLOGNAME',
        },
        'option_name:siteurl': {
          option_name: 'siteurl',
          option_value: 'https://base.example.test',
        },
        'option_name:forms_settings': {
          option_name: 'forms_settings',
          option_value: { mode: 'base' },
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:10': {
          ID: 10,
          post_title: 'Base title',
          post_content: 'BASE_POST_CONTENT',
          post_status: 'publish',
        },
      },
      wp_postmeta: {
        'meta_id:20': {
          meta_id: 20,
          post_id: 10,
          meta_key: '_hero',
          meta_value: 'BASE_META',
        },
      },
    },
  };

  const local = clone(base);
  local.files['index.php'] = '<?php echo "LOCAL_INDEX_SECRET_VALUE";';
  local.files['wp-content/themes/reprint/style.css'] = '/* LOCAL_STYLE_SECRET_VALUE */';
  local.files['wp-content/plugins/forms/forms.php'] = '<?php /* LOCAL_PLUGIN_SECRET_VALUE */';
  local.db.wp_options['option_name:blogname'].option_value = 'LOCAL_BLOGNAME_SECRET_VALUE';
  local.db.wp_options['option_name:siteurl'].option_value = 'https://LOCAL_SITEURL_SECRET_VALUE.example.test';
  local.db.wp_options['option_name:forms_settings'].option_value = {
    mode: 'LOCAL_FORMS_SECRET_VALUE',
  };
  local.db.wp_posts['ID:10'].post_content = 'LOCAL_POST_CONTENT_SECRET_VALUE';
  local.db.wp_postmeta['meta_id:20'].meta_value = 'LOCAL_META_SECRET_VALUE';

  return { base, local };
}

function walk(value, visit, key = '') {
  visit(key, value);
  if (Array.isArray(value)) {
    value.forEach((child) => walk(child, visit, key));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    walk(childValue, visit, childKey);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
