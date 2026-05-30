import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPlan, PushPlanError } from '../src/apply.js';
import { assertEvidenceHasNoRawValues, redactEvidence } from '../src/evidence-redaction.js';
import { createPushPlan } from '../src/planner.js';
import { resourceHash } from '../src/resources.js';
import { digest } from '../src/stable-json.js';

const fixedNow = new Date('2026-05-30T00:00:00.000Z');
const command = 'node --test test/rpp-0269-conflict-evidence-hash-redaction-v4.test.js';
const sha256HexPattern = /^[a-f0-9]{64}$/;
const sha256EvidencePattern = /^sha256:[a-f0-9]{64}$/;
const formsOptionRowId = 'option_name:forms_settings';
const formsOptionResourceKey = 'row:["wp_options","option_name:forms_settings"]';
const postResourceKey = 'row:["wp_posts","ID:1"]';
const createdFilePath = 'wp-content/uploads/rpp-0269-private-report.txt';
const createdFileResourceKey = `file:${createdFilePath}`;

function baseSite() {
  return {
    files: {
      'index.php': '<?php echo "base";',
      'wp-content/plugins/forms/forms.php': '<?php /* forms 1.0 */',
    },
    plugins: {
      forms: { version: '1.0.0', active: true },
    },
    db: {
      wp_options: {
        [formsOptionRowId]: {
          option_name: 'forms_settings',
          option_value: {
            mode: 'base-mode',
            nested: { enabled: true },
          },
          autoload: 'no',
          __pluginOwner: 'forms',
        },
      },
      wp_posts: {
        'ID:1': {
          ID: 1,
          post_title: 'Base post',
          post_status: 'publish',
        },
      },
    },
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rpp0269ConflictFixture() {
  const raw = {
    fileLocal: 'rpp-0269-local-private-file-body',
    fileRemote: 'rpp-0269-remote-private-file-body',
    rowBase: 'rpp-0269-base-private-row-title',
    rowRemote: 'rpp-0269-remote-private-row-title',
    optionBase: 'rpp-0269-base-private-plugin-mode',
    optionLocal: 'rpp-0269-local-private-plugin-mode',
    optionRemote: 'rpp-0269-remote-private-plugin-mode',
  };
  const base = baseSite();
  base.db.wp_posts['ID:1'].post_title = raw.rowBase;
  base.db.wp_options[formsOptionRowId].option_value.mode = raw.optionBase;

  const local = cloneJson(base);
  const remote = cloneJson(base);

  local.files[createdFilePath] = raw.fileLocal;
  remote.files[createdFilePath] = raw.fileRemote;

  delete local.db.wp_posts['ID:1'];
  remote.db.wp_posts['ID:1'].post_title = raw.rowRemote;

  local.db.wp_options[formsOptionRowId].option_value.mode = raw.optionLocal;
  remote.db.wp_options[formsOptionRowId].option_value.mode = raw.optionRemote;

  return {
    base,
    local,
    remote,
    rawValues: Object.values(raw),
    expectedConflicts: [
      {
        resourceKey: createdFileResourceKey,
        class: 'file-conflict',
        pluginOwner: null,
        localChange: 'create',
        remoteChange: 'create',
        states: { base: 'absent', local: 'present', remote: 'present' },
        fileEvidence: true,
      },
      {
        resourceKey: formsOptionResourceKey,
        class: 'plugin-data-conflict',
        pluginOwner: 'forms',
        localChange: 'update',
        remoteChange: 'update',
        states: { base: 'present', local: 'present', remote: 'present' },
        fileEvidence: false,
      },
      {
        resourceKey: postResourceKey,
        class: 'row-conflict',
        pluginOwner: null,
        localChange: 'delete',
        remoteChange: 'update',
        states: { base: 'present', local: 'absent', remote: 'present' },
        fileEvidence: false,
      },
    ],
  };
}

function planFor({ base, local, remote }) {
  return createPushPlan({ base, local, remote, now: fixedNow });
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected function to throw');
}

function durableJournalTrap(events) {
  return {
    claimFenced: true,
    claimHash: '6'.repeat(64),
    appendEvent(type, payload) {
      events.push({ type, payload });
      return { sequence: events.length, type, ...payload };
    },
  };
}

function sha256Evidence(value) {
  return `sha256:${digest(value)}`;
}

function conflictByResourceKey(plan, resourceKey) {
  return plan.conflicts.find((conflict) => conflict.resourceKey === resourceKey);
}

function mutationByResourceKey(plan, resourceKey) {
  return plan.mutations.find((mutation) => mutation.resourceKey === resourceKey);
}

function assertValueEvidence(entry, {
  state,
  fileEvidence,
  label,
}) {
  const expectedKeys = ['hash', 'state'];
  if (fileEvidence && state === 'present') {
    expectedKeys.push('fileType');
  }

  assert.deepEqual(Object.keys(entry).sort(), expectedKeys.sort(), `${label} evidence keys`);
  assert.equal(entry.state, state, `${label} state`);
  assert.match(entry.hash, sha256HexPattern, `${label} hash format`);
  if (fileEvidence && state === 'present') {
    assert.equal(entry.fileType, 'file', `${label} file type`);
  }
}

function assertConflictEvidenceShape({ conflict, expected, base, local, remote }) {
  assert.ok(conflict, `${expected.resourceKey} conflict missing`);
  assert.equal(conflict.class, expected.class, `${expected.resourceKey} class`);
  assert.equal(conflict.pluginOwner || null, expected.pluginOwner, `${expected.resourceKey} owner`);
  assert.equal(conflict.reason, 'Local and remote both changed this resource after the pull base.');
  assert.equal(conflict.resolutionPolicy, 'preserve-remote-and-stop');
  assert.equal(conflict.baseHash, resourceHash(base, conflict.resource), `${expected.resourceKey} base hash source`);
  assert.equal(conflict.localHash, resourceHash(local, conflict.resource), `${expected.resourceKey} local hash source`);
  assert.equal(conflict.remoteHash, resourceHash(remote, conflict.resource), `${expected.resourceKey} remote hash source`);
  assert.match(conflict.baseHash, sha256HexPattern, `${expected.resourceKey} base hash format`);
  assert.match(conflict.localHash, sha256HexPattern, `${expected.resourceKey} local hash format`);
  assert.match(conflict.remoteHash, sha256HexPattern, `${expected.resourceKey} remote hash format`);
  assert.equal(conflict.change.localChange, expected.localChange, `${expected.resourceKey} local change`);
  assert.equal(conflict.change.remoteChange, expected.remoteChange, `${expected.resourceKey} remote change`);
  assert.equal(conflict.change.base.hash, conflict.baseHash, `${expected.resourceKey} base change hash`);
  assert.equal(conflict.change.local.hash, conflict.localHash, `${expected.resourceKey} local change hash`);
  assert.equal(conflict.change.remote.hash, conflict.remoteHash, `${expected.resourceKey} remote change hash`);
  assertValueEvidence(conflict.change.base, {
    state: expected.states.base,
    fileEvidence: expected.fileEvidence,
    label: `${expected.resourceKey} base`,
  });
  assertValueEvidence(conflict.change.local, {
    state: expected.states.local,
    fileEvidence: expected.fileEvidence,
    label: `${expected.resourceKey} local`,
  });
  assertValueEvidence(conflict.change.remote, {
    state: expected.states.remote,
    fileEvidence: expected.fileEvidence,
    label: `${expected.resourceKey} remote`,
  });
}

function hashOnlyConflictProjection(plan) {
  return {
    status: plan.status,
    summary: plan.summary,
    conflicts: plan.conflicts.map((conflict) => ({
      id: conflict.id,
      resourceKey: conflict.resourceKey,
      class: conflict.class,
      pluginOwner: conflict.pluginOwner || null,
      resolutionPolicy: conflict.resolutionPolicy,
      baseHash: conflict.baseHash,
      localHash: conflict.localHash,
      remoteHash: conflict.remoteHash,
      change: conflict.change,
      conflictHash: sha256Evidence({
        resourceKey: conflict.resourceKey,
        class: conflict.class,
        pluginOwner: conflict.pluginOwner || null,
        resolutionPolicy: conflict.resolutionPolicy,
        baseHash: conflict.baseHash,
        localHash: conflict.localHash,
        remoteHash: conflict.remoteHash,
        change: conflict.change,
      }),
    })),
  };
}

function assertNoRawValues(value, rawValues, label) {
  const serialized = JSON.stringify(value);
  for (const rawValue of rawValues) {
    assert.equal(serialized.includes(rawValue), false, `${label} leaked raw value ${rawValue}`);
  }
  for (const rawField of ['\"content\"', '\"option_value\"', '\"post_title\"', '\"__pluginOwner\"']) {
    assert.equal(serialized.includes(rawField), false, `${label} leaked raw field ${rawField}`);
  }
}

test('RPP-0269 conflict evidence hash redaction variant 4 serializes only resource and hash metadata', () => {
  const fixture = rpp0269ConflictFixture();
  const firstPlan = planFor(fixture);
  const replayPlan = planFor({
    base: cloneJson(fixture.base),
    local: cloneJson(fixture.local),
    remote: cloneJson(fixture.remote),
  });
  const durableJournalEvents = [];
  const remoteBefore = JSON.stringify(fixture.remote);
  const applyError = captureError(() => applyPlan(fixture.remote, firstPlan, {
    durableJournal: durableJournalTrap(durableJournalEvents),
  }));
  const projection = hashOnlyConflictProjection(firstPlan);
  const proof = {
    rpp: 'RPP-0269',
    behavior: 'Conflict evidence hash redaction, variant 4',
    command,
    evidenceSource: 'focused-local-conflict-evidence-redaction-v4',
    productionBacked: false,
    rawValuesIncluded: false,
    projection,
    refusal: {
      code: applyError.code,
      status: applyError.details.status,
      detailsHash: sha256Evidence(applyError.details),
      durableJournalEventCount: durableJournalEvents.length,
    },
  };
  proof.proofHash = sha256Evidence({ projection: proof.projection, refusal: proof.refusal });

  assert.equal(firstPlan.status, 'conflict');
  assert.deepEqual(firstPlan.summary, {
    mutations: 0,
    decisions: 0,
    conflicts: 3,
    blockers: 0,
    atomicGroups: 0,
  });
  assert.deepEqual(projection, hashOnlyConflictProjection(replayPlan));
  assert.deepEqual(
    firstPlan.conflicts.map((conflict) => conflict.resourceKey).sort(),
    fixture.expectedConflicts.map((expected) => expected.resourceKey).sort(),
  );

  for (const expected of fixture.expectedConflicts) {
    assert.equal(mutationByResourceKey(firstPlan, expected.resourceKey), undefined, `${expected.resourceKey} mutation`);
    assert.equal(
      firstPlan.preconditions.some((precondition) => precondition.resourceKey === expected.resourceKey),
      false,
      `${expected.resourceKey} precondition`,
    );
    assertConflictEvidenceShape({
      conflict: conflictByResourceKey(firstPlan, expected.resourceKey),
      expected,
      base: fixture.base,
      local: fixture.local,
      remote: fixture.remote,
    });
  }

  assert.ok(applyError instanceof PushPlanError);
  assert.equal(applyError.code, 'PLAN_NOT_READY');
  assert.deepEqual(applyError.details, { status: 'conflict' });
  assert.equal(JSON.stringify(fixture.remote), remoteBefore, 'conflict apply mutated the remote snapshot');
  assert.deepEqual(durableJournalEvents, [], 'conflict apply wrote durable journal evidence');

  assert.match(proof.refusal.detailsHash, sha256EvidencePattern);
  assert.match(proof.proofHash, sha256EvidencePattern);
  for (const conflict of projection.conflicts) {
    assert.match(conflict.conflictHash, sha256EvidencePattern);
  }
  assertNoRawValues(firstPlan.conflicts, fixture.rawValues, 'RPP-0269 conflict records');
  assertNoRawValues(applyError.details, fixture.rawValues, 'RPP-0269 refusal details');
  assertNoRawValues(proof, fixture.rawValues, 'RPP-0269 proof envelope');
  assert.deepEqual(
    redactEvidence({ conflicts: firstPlan.conflicts, refusal: applyError.details, proof }),
    { conflicts: firstPlan.conflicts, refusal: applyError.details, proof },
  );
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(firstPlan.conflicts, { label: 'RPP-0269 conflict evidence' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(applyError.details, { label: 'RPP-0269 refusal details' }));
  assert.doesNotThrow(() => assertEvidenceHasNoRawValues(proof, { label: 'RPP-0269 proof envelope' }));
});
